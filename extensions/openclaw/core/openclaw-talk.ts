import { logger, type TalkEvent, type TalkStart } from "@otter/core/extension-kit";

/** Adapted from OpenClaw (github.com/openclaw/openclaw, the Control UI's Gateway-relay Talk client; MIT, see THIRD_PARTY_NOTICES.md). */

type Request = <T>(
  method: string,
  params: unknown,
  options?: { timeoutMs?: number | null },
) => Promise<T>;

/** The connection a call is on: the gateway ends its relay session when that connection goes. */
export type TalkGateway = { connection: object; request: Request; detaches: boolean };

type ToolResult = { result: unknown; willContinue?: boolean };

type Talk = {
  gateway: TalkGateway;
  sessionKey: string;
  emit: (event: TalkEvent) => void;
  heardAt: number;
  error?: string;
  /** The turn whose audio is playing: a `clear` for another turn is stale. */
  turnId: string | null;
  /** Marks sent to play and not yet played: the voice is still saying something. */
  marks: Set<string>;
  /** Answers for the voice, held until what it's saying has played, as OpenClaw's clients do. */
  held: Map<string, ToolResult>;
  /** Tool calls being answered, by call: `abort(true)` tells the voice it was cancelled. */
  calls: Map<string, (report: boolean) => void>;
  /** Tool calls the gateway settled itself, or cancelled: nothing more goes back for them. */
  settled: Set<string>;
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
  forced?: boolean;
  talkEvent?: { type?: string; final?: boolean; turnId?: string };
};

type ChatFrame = {
  runId?: string;
  state?: string;
  errorMessage?: string;
  message?: { content?: { type?: string; text?: string }[] };
};

/** The voice hands the agent a request. */
const CONSULT = "openclaw_agent_consult";
/** The voice asks after, steers or cancels what the agent is doing. */
const CONTROL = "openclaw_agent_control";
const CONTROL_MODES = new Set(["status", "steer", "cancel", "followup"]);
/** OpenClaw's relay clients end a call whose audio goes unacknowledged this long. */
const AUDIO_ACK_MS = 30_000;
const CONSULT_TIMEOUT_MS = 120_000;
/** The window that started a call sends audio all the time, silence too: one that went quiet is gone. */
const SILENT_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const plain = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error: /, "");

class Cancelled extends Error {}

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

const parseArgs = (args: unknown): Record<string, unknown> => {
  if (typeof args !== "string") return (args as Record<string, unknown>) ?? {};
  try {
    return args.trim() ? (JSON.parse(args) as Record<string, unknown>) : {};
  } catch {
    return { text: args.trim() };
  }
};

