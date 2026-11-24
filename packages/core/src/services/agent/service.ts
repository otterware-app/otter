/**
 * The agents you added and the routing layer (T3 Code's ProviderService in
 * miniature). Their kinds are extensions' (`context.registerAgent`): Hermes,
 * OpenClaw and varys everywhere, Codex and Claude from the desktop backend.
 * You add any number of each, each its own `ChatProvider` with its own
 * connections; chats, tasks and every call name one by its id. Only the kinds
 * this backend runs are listed: the web app doesn't show the Mac's agents.
 *
 * Health snapshots are managed like T3's: served from cache at once,
 * re-checked in the background when stale or when settings change, and
 * pushed to the windows as `agent:providersChanged`. Chat turns are
 * fire-and-forget; their events stream as `agent:chatEvent`.
 */

import { isMailboxPicture } from "@otter/contracts/relay";
import type {
  AgentScheduledTasks,
  ChannelTarget,
  ScheduledTaskInput,
  TaskModels,
  TaskRun,
} from "@otter/contracts/scheduled";
import { registeredAgents } from "../../extensions.ts";
import { broadcast } from "../../ipc.ts";
import { logger } from "../../logger.ts";
import { platform } from "../../platform.ts";
import { fetchImageAsDataUrl } from "../avatar-store.ts";
import { getSettings } from "../settings-store.ts";
import { answerToolApproval } from "./tools/index.ts";
import { onAgentsChanged } from "../agent-sync.ts";
import { getOtterUser, onOtterAccountChange } from "../otter-account.ts";
import {
  agentExists,
  agentSecrets,
  getProviderSettings,
  saveProviderSettings,
} from "./settings.ts";
import {
  RUNTIME_MODES,
  type AgentEntry,
  type AgentId,
  type AgentSettings,
  type AgentType,
  type ApprovalDecision,
  type ChatEvent,
  type ChatProvider,
  type ChatSession,
  type BrowserInput,
  type BrowserViewRequest,
  type ChatSessionMessage,
  type CheckedStatus,
  type ForkPoint,
  type ProviderKind,
  type ProviderSettings,
  type ProviderSnapshot,
  type ProvidersState,
  type ResumeTurnInput,
  type WatchedSession,
  type SendTurnInput,
  type Skill,
} from "./types.ts";

type Agent = {
  entry: AgentEntry;
  type: AgentType;
  provider: ChatProvider;
  settings: AgentSettings;
};

const running = new Map<AgentId, ChatProvider>();

const settingsOf = (type: AgentType, entry: AgentEntry): AgentSettings => ({
  ...type.defaults,
  ...entry.settings,
});

function instance(entry: AgentEntry, type: AgentType): ChatProvider {
  let found = running.get(entry.id);
  if (!found) {
    found = type.create({ id: entry.id, secrets: agentSecrets(entry.id, type.deviceSecrets) });
    running.set(entry.id, found);
  }
  return found;
}

/** The agents this device runs, as you ordered them. */
async function runnable(): Promise<{ entry: AgentEntry; type: AgentType }[]> {
  const { agents } = await getProviderSettings();
  return agents.flatMap((entry) => {
    const type = registeredAgents().get(entry.kind);
    return type ? [{ entry, type }] : [];
  });
}

async function agentOf(id: AgentId): Promise<Agent> {
  const entry = (await getProviderSettings()).agents.find((a) => a.id === id);
  const type = entry && registeredAgents().get(entry.kind);
  if (!entry || !type) throw new Error("This agent isn't on this device.");
  return { entry, type, provider: instance(entry, type), settings: settingsOf(type, entry) };
}

/** An agent's own provider, for its extension's handlers (connecting it, pairing it). */
export async function agentProvider(id: AgentId): Promise<ChatProvider> {
  return (await agentOf(id)).provider;
}

export async function agentSettings(id: AgentId): Promise<AgentSettings> {
  return (await agentOf(id)).settings;
}

