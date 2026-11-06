import {
  toBase64,
  fromBase64,
  utf8Encode,
  logger,
  platform,
  readAttachment,
  chatFile,
  chatFilePath,
  downloadChatFile,
  clearOpenClawBootstrapToken,
  clearOpenClawDeviceToken,
  getOpenClawBootstrapToken,
  getOpenClawDeviceKey,
  getOpenClawDeviceToken,
  getOpenClawToken,
  setOpenClawDeviceKey,
  setOpenClawDeviceToken,
  openClawStep,
} from "@otter-mail/core/extension-kit";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ChatEvent,
  ChatQuestion,
  ChatProvider,
  AgentRun,
  ChatSession,
  ChatSessionMessage,
  Emit,
} from "@otter-mail/core/extension-kit";
import {
  newOpenClawDeviceKey,
  openClawDeviceIdentity,
  type OpenClawDeviceKey,
} from "./openclaw-device.js";
import { OPENCLAW_DEFAULTS, type OpenClawSettings } from "./settings.js";
import {
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  type EventFrame,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceIdentity,
} from "@openclaw/gateway-client/browser";
import { OpenClawText, openClawMessageText as textOf } from "./openclaw-stream.js";

const CONNECT_TIMEOUT_MS = 8_000;
/**
 * What this device asks for. Answering the agent's questions came later: a
 * device paired without it signs in with the scopes it has, and asks for it
 * separately (`allowOpenClawQuestions`), as the gateway refuses a paired
 * device that just asks for more.
 */
const QUESTIONS = "operator.questions";
const SCOPES = ["operator.read", "operator.write", "operator.approvals", QUESTIONS];

export function normalizeOpenClawUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/^http/i, "ws");
  return `wss://${trimmed}`;
}

/** A setup code (`openclaw qr --setup-code-only`): base64url JSON of the address and a bootstrap token. */
export type OpenClawSetupCode = { url: string; bootstrapToken: string; expiresAtMs?: number };

export function parseOpenClawSetupCode(code: string): OpenClawSetupCode | null {
  try {
    const json = JSON.parse(atob(code.trim().replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;
    if (typeof json.url !== "string" || typeof json.bootstrapToken !== "string") return null;
    return {
      url: json.url,
      bootstrapToken: json.bootstrapToken,
      ...(typeof json.expiresAtMs === "number" ? { expiresAtMs: json.expiresAtMs } : {}),
    };
  } catch {
    return null;
  }
}

let identity: Promise<GatewayBrowserDeviceIdentity> | null = null;

function deviceIdentity(): Promise<GatewayBrowserDeviceIdentity> {
  identity ??= (async () => {
    let key = JSON.parse((await getOpenClawDeviceKey()) || "null") as OpenClawDeviceKey | null;
    if (!key) {
      key = newOpenClawDeviceKey();
      await setOpenClawDeviceKey(JSON.stringify(key));
    }
    return openClawDeviceIdentity(key);
  })();
  return identity;
}

const lifecycle = new GatewayBrowserDeviceAuthLifecycle({
  loadIdentity: deviceIdentity,
  tokenStore: {
    load: async () => JSON.parse((await getOpenClawDeviceToken()) || "null"),
    store: ({ token, scopes }) => setOpenClawDeviceToken(JSON.stringify({ token, scopes })),
    clear: () => clearOpenClawDeviceToken(),
  },
});

let pairingRequest: string | null = null;

export function openClawPairingRequest(): string | null {
  return pairingRequest;
}

type Gateway = {
  url: string;
  client: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan>;
  scopes: string[];
};

let questionsAllowed: boolean | null = null;
let questionsRequest: string | null = null;

export function openClawQuestions(): { allowed: boolean | null; request: string | null } {
  return { allowed: questionsAllowed, request: questionsRequest };
}

let current: { url: string; ready: Promise<Gateway> } | null = null;
const listeners = new Set<(event: EventFrame) => void>();
const closeListeners = new Set<(client: Gateway["client"]) => void>();

function gatewayCode(error: unknown): string {
  return (error as { details?: { code?: string } })?.details?.code ?? "";
}

type Credentials = { token: string; bootstrapToken: string };

async function credentials(): Promise<Credentials | null> {
  const [token, bootstrapToken, deviceToken] = await Promise.all([
    getOpenClawToken(),
    getOpenClawBootstrapToken(),
    getOpenClawDeviceToken(),
  ]);
  return token || bootstrapToken || deviceToken ? { token, bootstrapToken } : null;
}

export async function hasOpenClawCredentials(): Promise<boolean> {
  return (await credentials()) !== null;
}

function open(url: string, { token, bootstrapToken }: Credentials): Promise<Gateway> {
  return new Promise((resolve, reject) => {
    let requestId = 0;
    let settled = false;
    let scopes: string[] = [];
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        client.stop();
        reject(error);
      } else resolve({ url, client, scopes });
    };
    const timer = setTimeout(
      () => settle(new Error("The gateway didn't answer.")),
      CONNECT_TIMEOUT_MS,
    );
    const p = platform();
    const clientInfo = {
      id: "gateway-client" as const,
      mode: "ui" as const,
      displayName: `Otter Mail (${p.kind})`,
      version: p.appVersion,
      platform: p.kind,
    };
    const client: GatewayProtocolClient<GatewayBrowserDeviceAuthPlan> = new GatewayProtocolClient({
      createSocket: (on) => {
        const socket = new WebSocket(url);
        socket.addEventListener("open", () => on.open());
        socket.addEventListener("message", (event) => on.message(String(event.data)));
        socket.addEventListener("close", (event) => on.close(event.code, event.reason));
        socket.addEventListener("error", () => on.error(new Error("Can't reach the gateway.")));
        return {
          isOpen: () => socket.readyState === WebSocket.OPEN,
          send: (data) => socket.send(data),
          close: (code, reason) => socket.close(code, reason),
        };
      },
      createRequestId: () => `otter-mail-${++requestId}`,
      buildConnectPlan: async ({ nonce, challengeTs }) =>
        lifecycle.buildPlan({
          client: clientInfo,
          role: "operator",
          defaultScopes: (await heldScopes()) ?? SCOPES,
          token: token || undefined,
          bootstrapToken: bootstrapToken || undefined,
          preferBootstrapToken: Boolean(bootstrapToken),
          nonce,
          challengeTs,
        }),
      buildConnectParams: (plan) => ({
        minProtocol: 4,
        maxProtocol: 4,
        client: clientInfo,
        role: plan.role,
        scopes: plan.scopes,
        caps: ["tool-events", "exec-approvals", "plugin-approvals"],
        auth: plan.auth,
        device: plan.device,
      }),
      onConnectHello: (hello, context) => lifecycle.acceptHello(hello, context.plan),
      onHello: (hello) => {
        pairingRequest = null;
        scopes = hello.auth?.scopes ?? [];
        questionsAllowed = scopes.includes(QUESTIONS);
        if (bootstrapToken) void clearOpenClawBootstrapToken();
        settle(null);
      },
      onConnectFailure: (error) => {
        const details = (error as { details?: { code?: string; requestId?: string } }).details;
        if (details?.code === "PAIRING_REQUIRED") pairingRequest = details.requestId ?? null;
        settle(error);
        return { closeCode: 1000, closeReason: "connect failed", stop: true, error };
      },
      onConnectError: (error) => settle(error),
      resolveClose: () => ({ retry: false, notify: false }),
      onClose: () => {
        if (current?.url === url) current = null;
        settle(new Error("Can't reach the gateway."));
        for (const listener of closeListeners) listener(client);
      },
      onEvent: (event) => {
        for (const listener of listeners) listener(event);
      },
      handshake: { mode: "require-challenge", timeoutMs: CONNECT_TIMEOUT_MS },
      reconnect: { initialMs: 1_000, multiplier: 2, maxMs: 30_000 },
    });
    client.start();
  });
}

