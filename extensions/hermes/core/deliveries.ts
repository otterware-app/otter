/**
 * What Hermes has for you that no message of yours asked for, as runs of the agent's own
 * (`ChatProvider.watch`): what it sent to Otter through Otter's plugin (a session of source
 * "otter", a new chat), what it wrote into one of your chats (a delivery to it, a background
 * task finishing), and, without the plugin, the runs of jobs that keep their results on Hermes.
 * Checked every minute, and at once when Otter's relay says Hermes delivered something.
 */

import { agentSettings, logger } from "@otter/core/extension-kit";
import type {
  AgentContext,
  AgentRun,
  ChatSessionMessage,
  WatchedSession,
} from "@otter/core/extension-kit";
import type { ChatDelivery } from "@otter/contracts/chats";

import {
  listSessions,
  rawMessages,
  requireReady,
  sessionMessages,
  toMessage,
  toMillis,
  type RawSession,
  type Ready,
} from "./http.js";
import type { Runs } from "./runs.js";
import {
  SILENT,
  finalReply,
  jobOf,
  jobsRequest,
  runReply,
  toOtter,
  type HermesJob,
} from "./schedules.js";
import type { HermesSettings } from "./settings.js";

/** A delivery's request id: `delivered:<session>`, or `delivered:<session>@<message>` for what follows a message. */
export const DELIVERED = "delivered:";

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** How far back a device that hasn't seen them catches up: the day's deliveries. */
const BACKLOG_MS = 24 * 60 * 60 * 1000;
const POLL_MS = 60_000;
/** A chat list that changes often (each message) needn't ask Hermes each time. */
const RECHECK_MS = 15_000;

type Watching = {
  sessions: Map<string, WatchedSession>;
  started: (run: AgentRun) => void;
  read?: (sessionId: string, cursor: string) => void;
};

/** One agent's watch over its server. */
export type Deliveries = {
  agent: AgentContext;
  runs: Runs;
  watching: Watching | null;
  poll?: ReturnType<typeof setInterval>;
  checking: Promise<void> | null;
  again: boolean;
  checkedAt: number;
  /** Sessions already shown, or with nothing to show. */
  seen: Set<string>;
  /** Each watched session's `last_active` when it was last read, so an unchanged one isn't read again. */
  readAt: Map<string, number>;
  /** Where each chat's own turns ended in its session (the last message id), as this device saw them end. */
  ownTo: Map<string, number>;
};

export const newDeliveries = (agent: AgentContext, runs: Runs): Deliveries => ({
  agent,
  runs,
  watching: null,
  checking: null,
  again: false,
  checkedAt: 0,
  seen: new Set(),
  readAt: new Map(),
  ownTo: new Map(),
});

