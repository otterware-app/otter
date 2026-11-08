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
} from "@otter/core/extension-kit";
import type {
  ApprovalDecision,
  ApprovalRequest,
  BrowserView,
  BrowserEvents,
  ChatEvent,
  ChatQuestion,
  ChatProvider,
  AgentRun,
  ChatSession,
  ChatSessionMessage,
  Emit,
  ForkPoint,
} from "@otter/core/extension-kit";
import { OPENCLAW_DEFAULTS, type OpenClawSettings } from "./settings.js";
import {
  GatewayBrowserDeviceAuthLifecycle,
  GatewayProtocolClient,
  GatewayProtocolRequestError,
  type EventFrame,
  type GatewayBrowserDeviceAuthPlan,
  type GatewayBrowserDeviceIdentity,
} from "@openclaw/gateway-client/browser";
import { OpenClawText, openClawMessageText as textOf } from "./openclaw-stream.js";
import {
  channelTargets,
  listTasks,
  removeTask,
  runRows,
  runTask,
  saveTask,
  setTaskEnabled,
  taskRuns,
  type CronGateway,
} from "./schedules.js";

const CONNECT_TIMEOUT_MS = 8_000;
/** What a request waits for unless it says otherwise; without one, a request on a dead socket waits forever. */
const REQUEST_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 120_000;
/** The gateway's limit on one message (25 MB), less room for the frame around it. */
const MAX_MESSAGE_BYTES = 24 * 1024 * 1024;
/**
 * What this device asks for: what OpenClaw's own apps hold. The gateway counts
 * a chat's turns as the owner's (its `nodes` tool, its own settings) only from a
 * device with `operator.admin`. A device paired with fewer signs in with the
 * scopes it has, and asks for the rest separately (`allowOpenClawFullAccess`),
 * as the gateway refuses a paired device that just asks for more.
 */
const SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.admin",
  "operator.pairing",
];

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

const base64url = (bytes: Uint8Array) =>
  toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let identity: Promise<GatewayBrowserDeviceIdentity> | null = null;

function deviceIdentity(): Promise<GatewayBrowserDeviceIdentity> {
  identity ??= (async () => {
    let jwk = JSON.parse((await getOpenClawDeviceKey()) || "null") as JsonWebKey | null;
    if (!jwk) {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
      await setOpenClawDeviceKey(JSON.stringify(jwk));
    }
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
    const publicKey = jwk.x ?? "";
    const raw = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
      c.charCodeAt(0),
    );
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", raw));
    return {
      deviceId: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
      publicKey,
      sign: async (payload: string) =>
        base64url(
          new Uint8Array(
            await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(payload)),
          ),
        ),
    };
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
  /** What the gateway says it answers, its plugins' methods included. */
  methods: string[];
};

/** The Otter plugin's: a message sent as the channel's owner (`extensions/openclaw/gateway`). */
const OTTER_SEND = "otter.chat.send";
/** Who the Otter plugin sends as, which `commands.ownerAllowFrom` lists to make it the owner. */
const OTTER_OWNER = "otter:owner";

let fullAccess: boolean | null = null;
let fullAccessRequest: string | null = null;
let fullAccessChanged = () => {};

export function openClawFullAccess(): { allowed: boolean | null; request: string | null } {
  return { allowed: fullAccess, request: fullAccessRequest };
}

const holdsAll = (scopes: string[]) => SCOPES.every((scope) => scopes.includes(scope));

let current: { url: string; ready: Promise<Gateway> } | null = null;
/** Connections reset for new credentials: what was retrying for the old ones stops. */
let resets = 0;
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
    let methods: string[] = [];
    let lastActivity = Date.now();
    let tickWatch: ReturnType<typeof setInterval> | undefined;
    const dropped = () => {
      clearInterval(tickWatch);
      if (current?.url === url) current = null;
      settle(new Error("Can't reach the gateway."));
      for (const listener of closeListeners) listener(client);
    };
    // The gateway ticks every `tickIntervalMs`. A socket that goes quiet (the Mac
    // slept, the network changed) can stay open for minutes without a close, and
    // closing it waits on the dead connection too, so after two missed ticks it's
    // dropped at once, as OpenClaw's own clients do.
    const watchTicks = (intervalMs: number) => {
      clearInterval(tickWatch);
      lastActivity = Date.now();
      tickWatch = setInterval(() => {
        if (!client.connected) return clearInterval(tickWatch);
        if (Date.now() - lastActivity <= intervalMs * 2) return;
        logger.info("agent", "openclaw gateway went quiet", { url });
        client.stop();
        dropped();
      }, intervalMs);
    };
    const settle = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        client.stop();
        reject(error);
      } else resolve({ url, client, scopes, methods });
    };
    const timer = setTimeout(
      () => settle(new Error("The gateway didn't answer.")),
      CONNECT_TIMEOUT_MS,
    );
    const p = platform();
    const clientInfo = {
      id: "gateway-client" as const,
      mode: "ui" as const,
      displayName: `Otter (${p.kind})`,
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
        methods = (hello as { features?: { methods?: string[] } }).features?.methods ?? [];
        fullAccess = holdsAll(scopes);
        watchTicks(hello.policy?.tickIntervalMs ?? 30_000);
        if (bootstrapToken) void clearOpenClawBootstrapToken();
        settle(null);
        if (fullAccess) fullAccessRequest = null;
        else waitForFullAccess(url, client);
        // A watch waiting out its backoff needn't: the gateway is back.
        if (rewatchPending) scheduleWatch(0);
      },
      onConnectFailure: (error) => {
        const details = (error as { details?: { code?: string; requestId?: string } }).details;
        pairingRequest = details?.code === "PAIRING_REQUIRED" ? (details.requestId ?? null) : null;
        settle(error);
        return { closeCode: 1000, closeReason: "connect failed", stop: true, error };
      },
      onConnectError: (error) => {
        pairingRequest = null;
        settle(error);
      },
      resolveClose: () => ({ retry: false, notify: false }),
      onActivity: () => {
        lastActivity = Date.now();
      },
      onClose: dropped,
      onEvent: (event) => {
        for (const listener of listeners) listener(event);
      },
      handshake: { mode: "require-challenge", timeoutMs: CONNECT_TIMEOUT_MS },
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
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