async function gateway(settings: OpenClawSettings): Promise<Gateway> {
  const { url } = settings;
  const creds = await credentials();
  if (!url || !creds) throw new Error("not_configured");
  if (current?.url !== url) {
    disconnect();
    const ready = open(url, creds);
    current = { url, ready };
    ready.catch(() => {
      if (current?.ready === ready) current = null;
    });
  }
  return current.ready;
}

function disconnect(): void {
  const previous = current;
  current = null;
  void previous?.ready
    .then((g) => {
      g.client.stop();
      // A stopped client doesn't report its close; runs on it find the next one.
      for (const listener of closeListeners) listener(g.client);
    })
    .catch(() => {});
}

export async function resetOpenClawConnection(): Promise<void> {
  disconnect();
  pairingRequest = null;
  questionsAllowed = null;
  questionsRequest = null;
  await clearOpenClawDeviceToken();
}

async function heldScopes(): Promise<string[] | null> {
  const stored = JSON.parse((await getOpenClawDeviceToken()) || "null") as {
    scopes?: string[];
  } | null;
  return stored?.scopes?.length ? stored.scopes : null;
}

export async function allowOpenClawQuestions(
  settings: OpenClawSettings,
  changed: () => void,
): Promise<void> {
  const g = await gateway(settings);
  if (g.scopes.includes(QUESTIONS)) return;
  const { requestId } = await g.client.request<{ requestId: string }>(
    "device.scopes.requestUpgrade",
    { scopes: [...new Set([...g.scopes, ...SCOPES])] },
  );
  questionsRequest = requestId;
  changed();
  g.client
    .request<{ status: string; deviceToken?: string; scopes?: string[] }>(
      "device.scopes.waitUpgrade",
      { requestId },
      { timeoutMs: null },
    )
    .then(async (result) => {
      logger.info("agent", "openclaw questions upgrade", { status: result.status });
      if (result.status !== "approved" || !result.deviceToken) return;
      await setOpenClawDeviceToken(
        JSON.stringify({ token: result.deviceToken, scopes: result.scopes ?? [] }),
      );
      if (current?.url === g.url) disconnect();
    })
    .catch((error: unknown) =>
      logger.info("agent", "openclaw questions upgrade failed", { error: String(error) }),
    )
    .finally(() => {
      if (questionsRequest === requestId) questionsRequest = null;
      changed();
    });
}

type Agent = {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string; avatarUrl?: string };
};

const MAX_AVATAR_LENGTH = 512_000;

function agentAvatar(agent: Agent): string | undefined {
  const url = agent.identity?.avatarUrl;
  if (!url || url.length > MAX_AVATAR_LENGTH) return undefined;
  return /^(https:|data:image\/)/i.test(url) ? url : undefined;
}

async function listAgents(g: Gateway): Promise<{ defaultId: string; agents: Agent[] }> {
  const result = await g.client.request<{ defaultId?: string; agents?: Agent[] }>(
    "agents.list",
    {},
  );
  return { defaultId: result.defaultId ?? "main", agents: result.agents ?? [] };
}

/** The gateway's profile for connections it can't tie to a person (every token or device-token client). */
const OWNER_PROFILE_ID = "gateway-owner";

/**
 * Who the gateway takes this device for: a person's profile, or the shared
 * owner profile. Null when the gateway can't say (an older one).
 */
async function whoAmI(g: Gateway): Promise<{ label: string } | null> {
  try {
    const { profile } = await g.client.request<{
      profile: { id: string; displayName: string | null; emails: string[] };
    }>("users.self", {});
    if (profile.id === OWNER_PROFILE_ID)
      return {
        label: profile.displayName
          ? `the shared owner (${profile.displayName})`
          : "the shared owner",
      };
    return { label: profile.displayName ?? profile.emails[0] ?? profile.id };
  } catch (error) {
    logger.info("agent", "openclaw users.self failed", { error: String(error) });
    return null;
  }
}

function connectError(error: unknown): string {
  const code = gatewayCode(error);
  if (code === "PAIRING_REQUIRED") return "pairing_required";
  if (code === "CONTROL_UI_ORIGIN_NOT_ALLOWED") return "origin_not_allowed";
  const message = error instanceof Error ? error.message : String(error);
  if (message === "not_configured") return message;
  return /token|unauthori[sz]ed/i.test(message) ? "unauthorized" : "unreachable";
}

const QUIET_MS = 60_000;
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];

type Turn = {
  requestId: string;
  sessionKey: string;
  runId: string;
  /**
   * The runs its steers started: a steer the runtime takes mid-turn joins
   * the run, one it can't runs after it, under its own id. The turn lasts
   * until they're all over.
   */
  steers: Set<string>;
  /**
   * The run handed off with `sessions_yield`: the turn waits for the run
   * its subagents' or background commands' completion starts, which joins it.
   */
  yielded: boolean;
  /** Settling: a run that starts now is the agent's own, not this turn's. */
  ending: boolean;
  /** Its runs that are over. */
  finals: Set<string>;
  gateway: Gateway;
  emit: Emit;
  text: OpenClawText;
  resynced: boolean;
  sessionApprovals: boolean;
  descendants: Map<string, Promise<boolean>>;
  finish: (event: ChatEvent) => void;
};

/** A run the agent started on its own (a completion it was woken for, a cron job) is followed as `run:<id>`. */
const AGENT_RUN = "run:";

const turns = new Map<string, Turn>();
const approvals = new Map<
  string,
  { requestId: string; approval: ApprovalRequest; kind?: string }
>();
const questions = new Map<string, { requestId: string; question: ChatQuestion }>();