export async function hasAgent(id: AgentId): Promise<boolean> {
  return (await runnable()).some(({ entry }) => entry.id === id);
}

function selectedOf(
  settings: ProviderSettings,
  shown: { entry: AgentEntry; type: AgentType }[],
): AgentId | null {
  const usable = shown.filter(({ entry, type }) => settingsOf(type, entry).enabled);
  if (usable.some(({ entry }) => entry.id === settings.selected)) return settings.selected;
  return usable[0]?.entry.id ?? null;
}

const STALE_AFTER_MS = 5 * 60_000;

type Checked = CheckedStatus & { checkedAt: number | null };
const checked = new Map<AgentId, Checked>();
const checking = new Map<AgentId, Promise<void>>();
/** Bumped when a check's answer may be stale before it lands (the Otter account changed). */
const generations = new Map<AgentId, number>();

function pendingSnapshot(settings: AgentSettings): Checked {
  return {
    installed: false,
    version: null,
    status: settings.enabled ? "warning" : "disabled",
    auth: { status: "unknown" },
    checkedAt: null,
    models: [],
    model: null,
    sessions: false,
  };
}

async function snapshotOf(entry: AgentEntry, type: AgentType): Promise<ProviderSnapshot> {
  const settings = settingsOf(type, entry);
  const provider = instance(entry, type);
  const snapshot = checked.get(entry.id) ?? pendingSnapshot(settings);
  const fallback = snapshot.models.find((m) => m.isDefault)?.slug ?? snapshot.models[0]?.slug;
  const chosen =
    settings.model && (!type.strictModels || snapshot.models.some((m) => m.slug === settings.model))
      ? settings.model
      : null;
  return {
    ...snapshot,
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    avatar: entry.avatar ?? null,
    enabled: settings.enabled,
    status: settings.enabled ? snapshot.status : "disabled",
    model: chosen || fallback || null,
    forks: Boolean(provider.fork),
    titles: Boolean(provider.retitle),
    liveBrowser: Boolean(provider.browserView),
    otherSessions: Boolean(provider.otherSessions),
    settings: { ...settings, ...(await provider.settingsView?.(settings)) },
  };
}

/** What each agent was when this device last ran it: another device's change restarts what it must. */
const known = new Map<AgentId, AgentEntry>();

async function remember(): Promise<void> {
  known.clear();
  for (const entry of (await getProviderSettings()).agents) known.set(entry.id, entry);
}

export async function providersState(): Promise<ProvidersState> {
  const all = await getProviderSettings();
  if (known.size === 0) for (const entry of all.agents) known.set(entry.id, entry);
  const shown = await runnable();
  const providers = await Promise.all(shown.map(({ entry, type }) => snapshotOf(entry, type)));
  for (const p of providers) {
    if (p.enabled && (!p.checkedAt || Date.now() - p.checkedAt > STALE_AFTER_MS)) void check(p.id);
  }
  return {
    providers,
    selected: selectedOf(all, shown),
    kinds: getOtterUser()
      ? [...registeredAgents().values()].map((type) => ({
          kind: type.kind,
          name: type.displayName,
        }))
      : [],
    others: all.agents
      .filter((entry) => !registeredAgents().has(entry.kind))
      .map(({ id, name, kind }) => ({ id, name, kind })),
  };
}

async function broadcastState(): Promise<void> {
  broadcast("agent:providersChanged", await providersState());
}

function check(id: AgentId): Promise<void> {
  const inFlight = checking.get(id);
  if (inFlight) return inFlight;
  const generation = generations.get(id) ?? 0;
  const run = (async () => {
    if (!(await hasAgent(id))) return;
    const { provider, settings, entry } = await agentOf(id);
    if (!settings.enabled) return;
    const result = await provider.checkStatus(settings);
    if (generation !== (generations.get(id) ?? 0)) return;
    checked.set(id, { ...result, checkedAt: Date.now() });
    logger.info("agent", "provider checked", {
      kind: entry.kind,
      id,
      status: result.status,
      version: result.version,
    });
  })()
    .catch((error: unknown) =>
      logger.info("agent", "provider check failed", {
        id,
        error: String(error),
      }),
    )
    .finally(() => {
      checking.delete(id);
      void broadcastState();
    });
  checking.set(id, run);
  return run;
}

