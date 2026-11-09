/**
 * What varys does that no message of yours started (`ChatProvider.watch`), over Live:
 *
 * - a run in one of your chats (a routine reporting into it, a task it set itself): the thread
 *   list shows the chat's thread running, and the run is followed while it goes on, then shown
 *   as the chat follows it (`resume`);
 * - what it wrote into a chat between runs, or while the app was away: caught up on from where
 *   the chat was read, once the thread list shows it changed;
 * - a routine's run in a thread of its own: a new chat, once it has ended.
 *
 * Otter's relay saying varys delivered something (`delivered`) catches up at once.
 */

import type {
  RoutineList,
  ThreadList,
  ThreadRoutine,
  ThreadView,
  TranscriptItem,
  TurnEvent,
  Varys,
} from "@generalpursuit/varys";
import type { ChatDelivery } from "@otter/contracts/chats";
import {
  logger,
  type AgentRun,
  type ChatEvent,
  type Emit,
  type WatchedSession,
} from "@otter/core/extension-kit";

import { answered } from "./client.js";
import { scheduleText } from "./schedules.js";
import type { VarysSettings } from "./settings.js";
import {
  endTurn,
  following,
  messagesOf,
  newTurn,
  onTurnEvent,
  placed,
  type Turn,
} from "./turns.js";

/** A run the agent started in a chat: `agent:<thread>:<uuid>`. */
export const AGENT_RUN = "agent:";
/**
 * What it wrote while no run was followed: `delivered:<thread>` for all of a new chat's thread,
 * `delivered:<thread>@<item>` for what follows an item in a chat's.
 */
export const DELIVERED = "delivered:";

/** How far back a device that hasn't seen them catches up: the day's routine runs. */
const BACKLOG_MS = 24 * 60 * 60 * 1000;

type Follow = { close: () => void; inRun: boolean };

type Watching = {
  varys: Varys;
  sessions: Map<string, WatchedSession>;
  started: (run: AgentRun) => void;
  read?: (sessionId: string, cursor: string) => void;
  muted: Set<string>;
  /** When watching began: routine runs from the day before it are caught up on. */
  since: number;
  /** The thread list as Live last showed it. */
  threads: ThreadList | null;
  /** Each watched thread's last change, as the thread list showed it. */
  updated: Map<string, string>;
  /** Chats' threads followed while a run goes on in them. */
  follows: Map<string, Follow>;
  stop: (() => void)[];
};

let watching: Watching | null = null;
/** Routine runs already shown, or not to show. */
const seenRuns = new Set<string>();

/** Runs the agent started, kept until their chat follows them, then followed. */
const agentRuns = new Map<string, { turn: Turn; held: ChatEvent[]; ended: boolean }>();

const shortDate = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** What the agent says in these items: a reply, or a report it wrote here. */
const says = (items: readonly TranscriptItem[]) =>
  items.some(
    (i) => (i.type === "answer" && i.text.trim()) || (i.type === "note" && i.from !== undefined),
  );

/** When the last of these items was said; now, when none says. */
function saidAt(items: readonly TranscriptItem[]): number {
  for (const item of items.toReversed())
    if (item.type !== "result" && item.at) return Date.parse(item.at);
  return Date.now();
}

const ENDS = new Set<TurnEvent["type"]>(["done", "stopped", "failed"]);

/** The item an event shows, where it has its place in the transcript. */
function itemOf(event: TurnEvent): TranscriptItem | undefined {
  switch (event.type) {
    case "answer":
      return event.answer;
    case "result":
      return event.result;
    case "note":
      return event.note;
    case "message":
      return event.message;
    default:
      return undefined;
  }
}

/** Who a delivery is from: a routine, as Scheduled names it, or the agent. */
const deliveryOf = (routine?: ThreadRoutine | null): ChatDelivery =>
  routine
    ? { kind: "automation", jobId: routine.id, name: routine.title }
    : { kind: "message", from: "varys" };

function readTo(w: Watching, threadId: string, cursor: string): void {
  const chat = w.sessions.get(threadId);
  if (!chat || Number(chat.cursor ?? -1) >= Number(cursor)) return;
  chat.cursor = cursor;
  w.read?.(threadId, cursor);
}

/** A run the agent started: held until the chat follows it with `resume`. */
function agentRun(w: Watching, threadId: string, routine?: ThreadRoutine): Turn {
  const requestId = `${AGENT_RUN}${threadId}:${crypto.randomUUID()}`;
  const held: ChatEvent[] = [];
  const turn = newTurn(requestId, threadId, w.varys, (event) => held.push(event));
  agentRuns.set(requestId, { turn, held, ended: false });
  logger.info("agent", "varys run of its own", { requestId });
  w.started({
    sessionId: threadId,
    requestId,
    deliveredAt: Date.now(),
    delivery: deliveryOf(routine),
  });
  return turn;
}

/**
 * A chat's thread while a run goes on in it, or waits for your answer, until it ends. One a
 * message started (yours, from anywhere) isn't the agent's: that message's own turn shows it.
 */