const DECISIONS: Record<ApprovalDecision, string> = {
  once: "allow-once",
  session: "allow-once",
  always: "allow-always",
  deny: "deny",
};
const CHOICES: Record<string, ApprovalDecision> = {
  "allow-once": "once",
  "allow-always": "always",
  deny: "deny",
};

function newTurn(requestId: string, sessionKey: string, gateway: Gateway, emit: Emit): Turn {
  return {
    requestId,
    sessionKey,
    runId: requestId.startsWith(AGENT_RUN) ? requestId.slice(AGENT_RUN.length) : requestId,
    steers: new Set(),
    yielded: false,
    ending: false,
    finals: new Set(),
    gateway,
    emit,
    text: new OpenClawText(requestId, emit),
    resynced: false,
    sessionApprovals: false,
    descendants: new Map(),
    finish: () => {},
  };
}

const ownsRun = (turn: Turn, runId: unknown) =>
  runId === turn.runId || (typeof runId === "string" && turn.steers.has(runId));

function sendKeyOf(row: Record<string, unknown>): string | undefined {
  const meta = row.__openclaw as { idempotencyKey?: unknown } | undefined;
  const key = meta?.idempotencyKey ?? row.idempotencyKey;
  return typeof key === "string" ? key.replace(/:user$/, "") : undefined;
}

/** Tools the chat doesn't show as steps: a yield is the turn waiting, not something it did. */
const UNSHOWN_TOOLS = new Set(["sessions_yield"]);

function transcript(messages: Record<string, unknown>[]): ChatSessionMessage[] {
  const unshown = new Set(
    messages.flatMap((m) => {
      const meta = m.__openclaw as { toolOutput?: { source?: string } } | undefined;
      if (m.role === "toolResult" && meta?.toolOutput?.source === "provider-response")
        return [m.toolCallId];
      if (m.role !== "assistant" || !Array.isArray(m.content)) return [];
      return (m.content as Record<string, unknown>[])
        .filter((part) => part.type === "toolCall" && UNSHOWN_TOOLS.has(String(part.name)))
        .map((part) => part.id);
    }),
  );
  return messages.flatMap((m): ChatSessionMessage[] => {
    if (m.role === "user") return [{ role: "user", text: textOf(m) }];
    if (m.role === "toolResult")
      return unshown.has(m.toolCallId)
        ? []
        : [{ role: "tool", text: textOf(m), toolName: String(m.toolName ?? "") }];
    if (m.role !== "assistant") return [];
    const toolCalls = (Array.isArray(m.content) ? (m.content as Record<string, unknown>[]) : [])
      .filter((part) => part.type === "toolCall" && !unshown.has(part.id))
      .map((part) => openClawStep(String(part.name ?? "tool"), part.arguments));
    const text = textOf(m);
    if (!text && toolCalls.length === 0) return [];
    return [{ role: "assistant", text, ...(toolCalls.length > 0 ? { toolCalls } : {}) }];
  });
}

const MAX_TOOL_OUTPUT = 20_000;

/** A tool result's text (a `tool` event's `result`, or a transcript row). */
export function toolOutput(result: unknown): string {
  const text = (typeof result === "string" ? result : textOf(result)).trim();
  return text.length > MAX_TOOL_OUTPUT ? `${text.slice(0, MAX_TOOL_OUTPUT)}…` : text;
}

const runOf = (row: Record<string, unknown>) =>
  (row.__openclaw as { runId?: unknown } | undefined)?.runId;

/** Whether the rows end with an accepted `sessions_yield`: the run's continuation hasn't come yet. */
export function waitingOnYield(rows: Record<string, unknown>[]): boolean {
  const at = rows.findLastIndex(
    (m) =>
      m.role === "toolResult" && m.toolName === "sessions_yield" && /"yielded"/.test(textOf(m)),
  );
  if (at < 0) return false;
  const run = runOf(rows[at]);
  return rows.slice(at + 1).every((m) => m.role === "assistant" && runOf(m) === run && !textOf(m));
}

type RunState = {
  found: boolean;
  messages: ChatSessionMessage[];
  /** Runs going in the session: the turn's, or (while it waits on a yield) its continuation. */
  active: string[];
  waiting: boolean;
};

/**
 * Rows grouped by run into what each turn showed: a run that starts after one
 * that yielded is its continuation, one after a message sent mid-turn (a
 * steer) that message's run; any other is a turn of its own. A message sent
 * after a yield starts a turn of its own, as it does in the chat.
 */
export function runChains(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const chains: Record<string, unknown>[][] = [];
  let run: unknown;
  let steered = false;
  for (const row of rows) {
    const id = runOf(row) ?? run;
    const last = chains.at(-1);
    const sentAfterYield = row.role === "user" && last !== undefined && waitingOnYield(last);
    if (!last || sentAfterYield || (id !== run && !steered && !waitingOnYield(last)))
      chains.push([row]);
    else last.push(row);
    if (row.role === "user") steered = true;
    else if (id !== run) steered = false;
    run = id;
  }
  return chains;
}

/** A turn's rows: from its message (or a run the agent started, its first row), its chain. */
export function turnRows(
  rows: Record<string, unknown>[],
  requestId: string,
  runId: string,
): Record<string, unknown>[] | null {
  const start = requestId.startsWith(AGENT_RUN)
    ? rows.findIndex((m) => runOf(m) === runId)
    : rows.findLastIndex((m) => m.role === "user" && sendKeyOf(m) === requestId) + 1;
  if (requestId.startsWith(AGENT_RUN) ? start < 0 : start === 0) return null;
  return runChains(rows.slice(start))[0] ?? [];
}

async function runState(turn: Turn): Promise<RunState> {
  const result = await turn.gateway.client.request<{
    messages?: Record<string, unknown>[];
    sessionInfo?: { hasActiveRun?: boolean; activeRunIds?: string[] };
  }>("chat.history", { sessionKey: turn.sessionKey, limit: 200 });
  const all = result.messages ?? [];
  const rows = turnRows(all, turn.requestId, turn.runId);
  const info = result.sessionInfo ?? {};
  // A continuation joins the chain: anything after it (a message sent since) ends the wait.
  const last = rows?.at(-1);
  const waiting = rows && last ? waitingOnYield(rows) && all.at(-1) === last : false;
  const chain = new Set((rows ?? []).map(runOf));
  const ids = info.activeRunIds ?? (info.hasActiveRun ? [turn.runId] : []);
  return {
    found: rows !== null,
    messages: rows ? transcript(rows) : [],
    // While it waits on a yield, the run that starts is its continuation.
    active: ids.filter((id) => ownsRun(turn, id) || chain.has(id) || waiting),
    waiting,
  };
}