export async function refreshProviders(ids?: AgentId[]): Promise<void> {
  const all = ids ?? (await runnable()).map(({ entry }) => entry.id);
  await Promise.all(all.map(check));
}

export async function refreshProvider(id: AgentId): Promise<void> {
  generations.set(id, (generations.get(id) ?? 0) + 1);
  await checking.get(id);
  checked.delete(id);
  await check(id);
}

async function saveEntries(
  update: (agents: AgentEntry[]) => AgentEntry[],
  selected?: AgentId | null,
): Promise<ProviderSettings> {
  const current = await getProviderSettings();
  const next = {
    ...current,
    selected: selected === undefined ? current.selected : selected,
    agents: update(current.agents),
  };
  await saveProviderSettings(next);
  await remember();
  return next;
}

export async function saveAgentSettings(
  id: AgentId,
  patch: Partial<AgentSettings> & Record<string, unknown>,
): Promise<void> {
  await saveEntries((agents) =>
    agents.map((a) => (a.id === id ? { ...a, settings: { ...a.settings, ...patch } } : a)),
  );
}

const MAX_NAME = 60;

function nameFor(type: AgentType, taken: AgentEntry[]): string {
  const names = new Set(taken.map((a) => a.name));
  if (!names.has(type.displayName)) return type.displayName;
  for (let n = 2; ; n++)
    if (!names.has(`${type.displayName} ${n}`)) return `${type.displayName} ${n}`;
}

/** Adds an agent of this kind, as it comes, named for its kind: its form connects it. */
export async function addAgent(
  kind: ProviderKind,
): Promise<{ id: AgentId; state: ProvidersState }> {
  const type = registeredAgents().get(kind);
  if (!type) throw new Error("This kind of agent isn't on this device.");
  if (!getOtterUser()) throw new Error("Sign in to your Otter account to add agents.");
  const id = crypto.randomUUID();
  const current = await getProviderSettings();
  await saveEntries(
    (agents) => [
      ...agents,
      { id, kind, name: nameFor(type, agents), settings: {} as AgentSettings },
    ],
    current.selected ?? id,
  );
  logger.info("agent", "added", { kind, id });
  const state = await providersState();
  broadcast("agent:providersChanged", state);
  return { id, state };
}

async function forget(entry: AgentEntry): Promise<void> {
  const type = registeredAgents().get(entry.kind);
  const provider = type && instance(entry, type);
  if (type && provider?.remove)
    await provider
      .remove(settingsOf(type, entry))
      .catch((error: unknown) =>
        logger.info("agent", "not removed elsewhere", { id: entry.id, error: String(error) }),
      );
  provider?.shutdown();
  running.delete(entry.id);
  checked.delete(entry.id);
  generations.set(entry.id, (generations.get(entry.id) ?? 0) + 1);
  const secrets = agentSecrets(entry.id, type?.secrets);
  await Promise.all((type?.secrets ?? []).map((name) => secrets.delete(name).catch(() => {})));
}

onAgentsChanged(({ agents }) => {
  void (async () => {
    const current = new Map((await getProviderSettings()).agents.map((a) => [a.id, a]));
    for (const [id, before] of known)
      if (!current.has(id) && !agentExists(id)) await forget(before);
    for (const id of agents) {
      const entry = current.get(id);
      const type = entry && registeredAgents().get(entry.kind);
      const before = known.get(id);
      if (!entry || !type) continue;
      if (!before) continue;
      const diff = Object.fromEntries(
        Object.entries(entry.settings).filter(
          ([key, value]) => before.settings[key as keyof AgentSettings] !== value,
        ),
      );
      if (Object.keys(diff).length > 0) restartIfNeeded(entry, type, diff);
      else void refreshProvider(id);
    }
    await remember();
    await broadcastState();
  })().catch((err: unknown) => logger.failure("agent", "Couldn't follow the agents' change", err));
});