/** Hermes numbers titles it has used before: "Morning brief #2". */
const untitled = (title: string) => title.replace(/ #\d+$/, "");

const said = (reply: ChatSessionMessage[]) => {
  const text = finalReply(reply);
  return Boolean(text) && !text.startsWith(SILENT);
};

function automation(job: HermesJob): ChatDelivery {
  const schedule = job.schedule_display ?? job.schedule?.display;
  return {
    kind: "automation",
    jobId: job.id,
    ...(job.name ? { name: job.name } : {}),
    ...(schedule ? { schedule } : {}),
  };
}

/** A session no chat has (a job's run, a delivery): it starts one. */
async function newChats(
  d: Deliveries,
  w: Watching,
  ready: Ready,
  sessions: RawSession[],
  deliveryOf: (session: RawSession) => ChatDelivery | null,
): Promise<void> {
  const since = Date.now() - BACKLOG_MS;
  for (const session of sessions) {
    const id = String(session.id ?? "");
    // A job's run is shown once it has finished.
    if (session.source === "cron" && !session.ended_at) continue;
    const at = toMillis(session.ended_at) || toMillis(session.last_active);
    if (!id || d.seen.has(id) || w.sessions.has(id) || !at) continue;
    if (at < since) {
      d.seen.add(id);
      continue;
    }
    const delivery = deliveryOf(session);
    if (!delivery) continue;
    const reply = runReply(await sessionMessages(ready, id));
    // The chats watched change as they're made: the session is shown if none has it yet.
    const now = d.watching;
    if (!now) return;
    d.seen.add(id);
    if (!said(reply) || now.sessions.has(id)) continue;
    const title =
      delivery.kind === "automation"
        ? (delivery.name ?? "Scheduled")
        : untitled(session.title ?? "") || "Hermes";
    logger.info("agent", "hermes delivery", { session: id });
    now.started({
      sessionId: id,
      requestId: `${DELIVERED}${id}`,
      chat: { title: `${title} · ${shortDate(at)}` },
      deliveredAt: at,
      delivery,
    });
  }
}

/** A turn of yours ended at message `last`: what follows it is Hermes's own. */
export function ranTo(d: Deliveries, sessionId: string, last: number): void {
  d.ownTo.set(sessionId, Math.max(last, d.ownTo.get(sessionId) ?? -1));
  const chat = d.watching?.sessions.get(sessionId);
  if (!chat || Number(chat.cursor ?? -1) >= last) return;
  chat.cursor = String(last);
  d.watching?.read?.(sessionId, chat.cursor);
}

/** What Hermes wrote into a chat since it was last read, when no message of yours led to it. */
async function inChats(
  d: Deliveries,
  w: Watching,
  ready: Ready,
  recent: RawSession[],
): Promise<void> {
  const active = new Map(recent.map((s) => [String(s.id), toMillis(s.last_active)]));
  for (const [id, chat] of w.sessions) {
    const lastActive = active.get(id);
    // A turn going in the chat follows all it leads to.
    if (lastActive === undefined || chat.since === Number.MAX_SAFE_INTEGER) continue;
    if ([...d.runs.following.values()].some((run) => run.sessionId === id)) continue;
    if (d.readAt.get(id) === lastActive) continue;
    const rows = await rawMessages(ready, id, 50);
    d.readAt.set(id, lastActive);
    const last = rows.at(-1)?.id;
    if (last === undefined) continue;
    const from = Math.max(Number(chat.cursor ?? -1) || -1, d.ownTo.get(id) ?? -1);
    if (from >= last) continue;
    // A chat not read yet: what followed your last message (unless that came since, from
    // another of Hermes's apps), after the chat last ended.
    const yours = rows.findLastIndex((m) => m.role === "user");
    const added =
      from >= 0
        ? rows.filter((m) => (m.id ?? 0) > from)
        : rows.slice(yours + 1).filter((m) => toMillis(m.timestamp) > chat.since);
    if (from < 0 && yours >= 0 && toMillis(rows[yours].timestamp) > chat.since)
      added.unshift(rows[yours]);
    w.read?.(id, String(last));
    chat.cursor = String(last);
    // A message from another of Hermes's apps is a turn, not a delivery.
    if (!added.length || added.some((m) => m.role === "user") || !said(added.map(toMessage)))
      continue;
    logger.info("agent", "hermes wrote in a chat", { session: id });
    w.started({
      sessionId: id,
      requestId: `${DELIVERED}${id}@${(added[0].id ?? 1) - 1}`,
      deliveredAt: toMillis(added.at(-1)?.timestamp) || Date.now(),
      delivery: { kind: "message", from: "Hermes" },
    });
  }
}

async function checkDeliveries(d: Deliveries): Promise<void> {
  const w = d.watching;
  if (!w) return;
  // As they are now: a task turned off, here or on another device, stays off.
  const settings = (await agentSettings(d.agent.id)) as HermesSettings;
  const ready = await requireReady(settings, d.agent.secrets).catch(() => null);
  if (!ready) return;
  const [cron, sent, recent, { jobs }] = await Promise.all([
    listSessions(ready, 100, "cron"),
    listSessions(ready, 50, "otter"),
    listSessions(ready, 200),
    jobsRequest<{ jobs: HermesJob[] }>(ready, "?include_disabled=true"),
  ]);
  await newChats(d, w, ready, sent, (session) => {
    const name = untitled(session.title ?? "");
    const job = jobs.find((j) => j.name && j.name === name);
    return job ? automation(job) : { kind: "message", from: "Hermes" };
  });
  await newChats(d, w, ready, cron, (session) => {
    const job = jobOf(session, jobs);
    return job && toOtter(job, settings) ? automation(job) : null;
  });
  if (d.watching) await inChats(d, d.watching, ready, recent);
}

function check(d: Deliveries): void {
  d.checkedAt = Date.now();
  if (d.checking) {
    d.again = true;
    return;
  }
  d.checking = checkDeliveries(d)
    .catch((error: unknown) =>
      logger.info("agent", "hermes deliveries unavailable", { error: String(error) }),
    )
    .finally(() => {
      d.checking = null;
      if (!d.again) return;
      d.again = false;
      check(d);
    });
}

export function watchDeliveries(
  d: Deliveries,
  sessions: WatchedSession[],
  started: (run: AgentRun) => void,
  read?: (sessionId: string, cursor: string) => void,
): void {
  d.watching = { sessions: new Map(sessions.map((s) => [s.id, { ...s }])), started, read };
  d.poll ??= setInterval(() => check(d), POLL_MS);
  if (Date.now() - d.checkedAt > RECHECK_MS) check(d);
}

/** Otter's relay says Hermes delivered something: look now. */
export function deliveredNow(d: Deliveries): void {
  if (d.watching) check(d);
}

export function stopWatching(d: Deliveries): void {
  d.watching = null;
  d.checkedAt = 0;
  clearInterval(d.poll);
  d.poll = undefined;
}

/** A delivery, as its chat's turn: the session's replies, or what follows a message in it. */
export async function deliveredReply(
  ready: Ready,
  requestId: string,
): Promise<ChatSessionMessage[]> {
  const [sessionId, after] = requestId.slice(DELIVERED.length).split("@");
  if (after === undefined) return runReply(await sessionMessages(ready, sessionId));
  const added = (await rawMessages(ready, sessionId, 50)).filter(
    (m) => (m.id ?? 0) > Number(after),
  );
  const yours = added.findIndex((m) => m.role === "user");
  return runReply((yours < 0 ? added : added.slice(0, yours)).map(toMessage));
}