function askApproval(turn: Turn, payload: Record<string, unknown>): void {
  const request = (payload.request ?? {}) as Record<string, unknown>;
  if (request.sessionKey !== turn.sessionKey || typeof payload.id !== "string") return;
  const approval: ApprovalRequest = {
    id: payload.id,
    kind: "command",
    title: "Command approval",
    detail: String(request.command ?? request.commandPreview ?? "") || undefined,
    choices: ["once", "always", "deny"],
  };
  approvals.set(approval.id, { requestId: turn.requestId, approval });
  turn.emit({ requestId: turn.requestId, type: "approval", approval });
}

async function sessionName(turn: Turn, key: string): Promise<string> {
  const { session } = await turn.gateway.client
    .request<{ session?: Record<string, unknown> }>("sessions.describe", { key })
    .catch(() => ({ session: undefined }));
  const name = session?.label ?? session?.displayName ?? session?.derivedTitle;
  return typeof name === "string" && name ? name : "a subagent";
}

async function askSessionApproval(
  turn: Turn,
  snapshot: Record<string, unknown>,
  source: unknown,
): Promise<void> {
  const id = snapshot.id;
  const p = (snapshot.presentation ?? {}) as Record<string, unknown>;
  if (typeof id !== "string" || snapshot.status !== "pending" || approvals.has(id)) return;
  if (p.kind !== "exec" && p.kind !== "plugin") return;
  if (typeof source === "string" && source !== turn.sessionKey) {
    turn.descendants.set(source, Promise.resolve(true));
  }
  const choices = ((p.allowedDecisions ?? []) as string[]).flatMap((d) => CHOICES[d] ?? []);
  const approval: ApprovalRequest =
    p.kind === "exec"
      ? {
          id,
          kind: "command",
          title: "Command approval",
          detail: String(p.commandText ?? "") || undefined,
          choices,
        }
      : {
          id,
          kind: "tool",
          title: String(p.title ?? "") || "Tool approval",
          detail: String(p.description ?? "") || undefined,
          choices,
        };
  approvals.set(id, { requestId: turn.requestId, approval, kind: p.kind });
  if (typeof source === "string" && source !== turn.sessionKey)
    approval.reason = `Asked by ${await sessionName(turn, source)}`;
  if (approvals.get(id)?.approval !== approval) return;
  turn.emit({ requestId: turn.requestId, type: "approval", approval });
}

function approvalResolved(turn: Turn, id: unknown): void {
  if (typeof id === "string" && approvals.delete(id))
    turn.emit({ requestId: turn.requestId, type: "approvalResolved", approvalId: id });
}

function descends(turn: Turn, key: string): Promise<boolean> {
  let known = turn.descendants.get(key);
  if (!known) {
    known = (async () => {
      let current = key;
      for (let depth = 0; depth < 8; depth++) {
        const { session } = await turn.gateway.client.request<{
          session?: { parentSessionKey?: unknown; spawnedBy?: unknown };
        }>("sessions.describe", { key: current });
        const parent = session?.parentSessionKey ?? session?.spawnedBy;
        if (typeof parent !== "string" || !parent) return false;
        if (parent === turn.sessionKey) return true;
        current = parent;
      }
      return false;
    })().catch(() => false);
    turn.descendants.set(key, known);
  }
  return known;
}

async function askQuestion(turn: Turn, record: Record<string, unknown>): Promise<void> {
  if (typeof record.id !== "string" || typeof record.sessionKey !== "string") return;
  if (record.status !== "pending") return;
  if (record.sessionKey === turn.sessionKey) {
    if (record.runId && !ownsRun(turn, record.runId)) return;
  } else if (!(await descends(turn, record.sessionKey))) return;
  if (questions.has(record.id)) return;
  const question: ChatQuestion = {
    id: record.id,
    questions: ((record.questions ?? []) as Record<string, unknown>[]).map((q) => ({
      id: String(q.questionId),
      header: String(q.header ?? ""),
      question: String(q.question ?? ""),
      options: ((q.options ?? []) as { label: string; description?: string }[]).map((o) => ({
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
      })),
      multiSelect: q.multiSelect === true,
      secret: q.isSecret === true,
    })),
    expiresAt: Number(record.expiresAtMs) || 0,
  };
  questions.set(question.id, { requestId: turn.requestId, question });
  turn.emit({ requestId: turn.requestId, type: "question", question });
}

// Gateways before 2026.7 refuse `includeApprovals`; their exec approvals are listed instead.
async function watch(turn: Turn): Promise<void> {
  const { client } = turn.gateway;
  const key = turn.sessionKey;
  const subscribed = await client
    .request<{ approvalReplay?: { approvals?: Record<string, unknown>[] } }>(
      "sessions.messages.subscribe",
      { key, includeApprovals: true },
    )
    .catch(() => null);
  turn.sessionApprovals = subscribed !== null;
  if (!subscribed)
    void client
      .request("sessions.messages.subscribe", { key })
      .catch((error: unknown) =>
        logger.info("agent", "openclaw transcript watch failed", { error: String(error) }),
      );
  const [pendingApprovals, pendingQuestions] = await Promise.all([
    subscribed
      ? (subscribed.approvalReplay?.approvals ?? [])
      : client.request<Record<string, unknown>[]>("exec.approval.list", {}).catch(() => []),
    // Needs `operator.questions`, which a device paired before may not have yet.
    client
      .request<{ questions?: Record<string, unknown>[] }>("question.list", {})
      .catch(() => ({ questions: [] })),
  ]);
  await Promise.all([
    ...pendingApprovals.map((payload) =>
      subscribed
        ? askSessionApproval(turn, payload, payload.sourceSessionKey)
        : approvals.has(String(payload.id))
          ? undefined
          : askApproval(turn, payload),
    ),
    ...(pendingQuestions.questions ?? []).map((record) => askQuestion(turn, record)),
  ]);
}