/** Signed out, the agents are the account's and go with it; signed in again, they come back. */
onOtterAccountChange(() => {
  void (async () => {
    const listed = new Set((await getProviderSettings()).agents.map((a) => a.id));
    for (const [id, provider] of running) {
      if (listed.has(id)) continue;
      provider.shutdown();
      running.delete(id);
      checked.delete(id);
    }
    await remember();
    await broadcastState();
  })().catch((err: unknown) => logger.failure("agent", "Couldn't follow the account", err));
});

/** Removes the agent, its settings and its secrets; its chats stay, with no agent to run on. */
export async function removeAgent(id: AgentId): Promise<ProvidersState> {
  const current = await getProviderSettings();
  const entry = current.agents.find((a) => a.id === id);
  if (!entry) return providersState();
  await forget(entry);
  await saveProviderSettings({
    selected: current.selected === id ? null : current.selected,
    agents: current.agents.filter((a) => a.id !== id),
  });
  known.delete(id);
  logger.info("agent", "removed", { kind: entry.kind, id });
  const state = await providersState();
  broadcast("agent:providersChanged", state);
  return state;
}

function checkedPatch(type: AgentType, raw: unknown): Partial<AgentSettings> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = (type.fields as Record<string, string | undefined>)[key];
    if (field === "boolean" && typeof value === "boolean") out[key] = value;
    else if (field === "string" && typeof value === "string") out[key] = value.trim();
    else if (field === "runtimeMode" && RUNTIME_MODES.includes(value as never)) out[key] = value;
    else if (
      field === "strings" &&
      Array.isArray(value) &&
      value.every((v) => typeof v === "string")
    )
      out[key] = [...new Set(value)].sort();
  }
  return out as Partial<AgentSettings>;
}

function identityPatch(raw: unknown): Partial<Pick<AgentEntry, "name" | "avatar">> {
  const p = raw as Record<string, unknown> | null;
  const out: Partial<Pick<AgentEntry, "name" | "avatar">> = {};
  if (typeof p?.name === "string" && p.name.trim()) out.name = p.name.trim().slice(0, MAX_NAME);
  if (p?.avatar === "" || isMailboxPicture(p?.avatar))
    out.avatar = (p?.avatar as string) || undefined;
  return out;
}

/** `{ selected?, [id]: settings, name, avatar }`: what the windows change. */
export async function updateProviderSettings(
  patch: Record<string, unknown>,
): Promise<ProvidersState> {
  const current = await getProviderSettings();
  const changes: [AgentEntry, AgentType, Partial<AgentSettings>][] = [];
  const agents = current.agents.map((entry) => {
    const type = registeredAgents().get(entry.kind);
    if (!type || !(entry.id in patch)) return entry;
    const change = checkedPatch(type, patch[entry.id]);
    const next = {
      ...entry,
      ...identityPatch(patch[entry.id]),
      settings: { ...entry.settings, ...change },
    };
    if (Object.keys(change).length) changes.push([next, type, change]);
    return next;
  });
  const selected =
    typeof patch.selected === "string" && agents.some((a) => a.id === patch.selected)
      ? patch.selected
      : current.selected;
  await saveProviderSettings({ ...current, selected, agents });
  await remember();
  for (const [entry, type, change] of changes) restartIfNeeded(entry, type, change);
  const state = await providersState();
  broadcast("agent:providersChanged", state);
  return state;
}

function restartIfNeeded(
  entry: AgentEntry,
  type: AgentType,
  change: Record<string, unknown>,
): void {
  const provider = running.get(entry.id);
  if ((type.restartFields ?? []).some((key) => key in change)) {
    provider?.shutdown();
    checked.delete(entry.id);
    void check(entry.id);
  } else if ("enabled" in change) {
    if (settingsOf(type, entry).enabled) void check(entry.id);
    else provider?.shutdown();
  }
}