/** The calls with one agent: what its gateway relays goes to `onTalkFrame`. */
export function createTalks() {
  const talks = new Map<string, Talk>();
  /**
   * Runs the agent started in a session while a call was on it (what the voice asked of it), until
   * they end: the gateway takes nothing into them once the call is over, so they're never steered.
   */
  const callWork = new Set<string>();

  const isCallWork = (runId: string) => callWork.has(runId);
  const runs = new Map<string, (frame: ChatFrame) => void>();
  let watchdog: ReturnType<typeof setInterval> | undefined;

  async function startTalk(
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
    talks.set(talkId, {
      gateway: g,
      sessionKey,
      emit,
      heardAt: Date.now(),
      turnId: null,
      marks: new Set(),
      held: new Map(),
      calls: new Map(),
      settled: new Set(),
    });
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

  async function talkAudio(talkId: string, audio: string): Promise<void> {
    const talk = talks.get(talkId);
    if (!talk) return;
    talk.heardAt = Date.now();
    try {
      await talk.gateway.request(
        "talk.session.appendAudio",
        { sessionId: talkId, audioBase64: audio, timestamp: Date.now() },
        { timeoutMs: AUDIO_ACK_MS },
      );
    } catch (error) {
      if (!talks.has(talkId)) return;
      logger.info("agent", "openclaw talk audio failed", { talkId, error: String(error) });
      void endTalk(talkId, "Your gateway stopped taking the call's audio. Start the call again.");
    }
  }

  async function talkPlayed(talkId: string, mark: string): Promise<void> {
    const talk = talks.get(talkId);
    if (!talk || !mark) return;
    talk.marks.delete(mark);
    await talk.gateway.request("talk.session.acknowledgeMark", {
      sessionId: talkId,
      markName: mark,
    });
    if (talk.marks.size === 0) releaseHeld(talkId, talk);
  }

  /** Ending a call leaves what the agent was asked going: its answer still comes to the chat. */
  async function endTalk(talkId: string, error?: string): Promise<void> {
    const talk = talks.get(talkId);
    if (!talk) return;
    if (error) closed(talkId, error);
    else forget(talkId);
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
    for (const abort of talk.calls.values()) abort(false);
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
  function talksLost(connection: object): void {
    for (const [talkId, talk] of talks)
      if (talk.gateway.connection === connection)
        closed(talkId, "Lost the connection to your gateway.");
  }

  function endAllTalks(): void {
    for (const talkId of talks.keys()) void endTalk(talkId);
  }

  function onTalkFrame(event: string, payload: unknown): void {
    if (event === "agent") {
      const p = payload as {
        sessionKey?: string;
        runId?: string;
        stream?: string;
        data?: { phase?: string };
      };
      if (p?.stream !== "lifecycle" || !p.runId) return;
      if (
        p.data?.phase === "start" &&
        [...talks.values()].some((t) => t.sessionKey === p.sessionKey)
      )
        callWork.add(p.runId);
      else if (p.data?.phase === "end" || p.data?.phase === "error") callWork.delete(p.runId);
      return;
    }
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
        if (!p.audioBase64) return;
        talk.turnId = p.talkEvent?.turnId?.trim() || talk.turnId;
        return talk.emit({ talkId, type: "audio", audio: p.audioBase64 });
      case "clear": {
        const turnId = p.talkEvent?.turnId;
        if (turnId && turnId !== talk.turnId) return;
        talk.turnId = null;
        talk.marks.clear();
        talk.emit({ talkId, type: "clear" });
        if (p.talkEvent?.type === "turn.cancelled")
          for (const abort of talk.calls.values()) abort(true);
        return releaseHeld(talkId, talk);
      }
      case "mark":
        if (!p.markName) return;
        talk.marks.add(p.markName);
        return talk.emit({ talkId, type: "mark", name: p.markName });
      case "transcript":
        if ((p.role === "user" || p.role === "assistant") && p.text)
          talk.emit({ talkId, type: "transcript", role: p.role, text: p.text, final: !!p.final });
        return;
      case "toolCall":
        return void answer(talkId, talk, p);
      case "toolCallCancelled":
        return settle(talk, p.callId, true);
      case "toolResult":
        // The gateway answered it itself; a progress report or one more to come isn't the end.
        if (p.talkEvent?.type !== "tool.progress" && p.talkEvent?.final !== false)
          settle(talk, p.callId, false);
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

  /** Nothing more goes back for this call: the gateway cancelled or answered it. */
  function settle(talk: Talk, id: string | undefined, cancelled: boolean): void {
    const callId = id?.trim();
    if (!callId) return;
    talk.settled.add(callId);
    talk.calls.get(callId)?.(false);
    if (cancelled) talk.held.delete(callId);
  }

  function submit(talkId: string, talk: Talk, callId: string, answer: ToolResult): Promise<void> {
    if (talk.settled.has(callId) || !talks.has(talkId)) return Promise.resolve();
    // Said over the voice, an answer cuts it off: it waits until what's queued has played.
    if (!answer.willContinue && talk.marks.size > 0) {
      talk.held.set(callId, answer);
      return Promise.resolve();
    }
    if (!answer.willContinue) talk.settled.add(callId);
    return talk.gateway
      .request("talk.session.submitToolResult", {
        sessionId: talkId,
        callId,
        result: answer.result,
        ...(answer.willContinue ? { options: { willContinue: true } } : {}),
      })
      .then(() => {})
      .catch((error: unknown) =>
        logger.info("agent", "openclaw talk tool result failed", { error: String(error) }),
      );
  }

  function releaseHeld(talkId: string, talk: Talk): void {
    const held = [...talk.held];
    talk.held.clear();
    for (const [callId, answer] of held) void submit(talkId, talk, callId, answer);
  }

  async function answer(talkId: string, talk: Talk, call: RelayEvent): Promise<void> {
    const callId = call.callId?.trim();
    if (!callId) return;
    if (call.name === CONSULT) return consult(talkId, talk, callId, call);
    if (call.name === CONTROL) return control(talkId, talk, callId, call);
    await submit(talkId, talk, callId, {
      result: { error: `Otter's calls don't have ${call.name ?? "that tool"}.` },
    });
  }

  /** "Is it done?", "stop that", "actually, do this instead": into the work this call started. */
  async function control(
    talkId: string,
    talk: Talk,
    callId: string,
    call: RelayEvent,
  ): Promise<void> {
    const args = parseArgs(call.args);
    const text = [args.text, args.message, args.request, args.query].find(
      (value): value is string => typeof value === "string" && value.trim() !== "",
    );
    const mode = typeof args.mode === "string" && CONTROL_MODES.has(args.mode) && args.mode;
    let result: unknown;
    try {
      if (!text) throw new Error("text required");
      result = await talk.gateway.request("talk.session.steer", {
        sessionId: talkId,
        sessionKey: talk.sessionKey,
        text: text.trim(),
        ...(mode ? { mode } : {}),
      });
    } catch (error) {
      result = { error: plain(error) };
    }
    await submit(talkId, talk, callId, { result });
  }

  /**
   * What you asked, handed to the agent: it runs in the chat's session, and its answer goes back
   * to the voice to say.
   */
  async function consult(
    talkId: string,
    talk: Talk,
    callId: string,
    call: RelayEvent,
  ): Promise<void> {
    let report = false;
    const cancelled = new Promise<never>((_, reject) =>
      talk.calls.set(callId, (tell) => {
        report = tell;
        reject(new Cancelled());
      }),
    );
    cancelled.catch(() => {});
    let runId: string | undefined;
    try {
      if (call.forced)
        await submit(talkId, talk, callId, {
          result: {
            status: "working",
            tool: CONSULT,
            message:
              "Tell the person briefly that you are checking, then wait for the final OpenClaw result before answering with the actual result.",
          },
          willContinue: true,
        });
      const ack = await Promise.race([
        talk.gateway.request<{ runId: string }>("talk.client.toolCall", {
          sessionKey: talk.sessionKey,
          callId,
          name: CONSULT,
          args: parseArgs(call.args),
          relaySessionId: talkId,
        }),
        cancelled,
      ]);
      runId = ack.runId;
      const text = await Promise.race([agentAnswer(talk, ack.runId), cancelled]);
      await submit(talkId, talk, callId, { result: { result: text } });
    } catch (error) {
      if (!(error instanceof Cancelled))
        await submit(talkId, talk, callId, { result: { error: plain(error) } });
      else if (report)
        await submit(talkId, talk, callId, {
          result: { status: "cancelled", message: "Cancelled the active OpenClaw run." },
        });
    } finally {
      if (runId) runs.delete(runId);
      talk.calls.delete(callId);
    }
  }

  /** The agent's answer to a consult: its run's final text, or why it has none. */
  function agentAnswer(talk: Talk, runId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        runs.delete(runId);
        reject(new Error("OpenClaw took too long."));
      }, CONSULT_TIMEOUT_MS);
      const done = (settle: () => void) => {
        clearTimeout(timer);
        runs.delete(runId);
        settle();
      };
      runs.set(runId, (frame) => {
        if (frame.state === "final") {
          const text = (frame.message?.content ?? [])
            .flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
            .join("\n")
            .trim();
          if (text) return done(() => resolve(text));
          // A run can end without text in its final frame: the gateway says how it went.
          done(() =>
            talk.gateway
              .request<{ status?: string; error?: string }>("agent.wait", { runId, timeoutMs: 0 })
              .then((ended) =>
                ended?.status === "error"
                  ? reject(new Error(ended.error?.trim() || "OpenClaw's run failed."))
                  : resolve("OpenClaw finished with no text."),
              )
              .catch(() => resolve("OpenClaw finished with no text.")),
          );
        } else if (frame.state === "error" || frame.state === "aborted")
          done(() => reject(new Error(frame.errorMessage || `OpenClaw's run ${frame.state}.`)));
      });
    });
  }

  return {
    startTalk,
    talkAudio,
    talkPlayed,
    endTalk,
    talksLost,
    endAllTalks,
    onTalkFrame,
    isCallWork,
  };
}