function catchUp(turn: Turn, state: RunState): void {
  turn.resynced = true;
  turn.emit({ requestId: turn.requestId, type: "transcript", messages: state.messages });
  turn.text.replay();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Follows a run until it ends. The gateway sends every connection its
 * sessions' events, so when the socket drops the run is picked up again on
 * the next one, and what went unseen is read from the transcript. A run
 * that goes quiet (a long command) is asked after, not given up on.
 */
async function follow(
  turn: Turn,
  settings: OpenClawSettings,
  start: () => Promise<void>,
): Promise<void> {
  const { requestId, sessionKey, emit } = turn;
  let ended: (() => void) | null = null;
  const finished = new Promise<void>((resolve) => (ended = resolve));
  turn.finish = (event) => {
    if (!ended) return;
    emit(event);
    ended();
    ended = null;
  };
  turns.set(requestId, turn);

  const open = new Set<string>();
  /** Steps whose result came without the output: the transcript has it. */
  const bare = new Set<string>();
  // What went unseen (a dropped socket), never ended (a step whose result
  // didn't come) or came bare is read from the transcript before the turn ends.
  const settle = async (state?: RunState) => {
    turn.ending = true;
    if (turn.resynced || open.size > 0 || bare.size > 0) {
      try {
        state ??= await runState(turn);
        if (ended) emit({ requestId, type: "transcript", messages: state.messages });
      } catch (error) {
        logger.info("agent", "openclaw transcript unavailable", { error: String(error) });
      }
    }
    turn.finish({ requestId, type: "done", responseId: null });
  };

  const adopt = (runId: string) => {
    // A message sent meanwhile (from any device) starts a run of its own.
    if (ownsRun(turn, runId) || sent.has(runId)) return;
    logger.info("agent", "openclaw run continues the turn", { requestId, runId });
    // The runs before it yielded: they're over.
    for (const id of [turn.runId, ...turn.steers]) turn.finals.add(id);
    turn.steers.add(runId);
    announced.add(runId);
    turn.yielded = false;
    turn.text.nextRun();
  };

  let quiet: ReturnType<typeof setTimeout> | undefined;
  const hush = () => {
    clearTimeout(quiet);
    quiet = setTimeout(() => void check(), QUIET_MS);
  };
  const check = async () => {
    try {
      const state = await runState(turn);
      if (!ended) return;
      turn.yielded = state.waiting;
      for (const id of state.active) adopt(id);
      if (state.active.length > 0 || turn.yielded) hush();
      else {
        turn.resynced = true;
        await settle(state);
      }
    } catch {
      hush();
    }
  };

  const reconnect = async () => {
    clearTimeout(quiet);
    for (const delay of RECONNECT_DELAYS_MS) {
      await sleep(delay);
      if (!ended) return;
      try {
        turn.gateway = await gateway(settings);
        turn.text = new OpenClawText(requestId, emit);
        const state = await runState(turn);
        if (!ended) return;
        logger.info("agent", "openclaw run picked up again", {
          requestId,
          active: state.active.length,
          waiting: state.waiting,
        });
        turn.resynced = true;
        turn.yielded = state.waiting;
        for (const id of state.active) adopt(id);
        if (state.active.length === 0 && !turn.yielded) return await settle(state);
        catchUp(turn, state);
        await watch(turn);
        return hush();
      } catch (error) {
        logger.info("agent", "openclaw reconnect failed", { requestId, error: String(error) });
      }
    }
    turn.finish({ requestId, type: "error", message: "detached" });
  };

  const seen = new Set<string>();
  const unshown = new Set<string>();
  const startStep = (id: string | undefined, name: string, args: unknown) => {
    if (id?.startsWith("tool_call:")) return;
    if (id && seen.has(`${id}:start`)) return;
    if (id) seen.add(`${id}:start`);
    if (UNSHOWN_TOOLS.has(name)) {
      if (id) unshown.add(id);
      return;
    }
    if (id) open.add(id);
    turn.text.boundary();
    emit({ requestId, type: "tool", id, step: openClawStep(name, args) });
  };
  /** The first end that has the output wins; one without it ("item" ends) only closes the step. */
  const endStep = (id: string | undefined, failed: boolean, result?: unknown) => {
    if (id?.startsWith("tool_call:") || (id && unshown.has(id))) return;
    const output = toolOutput(result);
    const reported = result !== undefined;
    if (id && (seen.has(`${id}:output`) || (seen.has(`${id}:done`) && !output))) return;
    if (id) {
      seen.add(`${id}:done`);
      if (output) seen.add(`${id}:output`);
      open.delete(id);
      if (reported) bare.delete(id);
      else if (!output) bare.add(id);
    }
    emit({ requestId, type: "toolResult", id, output: output || (failed ? "(failed)" : "(done)") });
  };
  const onEvent = ({ event, payload }: EventFrame) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    if (event === "session.approval") {
      if (p.sessionKey !== sessionKey) return;
      const snapshot = (p.approval ?? {}) as Record<string, unknown>;
      if (p.phase === "pending") void askSessionApproval(turn, snapshot, p.sourceSessionKey);
      else approvalResolved(turn, snapshot.id);
      return;
    }
    if (event === "exec.approval.requested") {
      if (!turn.sessionApprovals) askApproval(turn, p);
      return;
    }
    if (event === "exec.approval.resolved") return approvalResolved(turn, p.id);
    if (event === "question.requested") return void askQuestion(turn, p);
    if (event === "question.resolved") {
      if (typeof p.id === "string" && questions.delete(p.id))
        emit({ requestId, type: "questionResolved", questionId: p.id });
      return;
    }
    if (p.sessionKey !== sessionKey) return;
    if (event === "session.message") {
      if (!turn.resynced) return;
      const row = (p.message ?? {}) as Record<string, unknown>;
      const meta = (row.__openclaw ?? {}) as {
        runId?: string;
        mirrorOrigin?: unknown;
        toolOutput?: { source?: string };
      };
      if ((meta.runId && !ownsRun(turn, meta.runId)) || meta.mirrorOrigin) return;
      if (meta.toolOutput?.source === "provider-response") return;
      hush();
      if (row.role === "assistant" && Array.isArray(row.content))
        for (const part of row.content as Record<string, unknown>[]) {
          if (part.type === "toolCall")
            startStep(
              typeof part.id === "string" ? part.id : undefined,
              String(part.name ?? "tool"),
              part.arguments,
            );
        }
      if (row.role === "toolResult")
        endStep(
          typeof row.toolCallId === "string" ? row.toolCallId : undefined,
          row.isError === true,
          row,
        );
      return;
    }
    // A steer's run may end before its id is back from `chat.send`.
    if (event === "chat" && p.state === "final" && typeof p.runId === "string")
      turn.finals.add(p.runId);
    if (
      turn.yielded &&
      event === "agent" &&
      p.stream === "lifecycle" &&
      (p.data as { phase?: unknown } | undefined)?.phase === "start" &&
      typeof p.runId === "string"
    )
      adopt(p.runId);
    if (p.runId && !ownsRun(turn, p.runId)) return;
    hush();
    if (event === "agent" && p.stream === "assistant") {
      turn.text.assistant((p.data ?? {}) as Record<string, unknown>);
      return;
    }
    if (event === "agent" && p.stream === "item") {
      const data = (p.data ?? {}) as Record<string, unknown>;
      if (data.kind === "preamble" && typeof data.progressText === "string")
        turn.text.preamble(
          typeof data.itemId === "string" ? data.itemId : undefined,
          data.progressText,
          data.phase === "end",
        );
      else if (data.kind === "tool" && data.phase === "end" && typeof data.toolCallId === "string")
        endStep(data.toolCallId, data.status === "failed");
      return;
    }
    if (event === "agent" && p.stream === "tool") {
      const data = (p.data ?? {}) as Record<string, unknown>;
      const id = typeof data.toolCallId === "string" ? data.toolCallId : undefined;
      if (data.phase === "start") startStep(id, String(data.name ?? "tool"), data.args);
      else if (data.phase === "result") endStep(id, data.isError === true, data.result);
      return;
    }
    if (event !== "chat") return;
    switch (p.state) {
      case "delta":
        turn.text.chat(p);
        break;
      case "final":
        turn.text.chat(p, true);
        clearTimeout(quiet);
        if (p.yielded === true) {
          turn.yielded = true;
          hush();
        } else if ([turn.runId, ...turn.steers].every((id) => turn.finals.has(id))) void settle();
        else void check();
        break;
      case "aborted":
        turn.finish({ requestId, type: "error", message: "cancelled" });
        break;
      case "error":
        turn.finish({
          requestId,
          type: "error",
          message: `agent_error: ${String(p.errorMessage ?? "The run failed.")}`,
        });
        break;
    }
  };
  const onClose = (client: Gateway["client"]) => {
    if (client === turn.gateway.client) void reconnect();
  };
  listeners.add(onEvent);
  closeListeners.add(onClose);
  try {
    hush();
    await start();
    await finished;
  } catch (error) {
    logger.info("agent", "openclaw turn failed", { requestId, error: String(error) });
    turn.finish({
      requestId,
      type: "error",
      message: `agent_error: ${error instanceof Error ? error.message : String(error)}`,
    });
  } finally {
    clearTimeout(quiet);
    listeners.delete(onEvent);
    closeListeners.delete(onClose);
    turns.delete(requestId);
    for (const [approvalId, owner] of approvals) {
      if (owner.requestId !== requestId) continue;
      approvals.delete(approvalId);
      emit({ requestId, type: "approvalResolved", approvalId });
    }
    for (const [questionId, owner] of questions) {
      if (owner.requestId !== requestId) continue;
      questions.delete(questionId);
      emit({ requestId, type: "questionResolved", questionId });
    }
    void turn.gateway.client
      .request("sessions.messages.unsubscribe", { key: sessionKey })
      .catch(() => {});
  }
}

