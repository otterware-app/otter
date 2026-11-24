/**
 * What an agent writes in the margin beside something of yours (the Margin layout): a note on a
 * conversation, an event, a scheduled task or the day. The agent writes it on its own; you accept
 * it (its action runs as a turn of a chat, with the tools agents already have) or dismiss it, and
 * either way it doesn't come back. Notes are kept with the account's agents and chats
 * (agent-sync.ts: `note/<id>`), so every device shows the same ones.
 *
 * Handlers: `notes:list` ({ targets?: NoteTarget[] }) → MarginNote[] (open ones, newest first),
 * `notes:accept` ({ id }) → NoteChat | null, `notes:dismiss` ({ id }); `notes:changed` is
 * broadcast when they change.
 */

export type NoteTarget =
  | { kind: "thread"; accountId: string; threadId: string }
  | { kind: "event"; calendarId: string; eventId: string }
  /** A scheduled task: `agentId`'s task `taskId`. */
  | { kind: "task"; agentId: string; taskId: string }
  /** The day, on the Desk: `date` is YYYY-MM-DD. */
  | { kind: "day"; date: string };

/** What the note is: what something says, a reply it drafted, what it asks you, what it did. */
export type NoteKind = "summary" | "draft" | "question" | "done";

export type NoteState = "open" | "accepted" | "dismissed";

export interface MarginNote {
  id: string;
  /** The agent that wrote it. */
  agentId: string;
  target: NoteTarget;
  kind: NoteKind;
  text: string;
  /** What accepting does: the label on the button, and what the agent is asked to do. */
  action?: { label: string; prompt: string };
  state: NoteState;
  createdAt: number;
}

/**
 * What accepting a note with an action starts: a chat with `agentId`, asked `prompt` about the
 * note's target (`thread`, as a chat about a conversation is; else `about`, a line saying what it
 * is). Chats run in the windows, so the window that accepted starts it.
 */
export interface NoteChat {
  agentId: string;
  prompt: string;
  title: string;
  thread?: {
    account: string;
    accountId: string;
    threadId: string;
    subject: string;
    from: string;
    messageIds: string[];
  };
  about?: string;
}

/** One key per target, for maps and the store. */
export function noteTargetKey(target: NoteTarget): string {
  switch (target.kind) {
    case "thread":
      return `thread/${target.accountId}/${target.threadId}`;
    case "event":
      return `event/${target.calendarId}/${target.eventId}`;
    case "task":
      return `task/${target.agentId}/${target.taskId}`;
    case "day":
      return `day/${target.date}`;
  }
}