function emit(event: ChatEvent): void {
  broadcast("agent:chatEvent", event);
}

export async function sendTurn(id: AgentId, turn: SendTurnInput): Promise<void> {
  const { provider, settings, entry } = await agentOf(id);
  logger.info("agent", "send", {
    kind: entry.kind,
    id,
    requestId: turn.requestId,
    chars: turn.input.length,
    session: turn.sessionId ? "existing" : "new",
    skill: turn.skill?.name,
  });
  if (!settings.enabled) {
    emit({
      requestId: turn.requestId,
      type: "error",
      message: "provider_disabled",
    });
    return;
  }
  void provider.sendTurn(turn, settings, emit).catch((error: unknown) => {
    logger.info("agent", "turn crashed", {
      kind: entry.kind,
      id,
      error: String(error),
    });
    emit({
      requestId: turn.requestId,
      type: "error",
      message: "unreachable",
    });
  });
}

export async function resumeTurn(id: AgentId, turn: ResumeTurnInput): Promise<boolean> {
  const { provider, settings } = await agentOf(id);
  if (!provider.resume || !settings.enabled) return false;
  logger.info("agent", "resume", { id, requestId: turn.requestId });
  void provider.resume(turn, settings, emit).catch((error: unknown) => {
    logger.info("agent", "resume crashed", { id, error: String(error) });
    emit({ requestId: turn.requestId, type: "error", message: "detached" });
  });
  return true;
}

export async function watchSessions(id: AgentId, sessions: WatchedSession[]): Promise<void> {
  const { provider, settings } = await agentOf(id);
  if (!provider.watch || !settings.enabled) return;
  provider.watch(
    settings,
    sessions,
    (run) => broadcast("agent:runStarted", { provider: id, ...run }),
    (sessionId, cursor) => broadcast("agent:sessionRead", { provider: id, sessionId, cursor }),
  );
}

/** An agent's gateway delivered something to Otter: the agents that watch catch up on it. */
export async function agentDelivered(sessionKey?: string): Promise<void> {
  for (const { entry, type } of await runnable()) {
    const provider = instance(entry, type);
    const settings = settingsOf(type, entry);
    if (provider.delivered && settings.enabled) provider.delivered(settings, sessionKey);
  }
}

export type AgentNoticeKind = "approval" | "question" | "message" | "finished";

export interface AgentInAppNotice {
  id: string;
  kind: AgentNoticeKind;
  title: string;
  body?: string;
  chat?: string;
  agentName: string;
}

/** Asks already reported, by key, with settle timer and cancellation state. */
const asks = new Map<
  string,
  {
    viewing: boolean;
    appFocused: boolean;
    chat?: string;
    cancelled: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }
>();
/** How long every window (each web tab, the desktop window) gets to report an ask. */
const ASK_SETTLE_MS = 500;

/** Where it's from (the agent and its chat), then what happened, as mail says the mailbox, then who. */
function formatAgentNotice(
  kind: AgentNoticeKind,
  agentName: string,
  ask: { title: string; body?: string; chatTitle?: string; taskName?: string },
): { title: string; body?: string } {
  const where = ask.chatTitle?.trim() || ask.taskName?.trim();
  const title = where ? `${agentName} · ${where}` : agentName;
  const what = ask.body?.trim() || ask.title;
  switch (kind) {
    case "approval":
      return { title, body: `Needs approval: ${what}` };
    case "question":
      return { title, body: `Asks: ${what}` };
    case "message":
      return { title, body: ask.body?.trim() || "Sent you a message" };
    case "finished":
      return { title, body: ask.body?.trim() ? `Finished: ${ask.body.trim()}` : "Finished" };
  }
}

