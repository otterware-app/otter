/**
 * The agents' registry and routing layer (T3 Code's ProviderService in
 * miniature). The agents are extensions' (`context.registerAgent`): the
 * Hermes, OpenClaw and varys everywhere, Codex and Claude from the
 * desktop backend. Only what this backend runs is listed: the web app doesn't
 * show the Mac's agents.
 *
 * Health snapshots are managed like T3's: served from cache at once,
 * re-checked in the background when stale or when settings change, and
 * pushed to the windows as `agent:providersChanged`. Chat turns are
 * fire-and-forget; their events stream as `agent:chatEvent`.
 */

import type {
  AgentScheduledTasks,
  ChannelTarget,
  ScheduledTaskInput,
  TaskRun,
} from "@otter/contracts/scheduled";
import { registeredAgents } from "../../extensions.js";
import { broadcast } from "../../ipc.js";
import { logger } from "../../logger.js";
import { platform } from "../../platform.js";
import { getSettings } from "../settings-store.js";
import { answerToolApproval } from "./tools/index.js";
import {
  clearHermesKey,
  getHermesKey,
  getProviderSettings,
  saveProviderSettings,
  setHermesKey,
} from "./settings.js";
import {
  DEFAULT_AGENT,
  RUNTIME_MODES,
  type AgentSettings,
  type ApprovalDecision,
  type ChatEvent,
  type ChatProvider,
  type ChatSession,
  type BrowserInput,
  type BrowserViewRequest,
  type ChatSessionMessage,
  type ForkPoint,
  type ProviderKind,
  type ProviderSettings,
  type ProviderSnapshot,
  type ProvidersState,
  type ResumeTurnInput,
  type WatchedSession,
  type SendTurnInput,
  type Skill,
} from "./types.js";

function provider(kind: ProviderKind): ChatProvider {
  const found = registeredAgents().get(kind);
  if (!found) throw new Error("This agent isn't on this device.");
  return found;
}

function allSettings(): Promise<ProviderSettings> {
  return getProviderSettings(() =>
    Object.fromEntries([...registeredAgents()].map(([kind, agent]) => [kind, agent.defaults])),
  );
}

export async function agentSettings(kind: ProviderKind): Promise<AgentSettings> {
  return (await allSettings()).agents[kind] ?? provider(kind).defaults;
}

function selectedOf(settings: ProviderSettings): ProviderKind {
  const agents = registeredAgents();
  if (agents.has(settings.selected)) return settings.selected;
  return agents.has(DEFAULT_AGENT) ? DEFAULT_AGENT : ([...agents.keys()][0] ?? DEFAULT_AGENT);
}

const STALE_AFTER_MS = 5 * 60_000;

type Checked = Omit<ProviderSnapshot, "settings" | "forks" | "titles" | "liveBrowser">;
const checked = new Map<ProviderKind, Checked>();
const checking = new Map<ProviderKind, Promise<void>>();
/** Bumped when a check's answer may be stale before it lands (the Otter account changed). */
const generations = new Map<ProviderKind, number>();