function followThread(w: Watching, threadId: string): Follow {
  let run: Turn | null = null;
  let starting = false;
  let routine: ThreadRoutine | undefined;
  let last: string | undefined;
  const follow: Follow = { close: () => {}, inRun: false };
  const followed = w.varys.threads.follow(threadId, (event) => {
    const item = itemOf(event);
    if (item && placed(item)) last = item.id;
    if (event.type === "started") {
      follow.inRun = starting = true;
      routine = event.routine;
      return;
    }
    if (starting) {
      starting = false;
      if (event.type !== "message") run = agentRun(w, threadId, routine);
    }
    const end = run ? onTurnEvent(run, event) : undefined;
    if (run && end) {
      const kept = agentRuns.get(run.requestId);
      if (kept) kept.ended = true;
      endTurn(run, end);
    }
    if (!ENDS.has(event.type)) return;
    if (last) readTo(w, threadId, last);
    follow.close();
  });
  follow.close = () => {
    followed.close();
    if (w.follows.get(threadId) === follow) w.follows.delete(threadId);
  };
  return follow;
}

/**
 * A turn going in the chat, followed here or about to be picked up again (`resume`): it shows all
 * it leads to, waiting for your answer included.
 */
const turnIn = (chat: WatchedSession) =>
  chat.since === Number.MAX_SAFE_INTEGER ||
  [...following.values()].some(({ turn }) => turn.threadId === chat.id);

/** What the agent wrote into a chat since it was read, when no message led to it. */
async function catchUp(w: Watching, chat: WatchedSession): Promise<void> {
  if (turnIn(chat)) return;
  const view = await answered(w.varys.threads.read(chat.id));
  if (view.conversation.running || watching !== w || w.follows.has(chat.id)) return;
  const items = view.conversation.items;
  const from = chat.cursor
    ? items.findIndex((i) => placed(i) && Number(i.id) > Number(chat.cursor))
    : items.findIndex((i) => i.type !== "result" && i.at && Date.parse(i.at) > chat.since);
  const lastPlaced = items.findLast(placed)?.id;
  if (lastPlaced) readTo(w, chat.id, lastPlaced);
  if (from < 0) return;
  const added = items.slice(from);
  // A message of yours (from varys's own app) is a turn, not a delivery.
  if (added.some((i) => i.type === "message") || !says(added)) return;
  const before = items.slice(0, from).findLast(placed)?.id ?? "0";
  logger.info("agent", "varys wrote in a chat", { thread: chat.id });
  w.started({
    sessionId: chat.id,
    requestId: `${DELIVERED}${chat.id}@${before}`,
    deliveredAt: saidAt(added),
    delivery: deliveryOf(view.routine),
  });
}

const failedTo = (what: string) => (error: unknown) =>
  logger.info("agent", `varys ${what} failed`, { error: String(error) });

/**
 * The chats' threads as the list shows them: one that runs is followed (unless it's a message
 * of yours from this device), one that changed while idle is caught up on.
 */
function onThreads(w: Watching): void {
  for (const thread of w.threads?.threads ?? []) {
    const chat = w.sessions.get(thread.id);
    if (!chat) continue;
    const seen = w.updated.get(thread.id);
    w.updated.set(thread.id, thread.updatedAt);
    const follow = w.follows.get(thread.id);
    if (thread.status === "running" || thread.status === "waiting") {
      if (!follow && !turnIn(chat)) w.follows.set(thread.id, followThread(w, thread.id));
      continue;
    }
    // A run's end comes through its follow; one that never showed it ended before it began.
    if (follow?.inRun) continue;
    follow?.close();
    const changed =
      seen === undefined ? Date.parse(thread.updatedAt) > chat.since : seen !== thread.updatedAt;
    if (changed || follow) void catchUp(w, chat).catch(failedTo("catch-up"));
  }
}

/** A routine's latest run: a new chat once it has ended, or what it wrote into a chat's thread. */
function onRoutines(w: Watching, list: RoutineList): void {
  for (const routine of list.routines) {
    const run = routine.lastRun;
    if (!run || run.state !== "ended" || seenRuns.has(run.id)) continue;
    seenRuns.add(run.id);
    // A routine that reports into a thread of its own names it once it has reported there.
    const threadId = (routine.delivery === "into_thread" && routine.threadId) || run.threadId;
    const at = Date.parse(run.endedAt ?? run.startedAt);
    if (
      !threadId ||
      w.sessions.has(threadId) ||
      at < w.since - BACKLOG_MS ||
      w.muted.has(routine.id) ||
      (routine.delivery === "when_reported" && run.outcome === "nothing_new")
    )
      continue;
    logger.info("agent", "varys routine run", { routine: routine.id, run: run.id });
    const schedule = scheduleText(routine.trigger);
    w.started({
      sessionId: threadId,
      requestId: `${DELIVERED}${threadId}`,
      chat: { title: `${routine.title} · ${shortDate(at)}` },
      deliveredAt: at,
      delivery: {
        kind: "automation",
        jobId: routine.id,
        name: routine.title,
        ...(schedule && { schedule }),
      },
    });
  }
}