/** What the notification lets you do without opening the chat (macOS). */
function noticeActions(
  kind: AgentNoticeKind,
  agentName: string,
  options: string[] | undefined,
): { actions?: string[]; reply?: string } {
  switch (kind) {
    case "approval":
      return { actions: ["Approve", "Deny"] };
    case "question":
      return options ? { actions: options, reply: `Answer ${agentName}` } : {};
    case "message":
    case "finished":
      return { reply: `Reply to ${agentName}` };
  }
}

/**
 * What an agent asks of the user (an approval, a question), delivers or
 * finishes notifies once, when no window is actively viewing that chat:
 * - If another Otter window has focus (e.g. Mail or Calendar), sends a calm in-app notice.
 * - If Otter is in the background, shows a clearly tagged Agent OS notification.
 */
export function notifyAsk(
  id: AgentId,
  ask: {
    key: string;
    kind: AgentNoticeKind;
    title: string;
    body?: string;
    chat?: string;
    chatTitle?: string;
    taskName?: string;
    /** A question's choices, when one tap answers it. */
    options?: string[];
    /** Which of the agent's own agents the chat is with (an OpenClaw gateway's Rowan). */
    persona?: string;
    /** Its kind's mark (SVG), for an agent without a picture. */
    mark?: string;
    viewing: boolean;
    appFocused: boolean;
  },
): void {
  const seen = asks.get(ask.key);
  if (seen) {
    seen.viewing ||= ask.viewing;
    seen.appFocused ||= ask.appFocused;
    return;
  }
  const entry: {
    viewing: boolean;
    appFocused: boolean;
    chat?: string;
    cancelled: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } = { viewing: ask.viewing, appFocused: ask.appFocused, chat: ask.chat, cancelled: false };
  asks.set(ask.key, entry);
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    if (entry.viewing || entry.cancelled) return;
    void Promise.all([getSettings(), getProviderSettings()]).then(
      async ([settings, { agents }]) => {
        if (entry.viewing || entry.cancelled) return;
        const mode = settings.agentNotificationsMode ?? "all";
        if (mode === "off") return;
        if (mode === "needs-you" && ask.kind === "finished") return;
        const agent = agents.find((a) => a.id === id);
        const persona = ask.persona
          ? checked.get(id)?.models.find((m) => m.slug === ask.persona)
          : undefined;
        const agentName = persona?.name ?? agent?.name ?? "Your agent";
        const formatted = formatAgentNotice(ask.kind, agentName, ask);
        if (entry.appFocused) {
          broadcast("agent:inAppNotice", {
            id: ask.key,
            kind: ask.kind,
            ...formatted,
            chat: ask.chat,
            agentName,
          } satisfies AgentInAppNotice);
          return;
        }
        // An OpenClaw agent's picture may be on the web.
        // As the app shows it: its own picture (maybe on the web), else its emoji, else the agent's.
        const own = persona?.avatar?.startsWith("https:")
          ? ((await fetchImageAsDataUrl(persona.avatar).catch(() => null)) ?? undefined)
          : persona?.avatar;
        const emoji = persona?.emoji;
        const icon = own ?? (emoji ? undefined : agent?.avatar);
        if (entry.viewing || entry.cancelled) return;
        const where = ask.chatTitle?.trim() || ask.taskName?.trim();
        platform().notify({
          id: ask.key,
          category: "agent",
          ...formatted,
          ...noticeActions(ask.kind, agentName, ask.options),
          ...(icon ? { icon } : {}),
          agent: {
            id: persona ? `${id}:${persona.slug}` : id,
            name: agentName,
            ...(emoji ? { emoji } : {}),
            ...(ask.mark ? { mark: ask.mark } : {}),
            ...(where ? { conversation: where } : {}),
          },
          ...(ask.kind === "finished" ? { silent: true } : {}),
          chat: ask.chat,
        });
      },
    );
  }, ASK_SETTLE_MS);
}