/** Before connecting to `url` with new credentials: nothing goes on reaching the gateway it had. */
export async function resetOpenClawConnection(url: string): Promise<void> {
  resets++;
  if (watching) watching.settings = { ...watching.settings, url };
  for (const [requestId, turn] of turns)
    turn.finish({ requestId, type: "error", message: "detached" });
  disconnect();
  pairingRequest = null;
  fullAccess = null;
  fullAccessRequest = null;
  await clearOpenClawDeviceToken();
}

async function heldScopes(): Promise<string[] | null> {
  const stored = JSON.parse((await getOpenClawDeviceToken()) || "null") as {
    scopes?: string[];
  } | null;
  return stored?.scopes?.length ? stored.scopes : null;
}

export async function allowOpenClawFullAccess(
  settings: OpenClawSettings,
  changed: () => void,
): Promise<void> {
  const g = await gateway(settings);
  if (holdsAll(g.scopes)) return;
  const { requestId } = await g.client.request<{ requestId: string }>(
    "device.scopes.requestUpgrade",
    { scopes: [...new Set([...g.scopes, ...SCOPES])] },
  );
  fullAccessRequest = requestId;
  fullAccessChanged = changed;
  changed();
  waitForFullAccess(g.url, g.client);
}

/** Waits on the pending upgrade on this connection; one that drops leaves it pending for the next. */
function waitForFullAccess(url: string, client: Gateway["client"]): void {
  const requestId = fullAccessRequest;
  if (!requestId) return;
  const done = () => {
    if (fullAccessRequest !== requestId) return;
    fullAccessRequest = null;
    fullAccessChanged();
  };
  client
    .request<{ status: string; deviceToken?: string; scopes?: string[] }>(
      "device.scopes.waitUpgrade",
      { requestId },
      { timeoutMs: null },
    )
    .then(async (result) => {
      logger.info("agent", "openclaw full access upgrade", { status: result.status });
      done();
      if (result.status !== "approved" || !result.deviceToken) return;
      await setOpenClawDeviceToken(
        JSON.stringify({ token: result.deviceToken, scopes: result.scopes ?? [] }),
      );
      if (current?.url === url) disconnect();
    })
    .catch((error: unknown) => {
      logger.info("agent", "openclaw full access upgrade failed", { error: String(error) });
      if (error instanceof GatewayProtocolRequestError) done();
    });
}

type OwnerConfig = { listed: boolean; owners: unknown[]; hash: string };

/**
 * Whether Otter is the gateway's owner (`otter:owner` in `commands.ownerAllowFrom`), and its plugin
 * may brief the agent on Otter's delivery targets (a prompt hook, which OpenClaw runs for a
 * plugin it didn't bundle only once `hooks.allowConversationAccess` says so).
 */
async function ownerConfig(g: Gateway): Promise<OwnerConfig> {
  const { sourceConfig, hash } = await g.client.request<{
    sourceConfig?: {
      commands?: { ownerAllowFrom?: unknown };
      plugins?: { entries?: { otter?: { hooks?: { allowConversationAccess?: unknown } } } };
    };
    hash: string;
  }>("config.get", {});
  const owners = sourceConfig?.commands?.ownerAllowFrom;
  const list = Array.isArray(owners) ? owners : [];
  const briefed = sourceConfig?.plugins?.entries?.otter?.hooks?.allowConversationAccess === true;
  return {
    listed: briefed && list.some((entry) => String(entry).trim() === OTTER_OWNER),
    owners: list,
    hash,
  };
}

/**
 * Whether what you send goes through the Otter plugin as the gateway's owner (a channel
 * owner manages every automation, not only this chat's): null without the plugin, or
 * without the full access its method needs.
 */
export async function openClawOwner(): Promise<boolean | null> {
  const g = await current?.ready.catch(() => null);
  if (!g?.methods.includes(OTTER_SEND) || !holdsAll(g.scopes)) return null;
  let listed = ownerListed.get(g);
  if (!listed) {
    listed = ownerConfig(g).then((config) => config.listed);
    ownerListed.set(g, listed);
    listed.catch(() => ownerListed.delete(g));
  }
  return listed.catch(() => null);
}

const ownerListed = new WeakMap<Gateway, Promise<boolean>>();

/** Lists the Otter plugin's sender in `commands.ownerAllowFrom` (beside any owners there are), and lets it brief the agent. */
export async function allowOpenClawOwner(settings: OpenClawSettings): Promise<void> {
  const g = await gateway(settings);
  const { listed, owners, hash } = await ownerConfig(g);
  ownerListed.delete(g);
  if (listed) return;
  const listedOwners = owners.some((entry) => String(entry).trim() === OTTER_OWNER)
    ? owners
    : [...owners, OTTER_OWNER];
  await g.client.request("config.patch", {
    raw: JSON.stringify({
      commands: { ownerAllowFrom: listedOwners },
      plugins: { entries: { otter: { hooks: { allowConversationAccess: true } } } },
    }),
    baseHash: hash,
    replacePaths: ["commands.ownerAllowFrom"],
    note: "Otter: what you send from Otter is the owner's, and the agent knows Otter's chats",
  });
  logger.info("agent", "openclaw owner allowed");
}

const OTTER_BROWSER_PAIRING = "otter.browser.pairing";
/** The browser profile the tabs you share are to the gateway (the plugin's `BROWSER_PROFILE`). */
const OTTER_BROWSER_PROFILE = "otter";

/**
 * Where Otter's browser gives the gateway's agents the tabs you share: OpenClaw's extension
 * relay, which Otter joins as OpenClaw's own Chrome extension does, as an `extension` browser
 * profile of its own (added to the gateway's config the first time).
 */
