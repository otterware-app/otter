/**
 * What the user's agent writes in the margin (contracts' margin-notes.ts), kept with the
 * account's agents and chats (agent-sync.ts: `note/<id>`). While the app's layout is Margin, the
 * agent is asked now and then about a few of the day's things it hasn't been asked about: the
 * last two days' unread inbox, today's and tomorrow's events, scheduled tasks whose last run
 * needs a look.
 */

import { noteKey, type AgentMutation } from "@otter/contracts/agent-sync";
import {
  noteTargetKey,
  type MarginNote,
  type NoteChat,
  type NoteKind,
  type NoteTarget,
} from "@otter/contracts/margin-notes";
import type { ScheduledTask } from "@otter/contracts/scheduled";

import { readJson, writeJson } from "../json-file.js";
import { logger } from "../logger.js";
import { capabilitiesOf } from "../providers/index.js";
import type { CalendarEvent } from "../providers/provider.js";
import type { MailAccount, MessageSummary } from "../types.js";
import { getAccount, listAccounts } from "./account-store.js";
import { askAgent, hasAgent, listScheduledTasks, selectedAgent } from "./agent/service.js";
import { entries, entry, mutate } from "./agent-sync.js";
import * as calendarStore from "./calendar-store.js";
import { accountCalendars, eventsInRange } from "./calendar-sync.js";
import { getThreadMessages, getThreadsPage } from "./mail-store.js";
import { turnedOffMailboxes } from "./mail-sync.js";
import { getOtterUser } from "./otter-account.js";
import { getUiPreferences } from "./preferences.js";

const DAY = 24 * 60 * 60_000;
/** The agent is asked at most this often. */
const EVERY_MS = 5 * 60_000;
/** Items in one request, at most. */
const BATCH = 12;
/** Items asked about, so none is asked about twice: kept a few days, longer than they're in the day. */
const ASKED_FILE = "margin-notes-asked.json";
const ASKED_KEEP_MS = 3 * DAY;
/** Notes older than this go from the account. */
const NOTES_KEEP_MS = 30 * DAY;
const KINDS: readonly NoteKind[] = ["summary", "draft", "question", "done"];

const allNotes = () =>
  getOtterUser() ? entries<MarginNote>("note/").map(({ value }) => value) : [];