/** Cancels in-flight notices and closes stale OS notifications when an ask is resolved or its chat opens. */
export function dismissNotification(match: { id?: string; chat?: string }): void {
  if (!match.id && !match.chat) return;
  for (const [key, entry] of asks) {
    if ((match.id && key === match.id) || (match.chat && entry.chat === match.chat)) {
      entry.cancelled = true;
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
    }
  }
  platform().dismissNotification?.(match);
}

export async function answerQuestion(
  id: AgentId,
  requestId: string,
  questionId: string,
  answers: Record<string, string[]> | null,
): Promise<void> {
  logger.info("agent", "question", { id, requestId, skipped: answers === null });
  await (await agentOf(id)).provider.answerQuestion?.(requestId, questionId, answers);
}

export async function respondApproval(
  id: AgentId,
  requestId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  logger.info("agent", "approval", { id, requestId, decision });
  if (answerToolApproval(approvalId, decision)) return;
  await (await agentOf(id)).provider.respondApproval(requestId, approvalId, decision);
}

export async function steerTurn(id: AgentId, requestId: string, input: string): Promise<boolean> {
  const accepted = await (await agentOf(id)).provider.steer(requestId, input);
  logger.info("agent", "steer", { id, requestId, accepted });
  return accepted;
}

export async function cancelTurn(id: AgentId, requestId: string): Promise<void> {
  (await agentOf(id)).provider.cancel(requestId);
}

export async function listSkills(id: AgentId): Promise<Skill[]> {
  const { provider, settings } = await agentOf(id);
  return provider.listSkills(settings);
}

export async function listSessions(
  id: AgentId,
  limit: number,
  everywhere = false,
): Promise<ChatSession[]> {
  const { provider, settings } = await agentOf(id);
  return provider.listSessions(settings, Math.min(Math.max(limit, 1), 200), everywhere);
}

export async function readSession(id: AgentId, sessionId: string): Promise<ChatSessionMessage[]> {
  const { provider, settings } = await agentOf(id);
  return provider.readSession(settings, sessionId);
}

export async function deleteSession(id: AgentId, sessionId: string): Promise<void> {
  const { provider, settings } = await agentOf(id);
  await provider.deleteSession(settings, sessionId);
}

export async function forkSession(id: AgentId, sessionId: string, before?: ForkPoint) {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.fork) throw new Error(`${entry.name} chats can't be forked.`);
  return provider.fork(settings, sessionId, before);
}

export async function retitleSession(
  id: AgentId,
  sessionId: string,
  name: { title: string } | { message: string },
): Promise<string | null> {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.retitle) throw new Error(`${entry.name} chats can't be retitled.`);
  return provider.retitle(settings, sessionId, name);
}

export async function browserView(id: AgentId, sessionId: string, request: BrowserViewRequest) {
  const { provider, settings } = await agentOf(id);
  if (!provider.browserView) return null;
  return provider.browserView(settings, sessionId, request);
}

export async function browserInput(id: AgentId, input: BrowserInput) {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.browserInput) throw new Error(`${entry.name}'s browser can't be controlled.`);
  await provider.browserInput(settings, input);
}

export async function browserEvents(
  id: AgentId,
  request: { targetId: string; profile?: string; since?: number; run?: string; waitMs: number },
) {
  const { provider, settings } = await agentOf(id);
  if (!provider.browserEvents) return null;
  return provider.browserEvents(settings, request);
}

export async function browserUpload(
  id: AgentId,
  upload: { targetId: string; profile?: string; files: { name: string; data: string }[] },
) {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.browserUpload) throw new Error(`${entry.name}'s browser can't take files.`);
  await provider.browserUpload(settings, upload);
}

async function talker(id: AgentId) {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.talk) throw new Error(`You can't talk with ${entry.name}.`);
  return { talk: provider.talk, settings };
}

/** Its events go to every window as `agent:talkEvent`; the one that started it plays them. */
export async function talkStart(id: AgentId, sessionId: string | undefined) {
  const { talk, settings } = await talker(id);
  return talk.start(settings, sessionId, (event) => broadcast("agent:talkEvent", event));
}

