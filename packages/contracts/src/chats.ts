import type { ChatChange } from "./index.js";

export type ChatProvider = string;

export const LOCAL_CHAT_PROVIDERS: readonly ChatProvider[] = ["claude", "codex"];

export interface ChatStep {
  kind: "command" | "read" | "edit" | "search" | "web" | "skill" | "tool";
  title: string;
  detail?: string;
  source?: string;
}

export type ChatTurnItem =
  | { kind: "text"; id?: string; text: string }
  | { kind: "step"; id?: string; step: ChatStep; output?: string };

export type ChatContextKind = "draft" | "sent" | "mail" | "mixed" | "quote" | "page";

/** A browser tab sent with a message: `tab` is that tab on the device that sent it. */
export type ChatPageTarget = { kind: "page"; url: string; tab?: string };

export interface ChatContextMeta {
  subjects: string[];
  count: number;
  kind: ChatContextKind;
  items?: { title: string; target: ChatChange["target"] | ChatPageTarget }[];
}

export interface ChatSentAttachment {
  name: string;
  kind: "image" | "file";
  size: number;
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
  startedAt?: number;
  finishedAt?: number;
}

export type ChatTabRef =
  | { kind: "thread"; accountId: string; id: string }
  | { kind: "draft"; accountId: string; id: string }
  | ChatPageTarget
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

export type ChatSummary = Omit<Chat, "turns"> & { deletedAt: number | null };

export function chatTabId(ref: ChatTabRef): string {
  switch (ref.kind) {
    case "thread":
    case "draft":
      return `${ref.kind}:${ref.accountId}:${ref.id}`;
    case "page":
      return ref.tab ? `page:tab:${ref.tab}` : `page:${ref.url}`;
    case "file":
      return `file:${ref.href}`;
  }
}

export const CHAT_LIMITS = {
  chats: 500,
  turns: 80,
  tabs: 50,
  title: 300,
  output: 4000,
  address: 2048,
  bytes: 500_000,
} as const;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

function fits(tab: ChatTab): boolean {
  const { ref } = tab;
  if (ref.kind === "page") return ref.url.length <= CHAT_LIMITS.address;
  if (ref.kind === "file") return ref.href.length <= CHAT_LIMITS.address;
  return ref.accountId.length <= 320 && ref.id.length <= 512;
}

const withOutputs = (turn: ChatTurn, max: number): ChatTurn => ({
  ...turn,
  items: turn.items?.map((item) =>
    item.kind === "step" && item.output !== undefined
      ? { ...item, output: max > 0 ? clip(item.output, max) : undefined }
      : item,
  ),
});

export function chatForSync(chat: Chat): Chat {
  const turns = chat.turns.slice(-CHAT_LIMITS.turns).map((turn): ChatTurn => ({
    ...withOutputs(turn, CHAT_LIMITS.output),
    attachments: turn.attachments?.map(({ thumb: _thumb, ...rest }) => rest),
  }));
  const synced: Chat = {
    ...chat,
    title: clip(chat.title, CHAT_LIMITS.title),
    tabs: chat.tabs
      .filter(fits)
      .slice(-CHAT_LIMITS.tabs)
      .map((tab) => ({ ...tab, title: clip(tab.title, CHAT_LIMITS.title) })),
    turns,
  };
  while (synced.turns.length > 1 && bytes(synced) > CHAT_LIMITS.bytes) {
    synced.turns = synced.turns.slice(Math.ceil(synced.turns.length / 4));
  }
  for (const max of [500, 0]) {
    if (bytes(synced) <= CHAT_LIMITS.bytes) break;
    synced.turns = synced.turns.map((turn) => withOutputs(turn, max));
  }
  return synced;
}

// All need the Otter account's session.
//
//   GET    /v1/chats      → ListChatsResponse (deleted ones too, without turns)
//   GET    /v1/chats/:id  → { chat: Chat } (404 once deleted)
//   PUT    /v1/chats/:id  ← Chat (chatForSync'd) → 204; 409 when the relay
//                           has a later write (pull it); 413 too big
//   DELETE /v1/chats/:id  → 204
//
// A change reaches the account's other devices as the realtime event
// `{ type: "chats" }` (relay.ts).

export interface ListChatsResponse {
  chats: ChatSummary[];
}