export async function openClawBrowserRelay(
  settings: OpenClawSettings,
): Promise<{ url: string; key: string }> {
  const g = await gateway(settings);
  if (!g.methods.includes(OTTER_BROWSER_PAIRING) || !holdsAll(g.scopes))
    throw new Error(
      "To share tabs, update Otter's plugin on your gateway: openclaw plugins update @otterware/openclaw-otter",
    );
  const { key, profile } = await g.client.request<{ key: string; profile: string }>(
    OTTER_BROWSER_PAIRING,
    {},
  );
  const { sourceConfig, hash } = await g.client.request<{
    sourceConfig?: { browser?: { profiles?: Record<string, { driver?: unknown }> } };
    hash: string;
  }>("config.get", {});
  if (sourceConfig?.browser?.profiles?.[profile]?.driver !== "extension") {
    await g.client.request("config.patch", {
      raw: JSON.stringify({ browser: { profiles: { [profile]: { driver: "extension" } } } }),
      baseHash: hash,
      note: "Otter: the tabs you share from Otter's browser",
    });
    logger.info("agent", "openclaw browser profile added", { profile });
  }
  const url = new URL(normalizeOpenClawUrl(settings.url));
  url.pathname = "/browser/extension";
  url.search = new URLSearchParams({ profile }).toString();
  return { url: url.href, key };
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
 * profile. Not whether its turns are the owner's: that's `operator.admin`.
 * Null when the gateway can't say (an older one).
 */
async function whoAmI(g: Gateway): Promise<{ label: string } | null> {
  try {
    const { profile } = await g.client.request<{
      profile: { id: string; displayName: string | null; emails: string[] };
    }>("users.self", {});
    if (profile.id === OWNER_PROFILE_ID)
      return {
        label: profile.displayName
          ? `the gateway's shared profile (${profile.displayName})`
          : "the gateway's shared profile",
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
  const meta = row.__openclaw as
    | { idempotencyKey?: unknown; transport?: { channel?: unknown; messageId?: unknown } }
    | undefined;
  // Sent through the Otter channel, it's kept under the channel's own key; the send's is its message id.
  if (row.role === "user" && meta?.transport?.channel === "otter") {
    const id = meta.transport.messageId;
    return typeof id === "string" ? id : undefined;
  }
  const key = meta?.idempotencyKey ?? row.idempotencyKey;
  return typeof key === "string" ? key.replace(/:user$/, "") : undefined;
}

function pluginOutdated(error: unknown): never {
  throw /unknown method/i.test(String(error))
    ? new Error(
        "To take control, update the Otter plugin on the OpenClaw gateway: openclaw plugins update @otterware/openclaw-otter",
      )
    : error;
}

/** The tab the session's agent browsed in last, as its browser tool reported it. */
export function browserTabOf(
  rows: Record<string, unknown>[],
): { targetId: string; profile?: string; url?: string } | undefined {
  for (let i = rows.length - 1; i >= 0; i--) {
    const tab = (rows[i].details as { browserTab?: Record<string, unknown> } | undefined)
      ?.browserTab;
    if (typeof tab?.targetId === "string" && tab.target !== "node")
      return {
        targetId: tab.targetId,
        profile: typeof tab.profile === "string" ? tab.profile : undefined,
        url: typeof tab.url === "string" ? tab.url : undefined,
      };
  }
}

/** The entry `sessions.fork` takes for one of your messages. */
export function forkEntry(rows: Record<string, unknown>[], at: ForkPoint): string | undefined {
  const sent = rows.filter((m) => m.role === "user");
  const row =
    (at.requestId && sent.findLast((m) => sendKeyOf(m) === at.requestId)) ||
    sent[sent.length - 1 - at.fromEnd];
  const id = (row?.__openclaw as { id?: unknown } | undefined)?.id;
  return typeof id === "string" ? id : undefined;
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
    const text = isDelivery(m) ? withoutInspectLink(textOf(m)) : textOf(m);
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

/** What OpenClaw wrote into a session as delivered to a channel (a cron job's announce, the message tool), not by a run. */
const DELIVERED_MODELS = new Set(["delivery-mirror", "automation-result"]);

/** A row's run; a delivery, which no run wrote, is a run of its own: `delivery:<row id>`. */
const runOf = (row: Record<string, unknown>) => {
  const meta = row.__openclaw as { runId?: unknown; id?: unknown } | undefined;
  if (meta?.runId !== undefined) return meta.runId;
  if (row.role === "assistant" && DELIVERED_MODELS.has(String(row.model)) && meta?.id)
    return `delivery:${String(meta.id)}`;
  return undefined;
};

const isDelivery = (row: Record<string, unknown>) => String(runOf(row)).startsWith("delivery:");

/** A cron job's announce ends with a link to the run in the gateway's own UI, which needs its own login. */
const withoutInspectLink = (text: string) =>
  text.replace(/\n+Inspect: https?:\/\/\S+\/cron\/\S+\s*$/, "");

/** How far back a device that has no chat yet for a session the gateway delivered to shows what it delivered. */
const DELIVERED_BACKLOG_MS = 24 * 60 * 60 * 1000;
const DELIVERY_WRITTEN_MS = 3000;
/** How long a watched chat's changes settle before it's caught up on. */
const CHANGE_SETTLE_MS = 1000;

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
  let last: Record<string, unknown>[] | undefined;
  for (const row of rows) {
    // A delivery is a turn of its own that leaves the runs around it as they were.
    if (isDelivery(row)) {
      chains.push([row]);
      continue;
    }
    const id = runOf(row) ?? run;
    const sentAfterYield = row.role === "user" && last !== undefined && waitingOnYield(last);
    if (!last || sentAfterYield || (id !== run && !steered && !waitingOnYield(last))) {
      last = [row];
      chains.push(last);
    } else last.push(row);
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
  const waiting =
    rows && last ? waitingOnYield(rows) && all.findLast((m) => !isDelivery(m)) === last : false;
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
  if (state.found)
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
  start: (going: () => boolean) => Promise<void>,
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
        // Its message scrolled out of the history read: what streamed stays.
        if (ended && state.found) emit({ requestId, type: "transcript", messages: state.messages });
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
    remember(announced, runId);
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

  let reconnecting = false;
  const reconnect = async () => {
    if (reconnecting) return;
    reconnecting = true;
    clearTimeout(quiet);
    try {
      await pickUp();
    } finally {
      reconnecting = false;
    }
  };
  // Until the gateway is back, however long that takes (a sleep, a slow restart).
  const pickUp = async () => {
    for (let attempt = 0; ; attempt++) {
      await sleep(RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]);
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
        if (lost === turn.gateway.client) continue;
        return hush();
      } catch (error) {
        if (error instanceof Error && error.message === "not_configured")
          return turn.finish({ requestId, type: "error", message: "detached" });
        logger.info("agent", "openclaw reconnect failed", { requestId, error: String(error) });
      }
    }
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
  // Until it has started, `start` deals with a dropped socket itself (a send it may have to repeat).
  let started = false;
  /** The last connection that closed: one that closes while subscribing is picked up after. */
  let lost: Gateway["client"] | null = null;
  const onClose = (client: Gateway["client"]) => {
    lost = client;
    if (started && client === turn.gateway.client) void reconnect();
  };
  listeners.add(onEvent);
  closeListeners.add(onClose);
  try {
    hush();
    await start(() => ended !== null);
    started = true;
    if (lost === turn.gateway.client) void reconnect();
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
  /** Where each chat's session was last read up to (`cursorOf`). */
  cursors: Map<string, string>;
  started: (run: AgentRun) => void;
  read?: (sessionKey: string, cursor: string) => void;
};

let watching: Watching | null = null;
let watchedClient: Gateway["client"] | null = null;
let rewatch: ReturnType<typeof setTimeout> | undefined;
let rewatchPending = false;
/** Runs already reported, or another device's continuation. */
const announced = new Set<string>();
/** Runs of messages sent to a watched session, from any device. */
const sent = new Set<string>();
/** Keeps the latest ids only: the app runs for weeks. */
function remember(ids: Set<string>, id: string): void {
  ids.add(id);
  if (ids.size > 5_000) ids.delete(ids.values().next().value!);
}
/** Sessions whose run yielded: the run that starts next is its continuation, followed where it was sent. */
const continuing = new Set<string>();

/**
 * The gateway titles only its own apps' chats (`dashboard:`, `ios-`, `node-`
 * keys) with its model; ours ask the same model.
 */
async function writeTitle(g: Gateway, sessionKey: string, message: string) {
  const { title } = await g.client.request<{ title?: string | null }>(
    "sessions.title.prepare",
    {
      agentId: sessionKey.split(":")[1],
      message: message.slice(0, 1000),
    },
    { timeoutMs: 90_000 },
  );
  return title || null;
}

/** The session's label, so the gateway's screens show the title too; labels are unique there. */
async function keepTitle(g: Gateway, sessionKey: string, title: string): Promise<void> {
  try {
    await g.client.request("sessions.patch", { key: sessionKey, label: title });
  } catch (error) {
    logger.info("agent", "openclaw label failed", { error: String(error) });
  }
}

async function nameSession(
  g: Gateway,
  sessionKey: string,
  message: string,
  named: (title: string) => void,
): Promise<void> {
  try {
    const title = await writeTitle(g, sessionKey, message);
    if (!title) return;
    named(title);
    await keepTitle(g, sessionKey, title);
  } catch (error) {
    logger.info("agent", "openclaw title failed", { error: String(error) });
  }
}

function announce(
  sessionKey: string,
  runId: string,
  {
    title,
    deliveredAt,
    delivery,
  }: { title?: string; deliveredAt?: number; delivery?: AgentRun["delivery"] } = {},
): void {
  const watched = watching?.sessions.has(sessionKey);
  if (!watching || (!watched && !pointed.has(sessionKey))) return;
  if (announced.has(runId) || sent.has(runId)) return;
  // A turn going in the chat follows its own runs; what was delivered meanwhile waits for it to end.
  if (!delivery)
    for (const turn of turns.values())
      if (turn.sessionKey === sessionKey && (!turn.ending || ownsRun(turn, runId))) return;
  remember(announced, runId);
  logger.info("agent", "openclaw run of its own", { runId });
  watching.started({
    sessionId: sessionKey,
    requestId: `${AGENT_RUN}${runId}`,
    ...(!watched && { chat: { title: title ?? "OpenClaw" } }),
    ...(deliveredAt !== undefined && { deliveredAt }),
    ...(delivery && { delivery }),
  });
}

listeners.add(({ event, payload }) => {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (typeof p.sessionKey !== "string" || !watching?.sessions.has(p.sessionKey)) return;
  // Written into the chat by no run of it (a scheduled job's result, kept here when it had no
  // channel to go to): only the session's change says so.
  if (event === "sessions.changed") {
    // A turn going in the chat follows it already.
    for (const turn of turns.values()) if (turn.sessionKey === p.sessionKey && !turn.ending) return;
    return catchUpSoon();
  }
  const row = p.message as Record<string, unknown> | undefined;
  const key = event === "session.message" && row?.role === "user" ? sendKeyOf(row) : undefined;
  if (key) {
    remember(sent, key);
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
  if (continues) remember(announced, p.runId);
  else announce(p.sessionKey, p.runId);
});

closeListeners.add((client) => {
  if (client !== watchedClient) return;
  watchedClient = null;
  scheduleWatch(RECONNECT_DELAYS_MS[0]);
});

function scheduleWatch(delay: number): void {
  clearTimeout(rewatch);
  rewatchPending = true;
  rewatch = setTimeout(() => {
    rewatchPending = false;
    void ensureWatching(delay);
  }, delay);
}

async function ensureWatching(delay = 0): Promise<void> {
  if (!watching) return;
  try {
    const g = await gateway(watching.settings);
    if (g.client === watchedClient) return;
    await g.client.request("sessions.subscribe", {});
    // What yielded while this device wasn't listening is read from history now.
    continuing.clear();
    await catchUpSessions(g);
    watchedClient = g.client;
  } catch (error) {
    // No gateway to watch until one is connected (which watches again).
    if (error instanceof Error && error.message === "not_configured") return;
    logger.info("agent", "openclaw watch failed", { error: String(error) });
    scheduleWatch(Math.min(Math.max(delay * 2, RECONNECT_DELAYS_MS[0]), 60_000));
  }
}

/**
 * Chats to catch up on whatever their last activity, from their last message
 * on (one just watched, or whose turn was just picked up again), until a catch-up gets through.
 */
const fresh = new Set<string>();

/**
 * Sessions the gateway delivered to that no chat here watches (a job that runs in a session of
 * its own): caught up on like the agent's Otter session, so they start a chat.
 */
const pointed = new Set<string>();

function catchUpNow(): void {
  if (!watching) return;
  if (watchedClient)
    void current?.ready.then(catchUpSessions).catch(() => {
      watchedClient = null;
      scheduleWatch(RECONNECT_DELAYS_MS[0]);
    });
  else void ensureWatching();
}

let catchingUp: ReturnType<typeof setTimeout> | undefined;
/** Once a burst of changes settles. */
function catchUpSoon(): void {
  clearTimeout(catchingUp);
  catchingUp = setTimeout(catchUpNow, CHANGE_SETTLE_MS);
}

/** Runs the agent started while this device wasn't listening: going now, or written since the chat last ended. */
async function catchUpSessions(g: Gateway): Promise<void> {
  const caught = new Set(fresh);
  const delivered = new Set(pointed);
  const { sessions } = await g.client.request<{ sessions?: Record<string, unknown>[] }>(
    "sessions.list",
    { limit: 200 },
  );
  let names: Map<string, string> | undefined;
  for (const row of sessions ?? []) {
    const key = String(row.key);
    const watched = watching?.sessions.get(key);
    if (watched === undefined && !delivered.has(key)) continue;
    const active = (row.activeRunIds as string[] | undefined) ?? [];
    // A job's result written into a chat moves its updatedAt only, not its lastActivityAt.
    const activity = Math.max(Number(row.lastActivityAt) || 0, Number(row.updatedAt) || 0);
    const cursor = watched === undefined ? undefined : watching?.cursors.get(key);
    const since =
      watched === undefined ? Date.now() - DELIVERED_BACKLOG_MS : fresh.has(key) ? 0 : watched;
    const backlog = Date.now() - DELIVERED_BACKLOG_MS;
    const quiet = active.length === 0 && activity <= since;
    if (watched === undefined && quiet) continue;
    if (cursor !== undefined && active.length === 0 && readAt.get(key) === activity) continue;
    // A chat first read with nothing new, nor anything lately to have missed, only needs where it's up to.
    const startOnly = watched !== undefined && cursor === undefined && quiet && activity <= backlog;
    const history = await g.client.request<{
      sessionId?: string;
      messages?: Record<string, unknown>[];
    }>("chat.history", { sessionKey: key, limit: startOnly ? 1 : 200 });
    const rows = history.messages ?? [];
    readAt.set(key, activity);
    const at = cursorOf(history.sessionId, rows);
    if (watched !== undefined && at && at !== cursor) watching?.read?.(key, at);
    if (startOnly) continue;
    let runs: string[];
    if (cursor !== undefined)
      runs = newRuns(key, rowsAfter(rows, cursor, history.sessionId), active);
    else {
      runs = agentRunsSince(rows, since, active);
      // A chat read for the first time catches up on what was delivered to it while it was missed.
      if (watched !== undefined)
        for (const id of deliveredSince(rows, backlog)) if (!runs.includes(id)) runs.push(id);
      lastRun.set(
        key,
        rows.findLast((m) => runOf(m) !== undefined && !isDelivery(m)),
      );
    }
    if (runs.length > 0) names ??= await agentNames(g);
    for (const id of runs) {
      const at = deliveredAt(rows, id);
      const delivery = await deliveryOf(g, rows, id, names?.get(agentOf(key)));
      // A chat a delivery starts is named for the automation that sent it, and when.
      const title =
        watched !== undefined
          ? undefined
          : (delivery?.kind === "automation" && delivery.name
              ? `${delivery.name} · ${shortDate(at ?? Date.now())}`
              : undefined) ||
            sessionTitle(row) ||
            names?.get(agentOf(key));
      announce(key, id, { title, deliveredAt: at, delivery });
    }
  }
  for (const key of caught) fresh.delete(key);
  for (const key of delivered) pointed.delete(key);
}

/** The gateway's session timestamp when this device last read it, so an unchanged one isn't read again. */
const readAt = new Map<string, number>();
/** The last row of a run read in each session: what follows it in a later read continues that run. */
const lastRun = new Map<string, Record<string, unknown> | undefined>();

const seqOf = (m: Record<string, unknown>) =>
  Number((m.__openclaw as { seq?: unknown } | undefined)?.seq);

/**
 * Where a session is read up to: its transcript (a reset starts another) and the last row's
 * number in it, as the gateway numbers them.
 */
export function cursorOf(
  sessionId: string | undefined,
  rows: Record<string, unknown>[],
): string | undefined {
  const seq = rows.map(seqOf).findLast(Number.isFinite);
  return sessionId && seq !== undefined ? `${sessionId}:${seq}` : undefined;
}

/** The rows written after `cursor`: all of them in a transcript other than the one it was in. */
export function rowsAfter(
  rows: Record<string, unknown>[],
  cursor: string,
  sessionId: string | undefined,
): Record<string, unknown>[] {
  const split = cursor.lastIndexOf(":");
  if (cursor.slice(0, split) !== sessionId) return rows;
  const seq = Number(cursor.slice(split + 1));
  return rows.slice(rows.findLastIndex((m) => seqOf(m) <= seq) + 1);
}

/**
 * The runs in what was written to a session since it was last read that no message started:
 * what was delivered (wherever it falls), and runs of the agent's own after the last message.
 * A run whose start was read before continues it.
 */
export function newRuns(
  sessionKey: string,
  rows: Record<string, unknown>[],
  active: string[] = [],
): string[] {
  const before = lastRun.get(sessionKey);
  const continued = before ? runOf(before) : undefined;
  if (rows.length > 0)
    lastRun.set(
      sessionKey,
      rows.findLast((m) => runOf(m) !== undefined && !isDelivery(m)) ?? before,
    );
  const runs = agentRunsSince(rows, 0, active).filter((id) => id !== continued);
  for (const id of deliveredSince(rows, 0)) if (!runs.includes(id)) runs.push(id);
  return runs;
}

/** Deliveries written after `since`. */
function deliveredSince(rows: Record<string, unknown>[], since: number): string[] {
  return rows.flatMap((m) => {
    if (!isDelivery(m) || !transcript([m]).some((t) => t.role === "assistant")) return [];
    const at = Number((m.__openclaw as { recordTimestampMs?: unknown })?.recordTimestampMs);
    return at > since ? [String(runOf(m))] : [];
  });
}

const agentOf = (sessionKey: string) => sessionKey.split(":")[1] ?? "";

/** What the gateway calls a session, for a chat it starts. */
function sessionTitle(row: Record<string, unknown>): string | undefined {
  for (const field of ["displayName", "label", "derivedTitle"])
    if (typeof row[field] === "string" && row[field]) return row[field] as string;
  return undefined;
}

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

type Job = { name?: string; schedule?: string } | null;
/** The gateway's automations, by id: a finished one-shot is gone, so null. */
const jobs = new Map<string, Promise<Job>>();

function jobOf(g: Gateway, id: string): Promise<Job> {
  let job = jobs.get(id);
  if (!job) {
    job = g.client
      .request<{ name?: unknown; schedule?: Record<string, unknown> }>("cron.get", { id })
      .then((found) => ({
        ...(typeof found.name === "string" && found.name ? { name: found.name } : {}),
        ...(found.schedule ? { schedule: scheduleText(found.schedule) } : {}),
      }))
      .catch(() => null);
    jobs.set(id, job);
    // A job's name or schedule can change: read it again before long.
    setTimeout(() => jobs.delete(id), JOB_CACHE_MS);
  }
  return job;
}
const JOB_CACHE_MS = 10 * 60 * 1000;

/** An automation's schedule as the gateway keeps it, short. */
export function scheduleText(schedule: Record<string, unknown>): string | undefined {
  if (schedule.kind === "cron" && typeof schedule.expr === "string")
    return typeof schedule.tz === "string" ? `${schedule.expr} (${schedule.tz})` : schedule.expr;
  if (schedule.kind === "every" && typeof schedule.everyMs === "number") {
    const minutes = Math.round(schedule.everyMs / 60_000);
    return minutes >= 60 && minutes % 60 === 0
      ? `Every ${minutes / 60}h`
      : minutes >= 1
        ? `Every ${minutes}m`
        : `Every ${Math.round(schedule.everyMs / 1000)}s`;
  }
  if (schedule.kind === "at") return "Once";
  return undefined;
}

/**
 * What a delivery is: an automation's result (`automation-result`, with its job), or a message the
 * agent sent (`delivery-mirror`: the message tool). Nothing for a run.
 */
async function deliveryOf(
  g: Gateway,
  rows: Record<string, unknown>[],
  runId: string,
  agent: string | undefined,
): Promise<AgentRun["delivery"]> {
  if (!runId.startsWith("delivery:")) return undefined;
  const row = rows.find((m) => runOf(m) === runId);
  if (row?.model !== "automation-result") {
    // The message tool's copy of a reply a turn of this chat sent (`<run>:message-tool:…`): its answer.
    const key = String(
      (row?.__openclaw as { idempotencyKey?: unknown } | undefined)?.idempotencyKey,
    );
    const sender = /^(.+?):message-tool:/.exec(key)?.[1];
    if (sender && rows.some((m) => runOf(m) === sender)) return undefined;
    return { kind: "message", ...(agent && { from: agent }) };
  }
  const jobId = (row.openclawAutomation as { jobId?: unknown } | undefined)?.jobId;
  const job = typeof jobId === "string" ? await jobOf(g, jobId) : null;
  return { kind: "automation", ...(typeof jobId === "string" ? { jobId } : {}), ...job };
}

/** When a delivery (`delivery:<row id>`) was written; nothing for a run. */
function deliveredAt(
  rows: Record<string, unknown>[] | undefined,
  runId: string,
): number | undefined {
  if (!runId.startsWith("delivery:")) return undefined;
  const row = rows?.find((m) => runOf(m) === runId);
  const at = Number(
    (row?.__openclaw as { recordTimestampMs?: unknown } | undefined)?.recordTimestampMs,
  );
  return Number.isFinite(at) ? at : undefined;
}

/** The gateway's agents' names (an agent's identity: Rowan), by id. */
async function agentNames(g: Gateway): Promise<Map<string, string>> {
  const { agents } = await g.client
    .request<{ agents?: { id: string; name?: string; identity?: { name?: string } }[] }>(
      "agents.list",
      {},
    )
    .catch(() => ({ agents: [] }));
  return new Map(
    (agents ?? []).flatMap((a) => {
      const name = a.identity?.name ?? a.name;
      return name ? [[a.id, name] as const] : [];
    }),
  );
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
  const lastRun = chains.findLast((chain) => !isDelivery(chain[0]));
  const continuing = lastRun !== undefined && waitingOnYield(lastRun);
  const unwritten = active.filter((id) => !known.has(id) && id !== own && !continuing);
  return [...written, ...unwritten];
}

/**
 * Sends through the Otter channel when the gateway has it and lists it as an owner, so the run
 * is a channel owner's (it manages every automation); else `chat.send`, whose run is the
 * owner's only for what this chat made. The plugin refuses (`otter_not_owner`) before
 * anything runs, so falling back never sends twice.
 */
async function sendAsOwner(
  g: Gateway,
  send: { sessionKey: string; message: string; idempotencyKey: string; attachments?: unknown[] },
): Promise<{ runId?: string }> {
  if (g.methods.includes(OTTER_SEND) && holdsAll(g.scopes)) {
    try {
      return await g.client.request<{ runId?: string }>(OTTER_SEND, send, {
        timeoutMs: FILE_TIMEOUT_MS,
      });
    } catch (error) {
      if (!/otter_not_owner/.test(String(error))) throw error;
    }
  }
  return g.client.request<{ runId?: string }>("chat.send", send, { timeoutMs: FILE_TIMEOUT_MS });
}

const CONNECT_PROBLEMS: Record<string, string> = {
  not_configured: "Connect your gateway in Settings → OpenClaw.",
  pairing_required: "Approve this device on your gateway, in Settings → OpenClaw.",
  origin_not_allowed: "Your gateway doesn't accept Otter yet: see Settings → OpenClaw.",
  unauthorized: "Your gateway didn't accept Otter's token: reconnect in Settings → OpenClaw.",
  unreachable: "Can't reach your gateway.",
};

async function cronGateway(settings: OpenClawSettings): Promise<CronGateway> {
  const g = await gateway(settings).catch((error: unknown) => {
    throw new Error(CONNECT_PROBLEMS[connectError(error)] ?? CONNECT_PROBLEMS.unreachable);
  });
  return {
    request: (method, params) => g.client.request(method, params),
    scopes: g.scopes,
    otterChannel: g.methods.includes(OTTER_SEND),
  };
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
      fullAccess: openClawFullAccess(),
      owner: await openClawOwner(),
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
    let connected = false;
    try {
      const g = await gateway(settings);
      connected = true;
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
      // Connected, but the gateway refused what was asked (restarting, a missing scope).
      if (connected && error instanceof GatewayProtocolRequestError)
        return {
          ...base,
          installed: true,
          status: "error",
          auth: { status: "authenticated" },
          message: `The gateway answered: ${error.message}`,
        };
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
                : "Can't reach the gateway.",
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
      void nameSession(g, sessionKey, input.input, (title) =>
        emit({ requestId, type: "title", title }),
      );
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
    const send = {
      sessionKey,
      message: input.input,
      idempotencyKey: requestId,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    // The gateway closes the connection on a bigger message, and every chat on it with it.
    if (JSON.stringify(send).length > MAX_MESSAGE_BYTES)
      return emit({
        requestId,
        type: "error",
        message: "agent_error: Those files are too large for OpenClaw: about 18 MB per message.",
      });
    await follow(turn, settings, async (going) => {
      let sent: { runId?: string } | undefined;
      try {
        sent = await sendAsOwner(g, send);
      } catch (error) {
        if (error instanceof GatewayProtocolRequestError) throw error;
        // The socket went before the gateway answered, which may have the message already.
        logger.info("agent", "openclaw send lost its connection", { requestId });
        for (let attempt = 0; !sent; attempt++) {
          await sleep(RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]);
          if (!going()) return;
          try {
            turn.gateway = await gateway(settings);
            const { found } = await runState(turn);
            if (!going()) return;
            sent = found ? {} : await sendAsOwner(turn.gateway, send);
          } catch (retry) {
            if (retry instanceof GatewayProtocolRequestError) throw retry;
            if (retry instanceof Error && retry.message === "not_configured") throw retry;
            logger.info("agent", "openclaw send retry failed", { requestId, error: String(retry) });
          }
        }
      }
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
        remember(announced, id);
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
    const abort = (client: Gateway["client"]) =>
      client.request("chat.abort", {
        sessionKey: turn.sessionKey,
        ...(turn.steers.size > 0 || waiting ? {} : { runId: turn.runId }),
      });
    const stopped = () => turn.finish({ requestId, type: "error", message: "cancelled" });
    const { url } = turn.gateway;
    const reset = resets;
    void abort(turn.gateway.client).then(
      () => waiting && stopped(),
      async (error: unknown) => {
        stopped();
        if (error instanceof GatewayProtocolRequestError) return;
        // On a connection that just dropped, the run goes on: ask again once the gateway is back.
        for (let attempt = 0; attempt < 120; attempt++) {
          await sleep(RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]);
          if (reset !== resets) return;
          try {
            const g = await gateway({ ...OPENCLAW_DEFAULTS, url });
            if (reset !== resets) return;
            return void (await abort(g.client));
          } catch (retry) {
            if (retry instanceof GatewayProtocolRequestError) return;
            if (retry instanceof Error && retry.message === "not_configured") return;
          }
        }
      },
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

  async retitle(settings, sessionId, name) {
    const g = await gateway(settings);
    const title = "title" in name ? name.title : await writeTitle(g, sessionId, name.message);
    if (title) await keepTitle(g, sessionId, title);
    return title;
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
      }>(
        "artifacts.download",
        {
          sessionKey: sessionId,
          artifactId: decodeURIComponent(href.slice("otter-artifact:".length)),
        },
        { timeoutMs: FILE_TIMEOUT_MS },
      );
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
    // It shares only images and text, up to 256 KB: the Otter plugin sends the rest (a PDF).
    if (result.file && result.file.content === undefined) {
      const whole = await g.client
        .request<{ file: { name: string; content: string } }>(
          "otter.files.get",
          {
            sessionKey: sessionId,
            path,
          },
          { timeoutMs: FILE_TIMEOUT_MS },
        )
        .catch((error: unknown) => {
          throw /unknown method/i.test(String(error))
            ? new Error(
                "To open this file, update the Otter plugin on the OpenClaw gateway: openclaw plugins update @otterware/openclaw-otter",
              )
            : /not found|outside/i.test(String(error))
              ? new Error(unreadable)
              : error;
        });
      return chatFile(whole.file.name, fromBase64(whole.file.content), result.file.mimeType);
    }
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

  async fork(settings, sessionId, before) {
    const g = await gateway(settings);
    if (!before) {
      const copy = await g.client.request<{ key: string }>("sessions.create", {
        agentId: sessionId.match(/^agent:([^:]+):/)?.[1],
        parentSessionKey: sessionId,
        fork: true,
      });
      return copy.key;
    }
    const result = await g.client.request<{ messages?: Record<string, unknown>[] }>(
      "chat.history",
      { sessionKey: sessionId, limit: 500 },
    );
    const entryId = forkEntry(result.messages ?? [], before);
    if (!entryId) throw new Error("OpenClaw doesn't have this message any more.");
    const forked = await g.client.request<{ sessionKey: string }>("sessions.fork", {
      sessionKey: sessionId,
      entryId,
    });
    return forked.sessionKey;
  },

  async browserView(settings, sessionId, { width, height, except }) {
    const g = await gateway(settings);
    const { messages = [] } = await g.client.request<{ messages?: Record<string, unknown>[] }>(
      "chat.history",
      { sessionKey: sessionId, limit: 200 },
    );
    // Without a tab in its history (runtimes that keep no tool results): the browser's current one.
    const tab = browserTabOf(messages);
    // A tab you shared is already on your screen, in Otter's own browser.
    if (tab?.profile === OTTER_BROWSER_PROFILE) return null;
    if (tab && tab.targetId === except) return { targetId: tab.targetId, url: null };
    const view = await g.client
      .request<{ wsPath: string; targetId?: string; url?: string }>("browser.request", {
        method: "POST",
        path: "/screencast",
        ...(tab?.profile ? { query: { profile: tab.profile } } : {}),
        body: { targetId: tab?.targetId, maxWidth: width, maxHeight: height, quality: 70 },
      })
      .catch((error: unknown) => {
        // Its tabs are cleaned up after a while, or the browser was stopped.
        if (/not running|not found|no such|closed/i.test(String(error))) return null;
        throw error;
      });
    if (!view) return null;
    const base = `${settings.url.replace(/\/$/, "")}/`;
    const targetId = view.targetId ?? tab?.targetId;
    if (!targetId) return null;
    if (!tab && targetId === except) return { targetId, url: null };
    return {
      targetId,
      url: new URL(view.wsPath.replace(/^\//, ""), base).href,
      page: view.url ?? tab?.url,
      profile: tab?.profile,
    } satisfies BrowserView;
  },

  // Through the Otter plugin on the gateway (otter.browser.*), which replays it in Chromium.
  async browserInput(settings, { targetId, profile, take, seq, events }) {
    const g = await gateway(settings);
    await g.client
      .request(
        take === undefined ? "otter.browser.input" : "otter.browser.control",
        take === undefined ? { targetId, profile, seq, events } : { targetId, profile, take },
      )
      .catch(pluginOutdated);
  },

  async browserEvents(settings, { targetId, profile, since, run, waitMs }) {
    const g = await gateway(settings);
    return g.client
      .request<BrowserEvents>(
        "otter.browser.events",
        { targetId, profile, since, run, waitMs },
        { timeoutMs: waitMs + 15_000 },
      )
      .catch(pluginOutdated);
  },

  async browserUpload(settings, { targetId, profile, files }) {
    const g = await gateway(settings);
    await g.client
      .request("otter.browser.upload", { targetId, profile, files }, { timeoutMs: 60_000 })
      .catch(pluginOutdated);
  },

  async deleteSession(settings, sessionId) {
    const g = await gateway(settings);
    await g.client.request("sessions.delete", { key: sessionId });
  },

  schedules: {
    async list(settings) {
      if (!settings.url || !(await hasOpenClawCredentials())) return null;
      const g = await cronGateway(settings);
      const { defaultId } = await listAgents(await gateway(settings)).catch(() => ({
        defaultId: "main",
      }));
      return listTasks(g, defaultId);
    },
    save: async (settings, id, input) => saveTask(await cronGateway(settings), id, input),
    setEnabled: async (settings, id, enabled) =>
      setTaskEnabled(await cronGateway(settings), id, enabled),
    runNow: async (settings, id) => runTask(await cronGateway(settings), id),
    remove: async (settings, id) => removeTask(await cronGateway(settings), id),
    runs: async (settings, id, limit) => taskRuns(await cronGateway(settings), id, limit),
    runTranscript: async (settings, id, runId) =>
      transcript(await runRows(await cronGateway(settings), id, runId)),
    targets: async (settings, agent, channel) =>
      channelTargets(await cronGateway(settings), agent, channel),
  },

  watch(settings, sessions, started, read) {
    const next = new Map(sessions.map((s) => [s.id, s.since]));
    const cursors = new Map(sessions.flatMap((s) => (s.cursor ? [[s.id, s.cursor] as const] : [])));
    const before = watching?.sessions;
    // A chat watched after the first, or whose turn was picked up again (it caught up on nothing meanwhile).
    for (const [id, since] of next) {
      const was = before?.get(id);
      if (before && (was === undefined || (was === Number.MAX_SAFE_INTEGER && since !== was)))
        fresh.add(id);
    }
    watching = { settings, sessions: next, cursors, started, read };
    if (fresh.size > 0 && watchedClient)
      void current?.ready.then(catchUpSessions).catch(() => {
        watchedClient = null;
        scheduleWatch(RECONNECT_DELAYS_MS[0]);
      });
    else void ensureWatching();
  },

  delivered(_settings, sessionKey) {
    const catchUp = () => {
      if (sessionKey?.startsWith("agent:") && !watching?.sessions.has(sessionKey))
        pointed.add(sessionKey);
      catchUpNow();
    };
    catchUp();
    // The gateway writes a delivery into the session only once the plugin has told the relay.
    setTimeout(catchUp, DELIVERY_WRITTEN_MS);
  },

  shutdown() {
    watching = null;
    fresh.clear();
    pointed.clear();
    readAt.clear();
    lastRun.clear();
    clearTimeout(catchingUp);
    watchedClient = null;
    clearTimeout(rewatch);
    rewatchPending = false;
    for (const [requestId, turn] of turns)
      turn.finish({ requestId, type: "error", message: "detached" });
    disconnect();
  },
};