type Watching = {
  settings: OpenClawSettings;
  sessions: Map<string, number>;
  started: (run: AgentRun) => void;
};

let watching: Watching | null = null;
let watchedClient: Gateway["client"] | null = null;
let rewatch: ReturnType<typeof setTimeout> | undefined;
/** Runs already reported, or another device's continuation. */
const announced = new Set<string>();
/** Runs of messages sent to a watched session, from any device. */
const sent = new Set<string>();
/** Sessions whose run yielded: the run that starts next is its continuation, followed where it was sent. */
const continuing = new Set<string>();

function announce(sessionKey: string, runId: string): void {
  if (!watching?.sessions.has(sessionKey) || announced.has(runId) || sent.has(runId)) return;
  for (const turn of turns.values())
    if (turn.sessionKey === sessionKey && (!turn.ending || ownsRun(turn, runId))) return;
  announced.add(runId);
  logger.info("agent", "openclaw run of its own", { runId });
  watching.started({ sessionId: sessionKey, requestId: `${AGENT_RUN}${runId}` });
}

listeners.add(({ event, payload }) => {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.sessionKey !== "string" || !watching?.sessions.has(p.sessionKey)) return;
  const row = p.message as Record<string, unknown> | undefined;
  const key = event === "session.message" && row?.role === "user" ? sendKeyOf(row) : undefined;
  if (key) {
    sent.add(key);
    // A message sent from elsewhere after a yield ends the turn waiting on it, as one sent here does.
    for (const turn of turns.values())
      if (turn.sessionKey === p.sessionKey && turn.yielded && !ownsRun(turn, key)) {
        continuing.delete(turn.sessionKey);
        turn.finish({ requestId: turn.requestId, type: "done", responseId: null });
      }
  }
  if (event === "chat" && p.state === "final" && p.yielded === true) continuing.add(p.sessionKey);
  const phase = (p.data as { phase?: unknown } | undefined)?.phase;
  if (event !== "agent" || p.stream !== "lifecycle" || phase !== "start") return;
  if (typeof p.runId !== "string") return;
  // Only the first run after a yield can be its continuation, whatever it is.
  const continues = continuing.delete(p.sessionKey) && !sent.has(p.runId);
  if (continues) announced.add(p.runId);
  else announce(p.sessionKey, p.runId);
});

closeListeners.add((client) => {
  if (client !== watchedClient) return;
  watchedClient = null;
  scheduleWatch(RECONNECT_DELAYS_MS[0]);
});

function scheduleWatch(delay: number): void {
  clearTimeout(rewatch);
  rewatch = setTimeout(() => void ensureWatching(delay), delay);
}

async function ensureWatching(delay = 0): Promise<void> {
  if (!watching || watching.sessions.size === 0) return;
  try {
    const g = await gateway(watching.settings);
    if (g.client === watchedClient) return;
    await g.client.request("sessions.subscribe", {});
    // What yielded while this device wasn't listening is read from history now.
    continuing.clear();
    await catchUpSessions(g);
    watchedClient = g.client;
  } catch (error) {
    logger.info("agent", "openclaw watch failed", { error: String(error) });
    scheduleWatch(Math.min(Math.max(delay * 2, RECONNECT_DELAYS_MS[0]), 60_000));
  }
}

/**
 * Chats to catch up on whatever their last activity, from their last message
 * on (one just watched, or whose turn was just picked up again), until a catch-up gets through.
 */
const fresh = new Set<string>();

/** Runs the agent started while this device wasn't listening: going now, or written since the chat last ended. */
async function catchUpSessions(g: Gateway): Promise<void> {
  const caught = new Set(fresh);
  const { sessions } = await g.client.request<{ sessions?: Record<string, unknown>[] }>(
    "sessions.list",
    { limit: 200 },
  );
  for (const row of sessions ?? []) {
    const key = String(row.key);
    const watched = watching?.sessions.get(key);
    if (watched === undefined) continue;
    const since = fresh.has(key) ? 0 : watched;
    const active = (row.activeRunIds as string[] | undefined) ?? [];
    const activity = Number(row.lastActivityAt ?? row.updatedAt) || 0;
    if (active.length === 0 && activity <= since) continue;
    const { messages } = await g.client.request<{ messages?: Record<string, unknown>[] }>(
      "chat.history",
      { sessionKey: key, limit: 200 },
    );
    for (const id of agentRunsSince(messages ?? [], since, active)) announce(key, id);
  }
  for (const key of caught) fresh.delete(key);
}

/**
 * Runs the agent started after the last message sent to the session (not that
 * message's run or its continuations): those since `since` that have something
 * to show, and those going now, written or not.
 */
