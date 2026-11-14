import type { ChatChange } from "./index.js";

/** The agent a chat runs on: its id, one of the agents you added. */
export type ChatProvider = string;

/** Kinds of agent whose chats run on the device that started them. */
export const LOCAL_AGENT_KINDS: readonly string[] = ["claude", "codex"];

export interface ChatStep {
  kind: "command" | "read" | "edit" | "search" | "web" | "skill" | "tool";
  title: string;
  detail?: string;
  source?: string;
  /** The agent compacting its context: running until its output, which is empty unless it failed. */
  compaction?: true;
}

export type ChatTurnItem =
  | { kind: "text"; id?: string; text: string }
  | { kind: "step"; id?: string; step: ChatStep; output?: string };

export type ChatContextKind = "draft" | "sent" | "mail" | "mixed" | "quote";

export interface ChatContextMeta {
  subjects: string[];
  count: number;
  kind: ChatContextKind;
  items?: { title: string; target: ChatChange["target"] }[];
}

export interface ChatSentAttachment {
  name: string;
  kind: "image" | "file";
  size: number;
  /** A small picture of an image (a JPEG data URL), so every device shows what was sent. */
  thumb?: string;
}

/**
 * A turn no message of yours started: an automation's result (its job's name and schedule while
 * the job exists), or a message the agent sent you itself.
 */
export type ChatDelivery =
  | { kind: "automation"; jobId?: string; name?: string; schedule?: string }
  | { kind: "message"; from?: string };

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  items?: ChatTurnItem[];
  changes?: ChatChange[];
  context?: ChatContextMeta;
  skill?: string;
  intent?: "queued" | "steer" | "promoted";
  attachments?: ChatSentAttachment[];
  citations?: { text: string; comment?: string }[];
  error?: string;
  /** The chat was forked from another after this turn. */
  forked?: boolean;
  delivered?: ChatDelivery;
  /** Said in a call with the agent, not written. */
  spoken?: true;
  startedAt?: number;
  finishedAt?: number;
}

export type ChatTabRef =
  | { kind: "thread"; accountId: string; id: string }
  | { kind: "draft"; accountId: string; id: string }
  | { kind: "page"; url: string }
  | { kind: "file"; href: string };

export interface ChatTab {
  /** Stable for what it shows (`chatTabId`), so opening it again finds the tab. */
  id: string;
  title: string;
  ref: ChatTabRef;
  addedAt: number;
  /** What the agent made (a draft, a file, an event), not what it read. */
  made?: boolean;
  /** Closed in the panel: still among what the chat used and made, to open again. */
  closedAt?: number | null;
}

export interface Chat {
  id: string;
  title: string;
  provider: ChatProvider;
  sessionId: string | null;
  sessionOwned: boolean;
  /** Hermes without sessions chains turns through the Responses API. */
  lastResponseId: string | null;
  device: { id: string; name: string } | null;
  createdAt: number;
  updatedAt: number;
  /** Out of the list until then, unless the agent needs you or finishes sooner. */
  snoozedUntil?: number | null;
  settledAt?: number | null;
  pinnedAt?: number | null;
  /** When you last made it, wrote in it or brought it back: where it sits in the list. */
  returnedAt?: number | null;
  tabs: ChatTab[];
  turns: ChatTurn[];
  /** Where its turns are read up to in the agent's session, on agents that number what they write. */
  cursor?: string | null;
}

/** A chat listed for one of its messages: `chats:search`. */
export interface ChatMessageMatch {
  id: string;
  turnId: string;
  role: ChatTurn["role"];
  snippet: string;
}

/**
 * `chats:save`: a chat without its turns, its turns' ids in order, and only the turns that
 * changed since the window last saved it, so a long chat that streams sends one turn.
 * `settled`: no turn runs in it, so other devices can have it now (else in a while).
 */
export interface ChatSave {
  chat: Omit<Chat, "turns">;
  turnIds: string[];
  turns: ChatTurn[];
  settled: boolean;
}

export function chatTabId(ref: ChatTabRef): string {
  switch (ref.kind) {
    case "thread":
    case "draft":
      return `${ref.kind}:${ref.accountId}:${ref.id}`;
    case "page":
      return `page:${ref.url}`;
    case "file":
      return `file:${ref.href}`;
  }
}