/** A thread no chat has yet, named by Otter's relay: a chat, when the agent started it on its own. */
async function newThread(w: Watching, threadId: string): Promise<void> {
  const view = await answered(w.varys.threads.read(threadId));
  const { items, running } = view.conversation;
  if (running || watching !== w || w.sessions.has(threadId)) return;
  if (items.some((i) => i.type === "message") || !says(items)) return;
  const at = saidAt(items);
  w.started({
    sessionId: threadId,
    requestId: `${DELIVERED}${threadId}`,
    chat: { title: view.routine ? `${view.routine.title} · ${shortDate(at)}` : view.title },
    deliveredAt: at,
    delivery: deliveryOf(view.routine),
  });
}

export function watchDeliveries(
  varys: Varys,
  settings: VarysSettings,
  sessions: WatchedSession[],
  started: (run: AgentRun) => void,
  read?: (sessionId: string, cursor: string) => void,
): void {
  if (watching && watching.varys !== varys) stopWatching();
  const muted = new Set((settings.mutedRoutines ?? "").split(",").filter(Boolean));
  const chats = new Map(sessions.map((s) => [s.id, { ...s }]));
  if (watching) {
    Object.assign(watching, { sessions: chats, started, read, muted });
    for (const id of watching.updated.keys()) if (!chats.has(id)) watching.updated.delete(id);
    onThreads(watching);
    return;
  }
  const w: Watching = {
    varys,
    sessions: chats,
    started,
    read,
    muted,
    since: Date.now(),
    threads: null,
    updated: new Map(),
    follows: new Map(),
    stop: [],
  };
  watching = w;
  w.stop.push(
    varys.threads.watchList((list) => {
      if (list.status !== "fresh" || watching !== w) return;
      w.threads = list.value;
      onThreads(w);
    }),
    varys.routines.watchList((list) => {
      if (list.status === "fresh" && watching === w) onRoutines(w, list.value);
    }),
  );
}

/** Otter's relay says varys has something new in this thread: look now. */
export function deliveredNow(threadId?: string): void {
  const w = watching;
  if (!w || !threadId) return;
  const chat = w.sessions.get(threadId);
  void (chat ? catchUp(w, chat) : newThread(w, threadId)).catch(failedTo("delivery"));
}

export const agentRunTurn = (requestId: string) => agentRuns.get(requestId)?.turn;

/**
 * A run the agent started, as its chat follows it: what it held so far, then the rest. One from
 * before the app last started is followed again while it goes on or waits for you, else shown as
 * it ended.
 */
export async function resumeAgentRun(
  varys: Varys,
  requestId: string,
  threadId: string,
  emit: Emit,
): Promise<void> {
  const kept = agentRuns.get(requestId);
  if (kept) {
    emit({ requestId, type: "transcript", messages: [] });
    for (const event of kept.held.splice(0)) emit(event);
    if (kept.ended) agentRuns.delete(requestId);
    else
      kept.turn.emit = (event) => {
        emit(event);
        if (event.type === "done" || event.type === "error") agentRuns.delete(requestId);
      };
    return;
  }
  const view = await answered(varys.threads.read(threadId));
  const { items, running, waiting } = view.conversation;
  if (!running && !waiting) {
    const yours = items.findLastIndex((i) => i.type === "message");
    emit({ requestId, type: "transcript", messages: messagesOf(items.slice(yours + 1)) });
    return emit({ requestId, type: "done", responseId: null });
  }
  emit({ requestId, type: "transcript", messages: [] });
  const turn = newTurn(requestId, threadId, varys, emit);
  // Answered from the chat, its approvals and questions find it here.
  agentRuns.set(requestId, { turn, held: [], ended: false });
  await new Promise<void>((resolve) => {
    const followed = varys.threads.follow(threadId, (event) => {
      const end = onTurnEvent(turn, event);
      if (!end) return;
      endTurn(turn, end);
      followed.close();
      resolve();
    });
    void followed.ended.then(() => resolve());
  });
  agentRuns.delete(requestId);
}

/** What a delivery shows: a new chat's whole thread, or what followed an item in a chat's. */
export async function deliveredReply(varys: Varys, requestId: string) {
  const [threadId, after] = requestId.slice(DELIVERED.length).split("@");
  const view: ThreadView = await answered(varys.threads.read(threadId));
  const items = view.conversation.items;
  if (after === undefined) return messagesOf(items);
  const added = items.filter((i) => placed(i) && Number(i.id) > Number(after));
  const yours = added.findIndex((i) => i.type === "message");
  return messagesOf(yours < 0 ? added : added.slice(0, yours));
}

export function stopWatching(): void {
  if (!watching) return;
  for (const follow of watching.follows.values()) follow.close();
  for (const stop of watching.stop) stop();
  watching = null;
  agentRuns.clear();
}