export function agentRunsSince(
  rows: Record<string, unknown>[],
  since: number,
  active: string[] = [],
): string[] {
  const sent = rows.findLastIndex((m) => m.role === "user" && sendKeyOf(m));
  const chains = runChains(rows.slice(sent + 1));
  const own = sent < 0 ? undefined : sendKeyOf(rows[sent]);
  const written = chains.flatMap((chain) => {
    const run = runOf(chain[0]);
    if (typeof run !== "string" || run === own) return [];
    const at = Number((chain[0].__openclaw as { recordTimestampMs?: unknown })?.recordTimestampMs);
    const shown = transcript(chain).some((m) => m.role === "assistant");
    const going = chain.some((m) => active.includes(runOf(m) as string));
    return going || (at > since && shown) ? [run] : [];
  });
  const known = new Set(rows.map(runOf));
  const continuing = chains.length > 0 && waitingOnYield(chains[chains.length - 1]);
  const unwritten = active.filter((id) => !known.has(id) && id !== own && !continuing);
  return [...written, ...unwritten];
}

export const openClawProvider: ChatProvider<OpenClawSettings> = {
  kind: "openclaw",
  displayName: "OpenClaw",
  defaults: OPENCLAW_DEFAULTS,
  fields: { enabled: "boolean", model: "string" },
  localOnly: true,
  async settingsView() {
    return {
      hasToken: await hasOpenClawCredentials(),
      pairingRequest: openClawPairingRequest(),
      questions: openClawQuestions(),
    };
  },

  async checkStatus(settings) {
    const base = {
      kind: "openclaw" as const,
      displayName: "OpenClaw",
      version: null,
      models: [],
      model: null,
      sessions: true,
    };
    if (!settings.url || !(await credentials())) {
      return {
        ...base,
        installed: false,
        status: "warning",
        auth: { status: "unknown" },
        message: "Paste a setup code to connect.",
      };
    }
    try {
      const g = await gateway(settings);
      const [{ defaultId, agents }, me] = await Promise.all([listAgents(g), whoAmI(g)]);
      return {
        ...base,
        installed: true,
        status: "ready",
        auth: { status: "authenticated", ...me },
        models: agents.map((agent) => ({
          slug: agent.id,
          name: agent.identity?.name ?? agent.name ?? agent.id,
          ...(agent.id === defaultId ? { isDefault: true } : {}),
          avatar: agentAvatar(agent),
          emoji: agent.identity?.emoji,
        })),
        message: new URL(settings.url).host,
      };
    } catch (error) {
      const code = connectError(error);
      logger.info("agent", "openclaw check failed", { code, error: String(error) });
      return {
        ...base,
        installed: code !== "unreachable",
        status: code === "pairing_required" ? "warning" : "error",
        auth: { status: code === "unreachable" ? "unknown" : "unauthenticated" },
        message:
          code === "pairing_required"
            ? "Approve this device on the gateway."
            : code === "origin_not_allowed"
              ? "The gateway doesn't allow this site yet."
              : code === "unauthorized"
                ? "The gateway refused the setup code or token — make a new setup code."
                : "Can't reach the gateway — are you on Tailscale?",
      };
    }
  },

  async sendTurn(input, settings, emit) {
    const { requestId } = input;
    let g: Gateway;
    try {
      g = await gateway(settings);
    } catch (error) {
      return emit({ requestId, type: "error", message: connectError(error) });
    }

    let sessionKey = input.sessionId;
    if (!sessionKey) {
      const agentId = settings.model || (await listAgents(g)).defaultId;
      sessionKey = `agent:${agentId}:otter-mail:${crypto.randomUUID()}`;
      emit({ requestId, type: "session", sessionId: sessionKey });
    }

    let attachments: unknown[];
    try {
      attachments = await Promise.all(
        (input.attachments ?? []).map(async (a) => ({
          type: a.kind,
          mimeType: a.mime,
          fileName: a.name,
          content: toBase64(await readAttachment(a)),
        })),
      );
    } catch (error) {
      return emit({
        requestId,
        type: "error",
        message: `agent_error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const turn = newTurn(requestId, sessionKey, g, emit);
    await follow(turn, settings, async () => {
      const sent = await g.client.request<{ runId?: string }>("chat.send", {
        sessionKey,
        message: input.input,
        idempotencyKey: requestId,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
      turn.runId = sent.runId ?? requestId;
      await watch(turn);
    });
  },

  /**
   * A run the panel lost track of (the app quit, the window closed): still
   * followed here → the panel gets the run so far; else it's found on the
   * gateway by its send, shown as far as it got, and followed if it's going.
   */
  async resume({ requestId, sessionId }, settings, emit) {
    const following = turns.get(requestId);
    if (following) {
      try {
        catchUp(following, await runState(following));
      } catch (error) {
        logger.info("agent", "openclaw transcript unavailable", { error: String(error) });
      }
      for (const { requestId: owner, approval } of approvals.values())
        if (owner === requestId) emit({ requestId, type: "approval", approval });
      for (const { requestId: owner, question } of questions.values())
        if (owner === requestId) emit({ requestId, type: "question", question });
      return;
    }
    let turn: Turn;
    let state: RunState;
    try {
      turn = newTurn(requestId, sessionId, await gateway(settings), emit);
      state = await runState(turn);
    } catch (error) {
      logger.info("agent", "openclaw resume failed", { requestId, error: String(error) });
      return emit({ requestId, type: "error", message: "detached" });
    }
    logger.info("agent", "openclaw resume", {
      requestId,
      found: state.found,
      active: state.active.length,
      waiting: state.waiting,
    });
    const agentRun = requestId.startsWith(AGENT_RUN);
    // A run the agent started may not have written anything yet.
    if (!state.found && !(agentRun && state.active.includes(turn.runId)))
      return emit(
        agentRun
          ? { requestId, type: "done", responseId: null }
          : { requestId, type: "error", message: "not_received" },
      );
    catchUp(turn, state);
    turn.yielded = state.waiting;
    for (const id of state.active)
      if (id !== turn.runId) {
        turn.steers.add(id);
        announced.add(id);
      }
    if (!state.active.includes(turn.runId)) turn.finals.add(turn.runId);
    if (state.active.length === 0 && !state.waiting)
      return emit({ requestId, type: "done", responseId: null });
    await follow(turn, settings, () => watch(turn));
  },

  cancel(requestId) {
    const turn = turns.get(requestId);
    if (!turn) return;
    // Waiting on a yield, no run is going to report it stopped, or continue it.
    const waiting = turn.yielded;
    if (waiting) continuing.delete(turn.sessionKey);
    void turn.gateway.client
      .request("chat.abort", {
        sessionKey: turn.sessionKey,
        ...(turn.steers.size > 0 || waiting ? {} : { runId: turn.runId }),
      })
      .then(
        () => waiting && turn.finish({ requestId, type: "error", message: "cancelled" }),
        () => turn.finish({ requestId, type: "error", message: "cancelled" }),
      );
  },

  async steer(requestId, input) {
    const turn = turns.get(requestId);
    if (!turn) return false;
    // A message sent after a hand-off starts a turn of its own; the
    // continuation, when it comes, is a run the agent started.
    if (turn.yielded) {
      continuing.delete(turn.sessionKey);
      turn.finish({ requestId, type: "done", responseId: null });
      return false;
    }
    // The gateway runs a send under its key: the turn owns it before its message
    // row can arrive, which would otherwise read as one sent from elsewhere.
    const key = crypto.randomUUID();
    turn.steers.add(key);
    try {
      const sent = await turn.gateway.client.request<{ runId?: string }>("chat.send", {
        sessionKey: turn.sessionKey,
        message: input,
        idempotencyKey: key,
        queueMode: "steer",
      });
      if (sent.runId) turn.steers.add(sent.runId);
      return true;
    } catch {
      turn.steers.delete(key);
      return false;
    }
  },

  async respondApproval(requestId, approvalId, decision) {
    const turn = turns.get(requestId);
    const owner = approvals.get(approvalId);
    if (!turn || owner?.requestId !== requestId) return;
    await turn.gateway.client.request(owner.kind ? "approval.resolve" : "exec.approval.resolve", {
      id: approvalId,
      decision: DECISIONS[decision],
      ...(owner.kind ? { kind: owner.kind } : {}),
    });
    approvals.delete(approvalId);
    turn.emit({ requestId, type: "approvalResolved", approvalId });
  },

  async answerQuestion(requestId, questionId, answers) {
    const turn = turns.get(requestId);
    if (!turn || questions.get(questionId)?.requestId !== requestId) return;
    await turn.gateway.client.request(
      "question.resolve",
      answers ? { id: questionId, answers: { answers } } : { id: questionId, cancel: true },
    );
    questions.delete(questionId);
    turn.emit({ requestId, type: "questionResolved", questionId });
  },

  async listSkills() {
    return [];
  },

  async listSessions(settings, limit) {
    const g = await gateway(settings);
    const result = await g.client.request<{ sessions?: Record<string, unknown>[] }>(
      "sessions.list",
      {
        limit,
        includeDerivedTitles: true,
        includeLastMessage: true,
        excludeCron: true,
        excludeSubagents: true,
        excludeSystem: true,
      },
    );
    return (result.sessions ?? []).map((s): ChatSession => ({
      id: String(s.key),
      title:
        String(s.derivedTitle ?? s.displayName ?? s.label ?? "") || (s.isMain ? "Main chat" : null),
      source: String(s.agentId ?? "openclaw"),
      lastActive: Number(s.updatedAt) || 0,
      messageCount: s.lastMessagePreview ? 1 : 0,
      preview: s.lastMessagePreview ? String(s.lastMessagePreview) : null,
    }));
  },

  async readSession(settings, sessionId) {
    const g = await gateway(settings);
    const result = await g.client.request<{ messages?: Record<string, unknown>[] }>(
      "chat.history",
      { sessionKey: sessionId, limit: 500 },
    );
    return transcript(result.messages ?? []);
  },

  async readFile(settings, sessionId, href) {
    if (!sessionId) throw new Error("Open the image from its OpenClaw chat.");
    const g = await gateway(settings);
    if (href.startsWith("otter-artifact:")) {
      const result = await g.client.request<{
        artifact: { title: string; mimeType?: string };
        data?: string;
        encoding?: string;
        url?: string;
      }>("artifacts.download", {
        sessionKey: sessionId,
        artifactId: decodeURIComponent(href.slice("otter-artifact:".length)),
      });
      if (result.encoding === "base64" && result.data)
        return chatFile(result.artifact.title, fromBase64(result.data), result.artifact.mimeType);
      if (result.url) {
        const base = `${settings.url.replace(/^ws/i, "http").replace(/\/$/, "")}/`;
        const file = await downloadChatFile(new URL(result.url.replace(/^\//, ""), base).href);
        return {
          ...file,
          name: result.artifact.title,
          mimeType: result.artifact.mimeType || file.mimeType,
        };
      }
      throw new Error("OpenClaw hasn't made this image available to download.");
    }
    const path = chatFilePath(href);
    if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(path)) {
      const ref = encodeURIComponent(path.split("/").pop() || "image");
      const result = await g.client.request<{
        assets: { content?: string; mimeType?: string; error?: string }[];
      }>("sessions.files.assets", { sessionKey: sessionId, path, refs: [ref] });
      const asset = result.assets[0];
      if (asset?.content !== undefined)
        return chatFile(
          path.split("/").pop() || "Image",
          fromBase64(asset.content),
          asset.mimeType,
        );
      throw new Error("OpenClaw couldn't read this image. Ask it to attach the image directly.");
    }
    // The gateway serves only files in the agent's workspace: one it wrote
    // elsewhere on its machine (/tmp, say) can't be read from here.
    const unreadable =
      "This file is outside the agent's workspace on the OpenClaw machine. Ask it to save the file in its workspace, or attach it.";
    const result = await g.client
      .request<{
        file?: { name?: string; content?: string; contentEncoding?: string; mimeType?: string };
        reason?: string;
      }>("sessions.files.get", { sessionKey: sessionId, path })
      .catch((error: unknown) => {
        throw /not found|outside/i.test(String(error)) ? new Error(unreadable) : error;
      });
    if (result.file?.content === undefined) throw new Error(unreadable);
    const bytes =
      result.file.contentEncoding === "base64"
        ? fromBase64(result.file.content)
        : utf8Encode(result.file.content);
    return chatFile(
      result.file.name || path.split("/").pop() || "Image",
      bytes,
      result.file.mimeType,
    );
  },

  async deleteSession(settings, sessionId) {
    const g = await gateway(settings);
    await g.client.request("sessions.delete", { key: sessionId });
  },

  watch(settings, sessions, started) {
    const next = new Map(sessions.map((s) => [s.id, s.since]));
    const before = watching?.sessions;
    // A chat watched after the first, or whose turn was picked up again (it caught up on nothing meanwhile).
    for (const [id, since] of next) {
      const was = before?.get(id);
      if (before && (was === undefined || (was === Number.MAX_SAFE_INTEGER && since !== was)))
        fresh.add(id);
    }
    watching = { settings, sessions: next, started };
    if (next.size === 0) return;
    if (fresh.size > 0 && watchedClient)
      void current?.ready.then(catchUpSessions).catch(() => {
        watchedClient = null;
        scheduleWatch(RECONNECT_DELAYS_MS[0]);
      });
    else void ensureWatching();
  },

  shutdown() {
    watching = null;
    fresh.clear();
    watchedClient = null;
    clearTimeout(rewatch);
    for (const [requestId, turn] of turns)
      turn.finish({ requestId, type: "error", message: "detached" });
    disconnect();
  },
};