function pendingSnapshot(agent: ChatProvider, settings: AgentSettings): Checked {
  return {
    kind: agent.kind,
    displayName: agent.displayName,
    enabled: settings.enabled,
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

export async function providersState(): Promise<ProvidersState> {
  const all = await allSettings();
  const providers = await Promise.all(
    [...registeredAgents().values()].map(async (agent) => {
      const settings = all.agents[agent.kind] ?? agent.defaults;
      const snapshot = checked.get(agent.kind) ?? pendingSnapshot(agent, settings);
      const fallback = snapshot.models.find((m) => m.isDefault)?.slug ?? snapshot.models[0]?.slug;
      const chosen =
        settings.model &&
        (!agent.strictModels || snapshot.models.some((m) => m.slug === settings.model))
          ? settings.model
          : null;
      return {
        ...snapshot,
        enabled: settings.enabled,
        status: settings.enabled ? snapshot.status : "disabled",
        model: chosen || fallback || null,
        forks: Boolean(agent.fork),
        titles: Boolean(agent.retitle),
        liveBrowser: Boolean(agent.browserView),
        settings: { ...settings, ...(await agent.settingsView?.(settings)) },
      } satisfies ProviderSnapshot;
    }),
  );
  for (const p of providers) {
    if (p.enabled && (!p.checkedAt || Date.now() - p.checkedAt > STALE_AFTER_MS))
      void check(p.kind);
  }
  return { providers, selected: selectedOf(all) };
}

async function broadcastState(): Promise<void> {
  broadcast("agent:providersChanged", await providersState());
}

function check(kind: ProviderKind): Promise<void> {
  const inFlight = checking.get(kind);
  if (inFlight) return inFlight;
  const generation = generations.get(kind) ?? 0;
  const run = (async () => {
    const agent = registeredAgents().get(kind);
    const settings = await agentSettings(kind);
    if (!agent || !settings.enabled) return;
    const result = await agent.checkStatus(settings);
    if (generation !== (generations.get(kind) ?? 0)) return;
    checked.set(kind, { ...result, enabled: true, checkedAt: Date.now() });
    logger.info("agent", "provider checked", {
      kind,
      status: result.status,
      version: result.version,
    });
  })()
    .catch((error: unknown) =>
      logger.info("agent", "provider check failed", {
        kind,
        error: String(error),
      }),
    )
    .finally(() => {
      checking.delete(kind);
      void broadcastState();
    });
  checking.set(kind, run);
  return run;
}

export async function refreshProviders(
  kinds: ProviderKind[] = [...registeredAgents().keys()],
): Promise<void> {
  await Promise.all(kinds.map(check));
}

export async function refreshProvider(kind: ProviderKind): Promise<void> {
  generations.set(kind, (generations.get(kind) ?? 0) + 1);
  await checking.get(kind);
  checked.delete(kind);
  await check(kind);
}

export async function saveAgentSettings(
  kind: ProviderKind,
  patch: Partial<AgentSettings> & Record<string, unknown>,
): Promise<void> {
  const current = await allSettings();
  await saveProviderSettings({
    ...current,
    agents: { ...current.agents, [kind]: { ...(await agentSettings(kind)), ...patch } },
  });
}

function checkedPatch(agent: ChatProvider, raw: unknown): Partial<AgentSettings> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const field = (agent.fields as Record<string, string | undefined>)[key];
    if (field === "boolean" && typeof value === "boolean") out[key] = value;
    else if (field === "string" && typeof value === "string") out[key] = value.trim();
    else if (field === "runtimeMode" && RUNTIME_MODES.includes(value as never)) out[key] = value;
  }
  return out as Partial<AgentSettings>;
}

export async function updateProviderSettings(
  patch: Record<string, unknown>,
): Promise<ProvidersState> {
  const current = await allSettings();
  const agents = { ...current.agents };
  const changes = new Map<ProviderKind, Partial<AgentSettings>>();
  for (const [kind, agent] of registeredAgents()) {
    const change = checkedPatch(agent, patch[kind]);
    if (Object.keys(change).length === 0) continue;
    agents[kind] = { ...(agents[kind] ?? agent.defaults), ...change };
    changes.set(kind, change);
  }
  const selected =
    typeof patch.selected === "string" && registeredAgents().has(patch.selected)
      ? patch.selected
      : current.selected;
  await saveProviderSettings({ selected, agents });
  for (const [kind, change] of changes) restartIfNeeded(provider(kind), change, agents[kind]);
  const state = await providersState();
  broadcast("agent:providersChanged", state);
  return state;
}

function restartIfNeeded(
  agent: ChatProvider,
  change: Record<string, unknown>,
  next: AgentSettings,
): void {
  if ((agent.restartFields ?? []).some((key) => key in change)) {
    agent.shutdown();
    checked.delete(agent.kind);
    void check(agent.kind);
  } else if ("enabled" in change) {
    if (next.enabled) void check(agent.kind);
    else agent.shutdown();
  }
}

function emit(event: ChatEvent): void {
  broadcast("agent:chatEvent", event);
}