/** The open notes, on `targets` when given, newest first. */
export function listNotes(targets?: NoteTarget[]): MarginNote[] {
  const keys = targets && new Set(targets.map(noteTargetKey));
  return allNotes()
    .filter((note) => note.state === "open" && (!keys || keys.has(noteTargetKey(note.target))))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function openNote(id: string): MarginNote {
  const note = getOtterUser() ? entry<MarginNote>(noteKey(id)) : null;
  if (!note || note.state !== "open") throw new Error("This note is no longer there.");
  return note;
}

export async function dismissNote(id: string): Promise<void> {
  openNote(id);
  await mutate([{ op: "note.state", id, state: "dismissed" }]);
}

/** Marks the note accepted, and answers the chat its action starts (null when it has none). */
export async function acceptNote(id: string): Promise<NoteChat | null> {
  const note = openNote(id);
  await mutate([{ op: "note.state", id, state: "accepted" }]);
  if (!note.action) return null;
  const agentId = (await hasAgent(note.agentId)) ? note.agentId : await selectedAgent();
  if (!agentId) throw new Error("No agent is set up to do this.");
  const about = await describe(note.target);
  return {
    agentId,
    prompt: note.action.prompt,
    title: about.name ? `${note.action.label}: ${about.name}` : note.action.label,
    ...(about.thread ? { thread: about.thread } : { about: about.text }),
  };
}

async function describe(
  target: NoteTarget,
): Promise<{ name?: string; thread?: NoteChat["thread"]; text: string }> {
  switch (target.kind) {
    case "thread": {
      const last = getThreadMessages(target.accountId, target.threadId).at(-1);
      const account = (await getAccount(target.accountId))?.email ?? target.accountId;
      if (!last) return { text: `About the conversation ${target.threadId} in ${account}.` };
      const subject = last.subject || "(no subject)";
      return {
        name: subject,
        text: subject,
        thread: {
          account,
          accountId: target.accountId,
          threadId: target.threadId,
          subject,
          from: last.fromEmail,
          messageIds: [last.id],
        },
      };
    }
    case "event": {
      for (const account of await listAccounts()) {
        const event = calendarStore.getEvent(account.id, target.calendarId, target.eventId);
        if (event)
          return {
            name: event.title,
            text: `About the event “${event.title}”, ${event.start} to ${event.end}${event.location ? ` at ${event.location}` : ""} (eventId ${event.id}, calendar ${target.calendarId} of ${account.email}).`,
          };
      }
      return { text: `About the event ${target.eventId} (calendar ${target.calendarId}).` };
    }
    case "task": {
      const task = (await listScheduledTasks().catch(() => []))
        .find((agent) => agent.provider === target.agentId)
        ?.tasks.find((t) => t.id === target.taskId);
      return {
        name: task?.name,
        text: `About the scheduled task ${task ? `“${task.name}” ` : ""}(id ${target.taskId}, of the agent ${target.agentId}).`,
      };
    }
    case "day":
      return { text: `About the day, ${target.date}.` };
  }
}

/** Something of the day the agent may write a note on, as it's told about it. */
export type NoteItem = { ref: string; target: NoteTarget; about: Record<string, unknown> };

const item = (target: NoteTarget, about: Record<string, unknown>): NoteItem => ({
  ref: noteTargetKey(target),
  target,
  about,
});

const threadItem = (account: MailAccount, m: MessageSummary) =>
  item(
    { kind: "thread", accountId: account.id, threadId: m.threadId || m.id },
    {
      kind: "conversation",
      mailbox: account.email,
      subject: m.subject,
      from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail,
      snippet: m.snippet,
      received: new Date(m.date).toISOString(),
      messages: m.threadCount ?? 1,
    },
  );

const eventItem = (calendarId: string, e: CalendarEvent) =>
  item(
    { kind: "event", calendarId, eventId: e.id },
    {
      kind: "event",
      title: e.title,
      start: e.start,
      end: e.end,
      ...(e.location && { location: e.location }),
      ...(e.organizer && { organizer: e.organizer }),
      attendees: e.attendees.length,
      ...(e.response && { yourResponse: e.response }),
    },
  );

const needsAttention = (task: ScheduledTask) =>
  !!task.autoPaused ||
  (task.enabled && (task.lastRun?.status === "error" || !!task.deliveryProblem));

const taskItem = (task: ScheduledTask) =>
  item(
    { kind: "task", agentId: task.provider, taskId: task.id },
    {
      kind: "scheduled task",
      name: task.name,
      ...(task.lastRun && {
        lastRun: { status: task.lastRun.status, error: task.lastRun.error },
      }),
      ...(task.deliveryProblem && { deliveryProblem: task.deliveryProblem }),
      ...(task.autoPaused && { paused: task.autoPaused }),
    },
  );

/** Scheduled tasks that need a look, today's and tomorrow's events, the last two days' unread inbox. */
async function dayItems(now = Date.now()): Promise<NoteItem[]> {
  const off = turnedOffMailboxes();
  const accounts = (await listAccounts()).filter(
    (a) => !off.has(a.id) && !off.has(a.email.toLowerCase()),
  );
  const threads = accounts
    .flatMap((account) =>
      getThreadsPage(account.id, "INBOX", 0, 25)
        .messages.filter((m) => m.threadUnread && m.date >= now - 2 * DAY)
        .map((m) => ({ date: m.date, item: threadItem(account, m) })),
    )
    .sort((a, b) => b.date - a.date)
    .map(({ item }) => item);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const until = new Date(today);
  until.setDate(until.getDate() + 2);
  const events = await Promise.all(
    accounts
      .filter((account) => capabilitiesOf(account)?.calendar)
      .map(async (account) => {
        const { calendars } = await accountCalendars(account.id);
        const ranges = await eventsInRange(
          calendars
            .filter((c) => !c.hiddenByDefault)
            .map((c) => ({ accountId: account.id, calendarId: c.id })),
          today.toISOString(),
          until.toISOString(),
        );
        return ranges.flatMap((range) =>
          "events" in range
            ? range.events
                .filter((e) => Date.parse(e.end) > now)
                .map((e) => eventItem(range.calendarId, e))
            : [],
        );
      }),
  );
  const tasks = (await listScheduledTasks().catch(() => [])).flatMap((agent) =>
    agent.tasks.filter(needsAttention).map(taskItem),
  );
  return [...tasks, ...events.flat(), ...threads];
}

/** What the agent is asked: the items, and the JSON it answers with. */
export function notesPrompt(items: NoteItem[]): string {
  return `You write short notes in the margin of your user's Otter app, beside their mail, calendar and scheduled tasks. Here are some of their day's things. Write a note on those where one would help, and leave out the rest:

- "summary": what it says or what matters in it, in a sentence.
- "draft": a reply worth sending; the note says what it would say, and its action asks you to draft it.
- "question": something they have to decide or answer.
- "done": something already handled, that needs nothing from them.

A note may offer one action they can accept: a short label for its button (two or three words) and the prompt you'll be given to do it then, in a chat about the item (draft the reply, add the event, look into the failure). Don't do anything now and don't use tools: only write the notes.

Answer with JSON alone, an array, at most one note per item:
[{"ref": "<the item's ref>", "kind": "summary" | "draft" | "question" | "done", "text": "<one or two sentences, under 200 characters>", "action": {"label": "<button>", "prompt": "<what to do>"}}]

The items:
\`\`\`json
${JSON.stringify(
  items.map(({ ref, about }) => ({ ref, ...about })),
  null,
  2,
)}
\`\`\``;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim() && value.trim().length <= max ? value.trim() : null;

/** The notes in the agent's answer, on the items asked about: anything else is dropped. */
export function parseNotes(
  answer: string,
  items: NoteItem[],
  agentId: string,
  now = Date.now(),
): MarginNote[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(answer)?.[1];
  const json = fenced ?? answer.slice(answer.indexOf("["), answer.lastIndexOf("]") + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const byRef = new Map(items.map((i) => [i.ref, i]));
  const notes: MarginNote[] = [];
  for (const raw of parsed) {
    if (!isObject(raw)) continue;
    const target = typeof raw.ref === "string" ? byRef.get(raw.ref)?.target : undefined;
    const kind = KINDS.find((k) => k === raw.kind);
    const body = text(raw.text, 600);
    if (!target || !kind || !body) continue;
    byRef.delete(String(raw.ref));
    const label = isObject(raw.action) ? text(raw.action.label, 40) : null;
    const prompt = isObject(raw.action) ? text(raw.action.prompt, 2000) : null;
    notes.push({
      id: crypto.randomUUID(),
      agentId,
      target,
      kind,
      text: body,
      ...(label && prompt && { action: { label, prompt } }),
      state: "open",
      createdAt: now,
    });
  }
  return notes;
}

let lastAsked = 0;
let asking = false;

/** Asks the agent about the day's things it hasn't been asked about, when it's time. */
export async function writeNotes(now = Date.now()): Promise<void> {
  if (asking || now - lastAsked < EVERY_MS || !getOtterUser()) return;
  if ((await getUiPreferences())["otter:layout"] !== "margin") return;
  const agentId = await selectedAgent();
  if (!agentId) return;
  asking = true;
  lastAsked = now;
  try {
    const notes = allNotes();
    const old: AgentMutation[] = notes
      .filter((note) => note.createdAt < now - NOTES_KEEP_MS)
      .map((note) => ({ op: "note.remove", id: note.id }));
    if (old.length > 0) await mutate(old);
    const noted = new Set(notes.map((note) => noteTargetKey(note.target)));
    const asked = Object.fromEntries(
      Object.entries((await readJson<Record<string, number>>(ASKED_FILE)) ?? {}).filter(
        ([, at]) => at > now - ASKED_KEEP_MS,
      ),
    );
    const items = (await dayItems(now))
      .filter((i) => !asked[i.ref] && !noted.has(i.ref))
      .slice(0, BATCH);
    if (items.length === 0) return;
    const written = parseNotes(await askAgent(agentId, notesPrompt(items)), items, agentId, now);
    for (const i of items) asked[i.ref] = now;
    await writeJson(ASKED_FILE, asked);
    logger.info("margin-notes", "asked", { items: items.length, notes: written.length });
    if (written.length > 0) await mutate(written.map((note) => ({ op: "note.set", note })));
  } catch (error) {
    logger.info("margin-notes", "couldn't ask for notes", { error: String(error) });
  } finally {
    asking = false;
  }
}

const TICK_MS = 60_000;
const FIRST_MS = 15_000;

export function startMarginNotes(): void {
  setTimeout(() => {
    void writeNotes();
    setInterval(() => void writeNotes(), TICK_MS);
  }, FIRST_MS);
}
