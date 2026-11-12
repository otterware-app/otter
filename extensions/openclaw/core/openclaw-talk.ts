import { logger, type TalkEvent, type TalkStart } from "@otter/core/extension-kit";

type Request = <T>(
  method: string,
  params: unknown,
  options?: { timeoutMs?: number | null },
) => Promise<T>;

/** The connection a call is on: the gateway ends its relay session when that connection goes. */
export type TalkGateway = { connection: object; request: Request; detaches: boolean };

type Talk = {
  gateway: TalkGateway;
  sessionKey: string;
  emit: (event: TalkEvent) => void;
  heardAt: number;
  error?: string;
  /** Consults the agent is answering for the voice, by call: each one's abort. */
  consults: Map<string, () => void>;
};

type RelayEvent = {
  relaySessionId?: string;
  type?: string;
  audioBase64?: string;
  markName?: string;
  role?: string;
  text?: string;
  final?: boolean;
  message?: string;
  reason?: string;
  callId?: string;
  name?: string;
  args?: unknown;
  talkEvent?: { type?: string; final?: boolean };
};

type ChatFrame = {
  runId?: string;
  state?: string;
  errorMessage?: string;
  message?: { content?: { type?: string; text?: string }[] };
};

/** What the voice's model asks the agent: the one tool Talk gives it to hand on. */
const CONSULT = "openclaw_agent_consult";
const AUDIO_TIMEOUT_MS = 8_000;
const CONSULT_TIMEOUT_MS = 120_000;
/** The window that started a call sends audio all the time, silence too: one that went quiet is gone. */
const SILENT_MS = 15_000;

const talks = new Map<string, Talk>();
const runs = new Map<string, (frame: ChatFrame) => void>();
let watchdog: ReturnType<typeof setInterval> | undefined;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const plain = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error: /, "");

type Catalog = {
  realtime?: {
    ready?: boolean;
    providers?: { configured?: boolean; transports?: string[]; brains?: string[] }[];
  };
};

/** Whether the gateway has a realtime voice set up that streams through it and asks the agent. */
export async function talkReady(g: TalkGateway): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      const { realtime } = await g.request<Catalog>("talk.catalog", {});
      return Boolean(
        realtime?.ready &&
        realtime.providers?.some(
          (p) =>
            p.configured &&
            p.transports?.includes("gateway-relay") &&
            p.brains?.includes("agent-consult"),
        ),
      );
    } catch (error) {
      // A gateway that just started is still finding its voices.
      if ((error as { retryable?: boolean }).retryable && attempt < 10) await sleep(500);
      else {
        logger.info("agent", "openclaw talk catalog failed", { error: String(error) });
        return false;
      }
    }
  }
}

export async function startTalk(
  g: TalkGateway,
  sessionKey: string,
  emit: (event: TalkEvent) => void,
): Promise<TalkStart> {
  let created: {
    relaySessionId?: string;
    sessionId: string;
    audio?: {
      inputEncoding?: string;
      inputSampleRateHz?: number;
      outputEncoding?: string;
      outputSampleRateHz?: number;
    };
  };
  try {
    created = await g.request("talk.session.create", {
      sessionKey,
      mode: "realtime",
      transport: "gateway-relay",
      brain: "agent-consult",
    });
  } catch (error) {
    throw new Error(`OpenClaw can't talk: ${plain(error)}`, { cause: error });
  }
  const talkId = created.relaySessionId ?? created.sessionId;
  const { audio } = created;
  if (audio?.inputEncoding !== "pcm16" || audio.outputEncoding !== "pcm16") {
    void g.request("talk.session.close", { sessionId: talkId }).catch(() => {});
    throw new Error("OpenClaw's voice sends audio Otter can't play.");
  }
  talks.set(talkId, { gateway: g, sessionKey, emit, heardAt: Date.now(), consults: new Map() });
  watchdog ??= setInterval(() => {
    for (const [id, talk] of talks)
      if (Date.now() - talk.heardAt > SILENT_MS) {
        logger.info("agent", "openclaw talk went quiet", { talkId: id });
        void endTalk(id);
      }
  }, SILENT_MS / 3);
  logger.info("agent", "openclaw talk started", { talkId });
  return {
    talkId,
    sessionId: sessionKey,
    inputRate: audio.inputSampleRateHz ?? 24_000,
    outputRate: audio.outputSampleRateHz ?? 24_000,
  };
}

export async function talkAudio(talkId: string, audio: string): Promise<void> {
  const talk = talks.get(talkId);
  if (!talk) return;
  talk.heardAt = Date.now();
  await talk.gateway.request(
    "talk.session.appendAudio",
    { sessionId: talkId, audioBase64: audio },
    { timeoutMs: AUDIO_TIMEOUT_MS },
  );
}

export async function talkPlayed(talkId: string, mark: string): Promise<void> {
  const talk = talks.get(talkId);
  if (!talk || !mark) return;
  await talk.gateway.request("talk.session.acknowledgeMark", { sessionId: talkId, markName: mark });
}