export async function sendTurn(kind: ProviderKind, turn: SendTurnInput): Promise<void> {
  const settings = await agentSettings(kind);
  logger.info("agent", "send", {
    provider: kind,
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
  void provider(kind)
    .sendTurn(turn, settings, emit)
    .catch((error: unknown) => {
      logger.info("agent", "turn crashed", {
        provider: kind,
        error: String(error),
      });
      emit({
        requestId: turn.requestId,
        type: "error",
        message: "unreachable",
      });
    });
}

export async function resumeTurn(kind: ProviderKind, turn: ResumeTurnInput): Promise<boolean> {
  const found = provider(kind);
  const settings = await agentSettings(kind);
  if (!found.resume || !settings.enabled) return false;
  logger.info("agent", "resume", { provider: kind, requestId: turn.requestId });
  void found.resume(turn, settings, emit).catch((error: unknown) => {
    logger.info("agent", "resume crashed", { provider: kind, error: String(error) });
    emit({ requestId: turn.requestId, type: "error", message: "detached" });
  });
  return true;
}

export async function watchSessions(kind: ProviderKind, sessions: WatchedSession[]): Promise<void> {
  const found = provider(kind);
  const settings = await agentSettings(kind);
  if (!found.watch || !settings.enabled) return;
  found.watch(
    settings,
    sessions,
    (run) => broadcast("agent:runStarted", { provider: kind, ...run }),
    (sessionId, cursor) => broadcast("agent:sessionRead", { provider: kind, sessionId, cursor }),
  );
}

/** An agent's gateway delivered something to Otter: the providers that watch catch up on it. */
export async function agentDelivered(sessionKey?: string): Promise<void> {
  for (const found of registeredAgents().values()) {
    if (!found.delivered) continue;
    const settings = await agentSettings(found.kind);
    if (settings.enabled) found.delivered(settings, sessionKey);
  }
}

/** Asks already reported, by key, and whether a window that had focus reported them. */
const asks = new Map<string, { focused: boolean }>();
/** How long every window (each web tab, the desktop window) gets to report an ask. */
const ASK_SETTLE_MS = 500;

/**
 * What an agent asks of the user (an approval, a question), delivers or
 * finishes notifies once, when no window that showed it had focus: every window
 * reports it, a turn picked up again reports it again.
 */
export function notifyAsk(
  kind: ProviderKind,
  ask: {
    key: string;
    title: string;
    subtitle?: string;
    body?: string;
    chat?: string;
    focused: boolean;
  },
): void {
  const seen = asks.get(ask.key);
  if (seen) {
    seen.focused ||= ask.focused;
    return;
  }
  const entry = { focused: ask.focused };
  asks.set(ask.key, entry);
  setTimeout(() => {
    if (entry.focused) return;
    void getSettings().then((settings) => {
      if (settings.notificationsMode === "off") return;
      platform().notify({
        title: ask.title,
        subtitle: ask.subtitle ?? `${provider(kind).displayName} is waiting for you`,
        body: ask.body,
        chat: ask.chat,
      });
    });
  }, ASK_SETTLE_MS);
}

export async function answerQuestion(
  kind: ProviderKind,
  requestId: string,
  questionId: string,
  answers: Record<string, string[]> | null,
): Promise<void> {
  logger.info("agent", "question", { provider: kind, requestId, skipped: answers === null });
  await provider(kind).answerQuestion?.(requestId, questionId, answers);
}

export async function respondApproval(
  kind: ProviderKind,
  requestId: string,
  approvalId: string,
  decision: ApprovalDecision,
): Promise<void> {
  logger.info("agent", "approval", { provider: kind, requestId, decision });
  if (answerToolApproval(approvalId, decision)) return;
  await provider(kind).respondApproval(requestId, approvalId, decision);
}

export async function steerTurn(
  kind: ProviderKind,
  requestId: string,
  input: string,
): Promise<boolean> {
  const accepted = await provider(kind).steer(requestId, input);
  logger.info("agent", "steer", { provider: kind, requestId, accepted });
  return accepted;
}

export function cancelTurn(kind: ProviderKind, requestId: string): void {
  provider(kind).cancel(requestId);
}

export async function listSkills(kind: ProviderKind): Promise<Skill[]> {
  return provider(kind).listSkills(await agentSettings(kind));
}

export async function listSessions(kind: ProviderKind, limit: number): Promise<ChatSession[]> {
  return provider(kind).listSessions(await agentSettings(kind), Math.min(Math.max(limit, 1), 200));
}

export async function readSession(
  kind: ProviderKind,
  sessionId: string,
): Promise<ChatSessionMessage[]> {
  return provider(kind).readSession(await agentSettings(kind), sessionId);
}

export async function deleteSession(kind: ProviderKind, sessionId: string): Promise<void> {
  await provider(kind).deleteSession(await agentSettings(kind), sessionId);
}

export async function forkSession(kind: ProviderKind, sessionId: string, before?: ForkPoint) {
  const found = provider(kind);
  if (!found.fork) throw new Error(`${found.displayName} chats can't be forked.`);
  return found.fork(await agentSettings(kind), sessionId, before);
}

export async function retitleSession(
  kind: ProviderKind,
  sessionId: string,
  name: { title: string } | { message: string },
): Promise<string | null> {
  const found = provider(kind);
  if (!found.retitle) throw new Error(`${found.displayName} chats can't be retitled.`);
  return found.retitle(await agentSettings(kind), sessionId, name);
}

export async function browserView(
  kind: ProviderKind,
  sessionId: string,
  request: BrowserViewRequest,
) {
  const found = provider(kind);
  if (!found.browserView) return null;
  return found.browserView(await agentSettings(kind), sessionId, request);
}

export async function browserInput(kind: ProviderKind, input: BrowserInput) {
  const found = provider(kind);
  if (!found.browserInput) throw new Error(`${found.displayName}'s browser can't be controlled.`);
  await found.browserInput(await agentSettings(kind), input);
}

export async function browserEvents(
  kind: ProviderKind,
  request: { targetId: string; profile?: string; since?: number; run?: string; waitMs: number },
) {
  const found = provider(kind);
  if (!found.browserEvents) return null;
  return found.browserEvents(await agentSettings(kind), request);
}

export async function browserUpload(
  kind: ProviderKind,
  upload: { targetId: string; profile?: string; files: { name: string; data: string }[] },
) {
  const found = provider(kind);
  if (!found.browserUpload) throw new Error(`${found.displayName}'s browser can't take files.`);
  await found.browserUpload(await agentSettings(kind), upload);
}

function talker(kind: ProviderKind) {
  const found = provider(kind);
  if (!found.talk) throw new Error(`You can't talk with ${found.displayName}.`);
  return found.talk;
}

/** Its events go to every window as `agent:talkEvent`; the one that started it plays them. */
export async function talkStart(kind: ProviderKind, sessionId: string | undefined) {
  return talker(kind).start(await agentSettings(kind), sessionId, (event) =>
    broadcast("agent:talkEvent", event),
  );
}

export const talkAudio = (kind: ProviderKind, talkId: string, audio: string) =>
  talker(kind).audio(talkId, audio);

export const talkPlayed = (kind: ProviderKind, talkId: string, mark: string) =>
  talker(kind).played(talkId, mark);

export const talkEnd = (kind: ProviderKind, talkId: string) => talker(kind).end(talkId);

export async function readFile(kind: ProviderKind, sessionId: string, href: string) {
  const found = provider(kind);
  if (!found.readFile)
    throw new Error(
      `${found.displayName} hasn't made this file available. Ask it to attach the image directly.`,
    );
  return found.readFile(await agentSettings(kind), sessionId, href);
}

function scheduler(kind: ProviderKind) {
  const found = provider(kind);
  if (!found.schedules) throw new Error(`${found.displayName} doesn't run scheduled tasks.`);
  return found.schedules;
}

/** Every enabled agent's scheduled tasks; one that can't be reached says so without hiding the rest. */
export async function listScheduledTasks(): Promise<AgentScheduledTasks[]> {
  const all = await allSettings();
  const agents = [...registeredAgents().values()].filter(
    (agent) => agent.schedules && (all.agents[agent.kind] ?? agent.defaults).enabled,
  );
  const listed = await Promise.all(
    agents.map(async (agent): Promise<AgentScheduledTasks | null> => {
      const settings = all.agents[agent.kind] ?? agent.defaults;
      try {
        const found = await agent.schedules!.list(settings);
        return found && { provider: agent.kind, ...found };
      } catch (error) {
        return {
          provider: agent.kind,
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
  kind: ProviderKind,
  id: string | null,
  input: ScheduledTaskInput,
): Promise<string> {
  return scheduler(kind).save(await agentSettings(kind), id, input);
}

export async function setScheduledTaskEnabled(kind: ProviderKind, id: string, enabled: boolean) {
  await scheduler(kind).setEnabled(await agentSettings(kind), id, enabled);
}

export async function runScheduledTask(kind: ProviderKind, id: string): Promise<void> {
  await scheduler(kind).runNow(await agentSettings(kind), id);
}

export async function deleteScheduledTask(kind: ProviderKind, id: string): Promise<void> {
  await scheduler(kind).remove(await agentSettings(kind), id);
}

export async function scheduledTaskRuns(
  kind: ProviderKind,
  id: string,
  limit: number,
): Promise<TaskRun[]> {
  const found = scheduler(kind);
  return found.runs ? found.runs(await agentSettings(kind), id, limit) : [];
}

export async function scheduledTargets(
  kind: ProviderKind,
  agent: string,
  channel: string,
): Promise<ChannelTarget[]> {
  const found = scheduler(kind);
  return found.targets ? found.targets(await agentSettings(kind), agent, channel) : [];
}

export async function scheduledRunTranscript(
  kind: ProviderKind,
  id: string,
  runId: string,
): Promise<ChatSessionMessage[]> {
  const found = scheduler(kind);
  return found.runTranscript ? found.runTranscript(await agentSettings(kind), id, runId) : [];
}

export function shutdownProviders(): void {
  for (const found of registeredAgents().values()) found.shutdown();
}

/**
 * Each agent's settings follow the account, except its device fields (where
 * a CLI lives) and agents that are this device's alone (OpenClaw's pairing).
 * Agents this device doesn't run keep the account's as they were.
 */
export type SyncedProviderSettings = { selected: ProviderKind } & Record<string, unknown>;

const synced = (agent: ChatProvider | undefined, settings: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !(agent?.deviceFields as readonly string[] | undefined)?.includes(key),
    ),
  );

export async function syncedProviderSettings(): Promise<SyncedProviderSettings> {
  const { selected, agents } = await allSettings();
  const out: SyncedProviderSettings = { selected };
  for (const [kind, settings] of Object.entries(agents)) {
    const agent = registeredAgents().get(kind);
    if (agent?.localOnly) continue;
    out[kind] = synced(agent, settings);
  }
  return out;
}

export async function applySyncedProviderSettings(
  remote: Partial<SyncedProviderSettings>,
): Promise<void> {
  const current = await allSettings();
  const agents = { ...current.agents };
  const changed: [ChatProvider, Record<string, unknown>][] = [];
  for (const [kind, agent] of registeredAgents()) {
    const theirs = remote[kind];
    if (agent.localOnly || !theirs || typeof theirs !== "object") continue;
    const before = agents[kind] ?? agent.defaults;
    const next = {
      ...before,
      ...synced(agent, theirs as Record<string, unknown>),
    } as AgentSettings;
    agents[kind] = next;
    const diff = Object.fromEntries(
      Object.entries(next).filter(([key, value]) => before[key as keyof AgentSettings] !== value),
    );
    if (Object.keys(diff).length) changed.push([agent, diff]);
  }
  const selected =
    typeof remote.selected === "string" && registeredAgents().has(remote.selected)
      ? remote.selected
      : current.selected;
  await saveProviderSettings({ selected, agents });
  for (const [agent, diff] of changed) restartIfNeeded(agent, diff, agents[agent.kind]);
  await broadcastState();
}

export async function forgetHermesKey(): Promise<void> {
  await clearHermesKey();
  if (registeredAgents().has("hermes")) await refreshProvider("hermes");
}

export async function applySyncedHermesKey(key: string): Promise<void> {
  if (key === (await getHermesKey())) return;
  await setHermesKey(key);
  if (registeredAgents().has("hermes")) void refreshProvider("hermes");
}