export const talkAudio = async (id: AgentId, talkId: string, audio: string) =>
  (await talker(id)).talk.audio(talkId, audio);

export const talkPlayed = async (id: AgentId, talkId: string, mark: string) =>
  (await talker(id)).talk.played(talkId, mark);

export const talkEnd = async (id: AgentId, talkId: string) => (await talker(id)).talk.end(talkId);

export async function readFile(id: AgentId, sessionId: string, href: string) {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.readFile)
    throw new Error(
      `${entry.name} hasn't made this file available. Ask it to attach the image directly.`,
    );
  return provider.readFile(settings, sessionId, href);
}

async function scheduler(id: AgentId) {
  const { provider, settings, entry } = await agentOf(id);
  if (!provider.schedules) throw new Error(`${entry.name} doesn't run scheduled tasks.`);
  return { schedules: provider.schedules, settings };
}

/** Every enabled agent's scheduled tasks; one that can't be reached says so without hiding the rest. */
export async function listScheduledTasks(): Promise<AgentScheduledTasks[]> {
  const agents = (await runnable()).filter(
    ({ entry, type }) => settingsOf(type, entry).enabled && instance(entry, type).schedules,
  );
  const listed = await Promise.all(
    agents.map(async ({ entry, type }): Promise<AgentScheduledTasks | null> => {
      const settings = settingsOf(type, entry);
      try {
        const found = await instance(entry, type).schedules!.list(settings);
        return (
          found && {
            ...found,
            provider: entry.id,
            tasks: found.tasks.map((task) => ({ ...task, provider: entry.id })),
          }
        );
      } catch (error) {
        return {
          provider: entry.id,
          tasks: [],
          error: error instanceof Error ? error.message : String(error),
          channels: [],
          can: {
            create: false,
            deliverToOtter: false,
            webhooks: false,
            history: false,
            timeZones: false,
          },
        };
      }
    }),
  );
  return listed.filter((agent) => agent !== null);
}

export async function saveScheduledTask(
  agent: AgentId,
  id: string | null,
  input: ScheduledTaskInput,
): Promise<string> {
  const { schedules, settings } = await scheduler(agent);
  return schedules.save(settings, id, input);
}

export async function setScheduledTaskEnabled(agent: AgentId, id: string, enabled: boolean) {
  const { schedules, settings } = await scheduler(agent);
  await schedules.setEnabled(settings, id, enabled);
}

export async function runScheduledTask(agent: AgentId, id: string): Promise<void> {
  const { schedules, settings } = await scheduler(agent);
  await schedules.runNow(settings, id);
}

export async function deleteScheduledTask(agent: AgentId, id: string): Promise<void> {
  const { schedules, settings } = await scheduler(agent);
  await schedules.remove(settings, id);
}

export async function scheduledTaskRuns(
  agent: AgentId,
  id: string,
  limit: number,
): Promise<TaskRun[]> {
  const { schedules, settings } = await scheduler(agent);
  return schedules.runs ? schedules.runs(settings, id, limit) : [];
}

export async function scheduledTargets(
  agent: AgentId,
  ownAgent: string,
  channel: string,
): Promise<ChannelTarget[]> {
  const { schedules, settings } = await scheduler(agent);
  return schedules.targets ? schedules.targets(settings, ownAgent, channel) : [];
}

export async function scheduledModels(agent: AgentId, ownAgent: string): Promise<TaskModels> {
  const { schedules, settings } = await scheduler(agent);
  return schedules.models ? schedules.models(settings, ownAgent) : { models: [] };
}

export async function scheduledRunTranscript(
  agent: AgentId,
  id: string,
  runId: string,
): Promise<ChatSessionMessage[]> {
  const { schedules, settings } = await scheduler(agent);
  return schedules.runTranscript ? schedules.runTranscript(settings, id, runId) : [];
}

export function shutdownProviders(): void {
  for (const provider of running.values()) provider.shutdown();
}