/** Ending a call leaves what the agent was asked going: its answer still comes to the chat. */
export async function endTalk(talkId: string): Promise<void> {
  const talk = forget(talkId);
  if (!talk) return;
  logger.info("agent", "openclaw talk ended", { talkId });
  await talk.gateway
    .request("talk.session.close", {
      sessionId: talkId,
      ...(talk.gateway.detaches ? { disposition: "detach" } : {}),
    })
    .catch((error: unknown) =>
      logger.info("agent", "openclaw talk close failed", { error: String(error) }),
    );
}

function forget(talkId: string): Talk | undefined {
  const talk = talks.get(talkId);
  if (!talk) return;
  talks.delete(talkId);
  for (const abort of talk.consults.values()) abort();
  if (talks.size === 0) {
    clearInterval(watchdog);
    watchdog = undefined;
  }
  return talk;
}

function closed(talkId: string, error?: string): void {
  forget(talkId)?.emit({ talkId, type: "closed", ...(error ? { error } : {}) });
}

/** The connection went, and its calls with it. */
export function talksLost(connection: object): void {
  for (const [talkId, talk] of talks)
    if (talk.gateway.connection === connection)
      closed(talkId, "Lost the connection to your gateway.");
}

export function endAllTalks(): void {
  for (const talkId of talks.keys()) void endTalk(talkId);
}

export function onTalkFrame(event: string, payload: unknown): void {
  if (event === "chat") {
    const frame = payload as ChatFrame;
    if (frame?.runId) runs.get(frame.runId)?.(frame);
    return;
  }
  if (event !== "talk.event") return;
  const p = payload as RelayEvent;
  const talkId = p?.relaySessionId;
  const talk = talkId ? talks.get(talkId) : undefined;
  if (!talkId || !talk) return;
  switch (p.type) {
    case "ready":
      return talk.emit({ talkId, type: "ready" });
    case "audio":
      if (p.audioBase64) talk.emit({ talkId, type: "audio", audio: p.audioBase64 });
      return;
    case "clear":
      return talk.emit({ talkId, type: "clear" });
    case "mark":
      if (p.markName) talk.emit({ talkId, type: "mark", name: p.markName });
      return;
    case "transcript":
      if ((p.role === "user" || p.role === "assistant") && p.text)
        talk.emit({ talkId, type: "transcript", role: p.role, text: p.text, final: !!p.final });
      return;
    case "toolCall":
      return void consult(talkId, talk, p);
    case "toolCallCancelled":
      return talk.consults.get(String(p.callId))?.();
    case "toolResult":
      // The gateway answered it itself.
      if (p.talkEvent?.type !== "tool.progress" && p.talkEvent?.final !== false)
        talk.consults.get(String(p.callId))?.();
      return;
    case "error":
      talk.error = p.message ? plain(p.message) : undefined;
      return;
    case "close":
      return closed(
        talkId,
        p.reason === "error" ? (talk.error ?? "OpenClaw's voice stopped.") : undefined,
      );
  }
}

/**
 * A voice that hands what you asked to the agent through the client (one that can't on its own,
 * as GPT-Live does): the agent runs it in the chat's session, and its answer goes back to the voice.
 */
async function consult(talkId: string, talk: Talk, call: RelayEvent): Promise<void> {
  const callId = call.callId?.trim();
  if (!callId) return;
  const submit = (result: unknown) =>
    talk.gateway
      .request("talk.session.submitToolResult", { sessionId: talkId, callId, result })
      .catch((error: unknown) =>
        logger.info("agent", "openclaw talk tool result failed", { error: String(error) }),
      );
  if (call.name !== CONSULT) {
    await submit({ error: `Otter's calls don't have ${call.name ?? "that tool"}.` });
    return;
  }
  let runId: string | undefined;
  try {
    const ack = await talk.gateway.request<{ runId: string }>("talk.client.toolCall", {
      sessionKey: talk.sessionKey,
      callId,
      name: CONSULT,
      args: typeof call.args === "string" ? JSON.parse(call.args || "{}") : (call.args ?? {}),
      relaySessionId: talkId,
    });
    runId = ack.runId;
    const answer = await new Promise<string>((resolve, reject) => {
      const done = (settle: () => void) => {
        clearTimeout(timer);
        runs.delete(ack.runId);
        talk.consults.delete(callId);
        settle();
      };
      const timer = setTimeout(
        () => done(() => reject(new Error("OpenClaw took too long."))),
        CONSULT_TIMEOUT_MS,
      );
      talk.consults.set(callId, () => done(() => reject(new Error("cancelled"))));
      runs.set(ack.runId, (frame) => {
        if (frame.state === "final") {
          const text = (frame.message?.content ?? [])
            .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
            .join("\n")
            .trim();
          done(() => resolve(text || "OpenClaw finished with no text."));
        } else if (frame.state === "error" || frame.state === "aborted")
          done(() => reject(new Error(frame.errorMessage || `OpenClaw's run ${frame.state}.`)));
      });
    });
    if (talks.has(talkId)) await submit({ result: answer });
  } catch (error) {
    if (runId) runs.delete(runId);
    if (talks.has(talkId) && plain(error) !== "cancelled") await submit({ error: plain(error) });
  }
}
