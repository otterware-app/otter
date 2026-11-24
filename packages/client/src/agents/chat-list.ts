import { useQuery } from "@tanstack/react-query";
import type { ChatMessageMatch, ChatTab, ChatTurn } from "@otter/contracts/chats";
import { messageTokens, rankChatTitles, type SearchRange } from "@otter/shared/chat-search";
import { host } from "../host.ts";
import { openClawAgentId } from "./agent-providers.ts";
import type { ProvidersState } from "./api.ts";
import { formatDuration, splitAnswer } from "./chat-runs.ts";
import { shelveChats, tabsSummary } from "./chat-shelves.ts";
import {
  hasDraft,
  isBlank,
  isCompacting,
  searchChatMessages,
  STOPPED,
  useChats,
  type ChatsState,
  type Conversation,
} from "./chat-store.ts";

export type ChatStatus = "approval" | "input" | "working" | "failed" | "done";

type StatusState = Pick<
  ChatsState,
  "runs" | "approvals" | "questions" | "conversations" | "unseen"
>;

/**
 * What a chat is doing, the most pressing first: it waits on your approval or your answer, it
 * works, its last reply failed (stopping isn't failing), or it finished something you haven't seen.
 */
export function chatStatus(
  s: StatusState,
  id: string,
  chat = s.conversations.find((c) => c.id === id),
): ChatStatus | null {
  const activity = chatActivity(s, chat ?? { id, turns: [] });
  if (activity)
    return activity.kind === "compacting" || activity.kind === "waiting"
      ? "working"
      : activity.kind;
  const last = chat?.turns.at(-1);
  if (last?.error && last.error !== STOPPED) return "failed";
  return s.unseen.has(id) ? "done" : null;
}

export function useChatStatus(id: string): ChatStatus | null {
  return useChats((s) => chatStatus(s, id));
}

/** The chats a run waits in for you, on an approval or an answer. */
export function chatsWaitingOnYou(s: Pick<ChatsState, "runs" | "approvals" | "questions">) {
  const asked = new Set([...s.approvals, ...s.questions].map((r) => r.requestId));
  return new Set(Object.values(s.runs).flatMap((r) => (asked.has(r.requestId) ? r.convoId : [])));
}

/** How long a run has gone: "8s", "2m", "1h". */
export function elapsed(ms: number): string {
  const seconds = Math.max(1, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export type RowStatus = {
  kind: ChatStatus;
  label: string;
  /** Said to screen readers, where the label is short. */
  title: string;
};

/** What a row of the chats list says where its time would be, when anything is going on. */
export function chatRowStatus(
  s: StatusState,
  chat: Conversation,
  selected: boolean,
  now: number,
): RowStatus | null {
  const activity = chatActivity(s, chat);
  const kind = chatStatus(s, chat.id, chat);
  switch (kind) {
    case "approval":
      return { kind, label: "Approval", title: "Needs your approval" };
    case "input":
      return { kind, label: "Input", title: "Has a question" };
    case "working": {
      if (activity?.kind === "waiting") return { kind, label: "Waiting", title: activity.label };
      const started = activity && "since" in activity ? activity.since : undefined;
      return {
        kind,
        label: started ? `Working ${elapsed(now - started)}` : "Working",
        title: "Working",
      };
    }
    case "failed":
      return { kind, label: "Failed", title: "Failed" };
    case "done":
      return selected ? null : { kind, label: "Done", title: "Done" };
    case null:
      return null;
  }
}

/** T3 Code's rows recede once there's nothing new in them, or while the agent is on it. */
export const rowRecedes = (status: RowStatus | null, unread: boolean, selected: boolean) =>
  !selected &&
  (status?.kind === "working" || ((status === null || status.kind === "approval") && !unread));

/** Who a chat is with: the agent, and the gateway's agent it talks to (OpenClaw), as one key. */
export function chatAgentOf(c: Conversation): { key: string; id: string; agent: string | null } {
  const agent = openClawAgentId(c.sessionId);
  return { key: agent ? `${c.provider}:${agent}` : c.provider, id: c.provider, agent };
}

/** A chat's agent by name: its gateway's agent, the agent, or one this device can't run (a Mac's Claude). */
export function agentNameOf(
  agents: Pick<ProvidersState, "providers" | "others"> | undefined,
  id: string,
  agent: string | null,
): string {
  const provider = agents?.providers.find((p) => p.id === id);
  return (
    (provider && agent ? (provider.models.find((m) => m.slug === agent)?.name ?? agent) : null) ??
    provider?.name ??
    agents?.others.find((o) => o.id === id)?.name ??
    "Removed agent"
  );
}

/** The agents the chats are with, each with how many: what the list filters by. */
export function chatAgents(conversations: Conversation[]) {
  const agents = new Map<string, { id: string; agent: string | null; count: number }>();
  for (const c of conversations) {
    if (isBlank(c)) continue;
    const { key, id, agent } = chatAgentOf(c);
    const seen = agents.get(key);
    agents.set(key, { id, agent, count: (seen?.count ?? 0) + 1 });
  }
  return agents;
}

const AGENT_FILTER_KEY = "gmail:chat-agent-filter";

/** The agent the list shows the chats of on this device (`chatAgentOf`'s key), or null for all. */
export function getChatAgentFilter(): string | null {
  try {
    return host().storage.get(AGENT_FILTER_KEY) || null;
  } catch {
    return null;
  }
}

export function setChatAgentFilter(key: string | null): void {
  try {
    host().storage.set(AGENT_FILTER_KEY, key ?? "");
  } catch {
    // A per-device convenience: without storage the filter just doesn't stick.
  }
}

/** The shelves the list shows, one at a time. */
export type ListedShelf = "active" | "snoozed" | "settled";

const SHELF_KEY = "gmail:chat-shelf";
const SHELVES: readonly string[] = ["active", "snoozed", "settled"] satisfies ListedShelf[];

/** The shelf the list shows on this device, as it was left (the Swift app's `@AppStorage("chat-shelf")`). */
export function getChatShelf(): ListedShelf {
  try {
    const shelf = host().storage.get(SHELF_KEY);
    return shelf && SHELVES.includes(shelf) ? (shelf as ListedShelf) : "active";
  } catch {
    return "active";
  }
}

export function setChatShelf(shelf: ListedShelf): void {
  try {
    host().storage.set(SHELF_KEY, shelf);
  } catch {
    // A per-device convenience, as the agent filter.
  }
}

/** The first line of a chat's unsent draft. */
export const draftPreview = (draft: string) => draft.trim().split("\n", 1)[0];

/**
 * New chats with a draft in them, newest first. The one open now joins them once you leave it,
 * not as you type (T3 Code's): `openedWithDraft` says whether it had one when you opened it.
 */
export function newDraftChats(
  conversations: Conversation[],
  drafts: Record<string, string>,
  {
    openId,
    openedWithDraft,
    agent,
  }: { openId: string; openedWithDraft: boolean; agent: string | null },
): Conversation[] {
  return conversations
    .filter(
      (c) =>
        isBlank(c) &&
        hasDraft(drafts, c.id) &&
        (c.id !== openId || openedWithDraft) &&
        (!agent || chatAgentOf(c).key === agent),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** What the chat used and made, in the order its details list them. */
export const CHAT_TAB_KINDS = ["draft", "thread", "file", "page"] as const;

export const usedTabKinds = (tabs: ChatTab[]) =>
  CHAT_TAB_KINDS.filter((kind) => tabs.some((t) => t.ref.kind === kind));

/** What a search of messages asks for: the query, once it has words to look for. */
export const messageSearchQuery = (query: string) =>
  messageTokens(query).length > 0 ? query.trim() : "";

export function useChatMessageSearch(query: string) {
  const messageQuery = messageSearchQuery(query);
  return useQuery({
    queryKey: ["chat-search", messageQuery],
    enabled: messageQuery !== "",
    queryFn: () => searchChatMessages(messageQuery),
  });
}

export type ChatSearchResult = {
  chat: Conversation;
  /** Where the query falls in its title. */
  ranges: readonly SearchRange[];
  /** The message it was found in, when not by its title. */
  match?: ChatMessageMatch;
};

/** T3 Code's sidebar search: the chats whose titles match, best first, then those a message of matches. */
export function chatSearchResults(
  chats: Conversation[],
  query: string,
  now: number,
  matches: ChatMessageMatch[] | undefined,
): ChatSearchResult[] {
  if (!query.trim()) return [];
  const titled = rankChatTitles(chats, query, now);
  const byTitle = new Set(titled.map((r) => r.chat.id));
  const byId = new Map(chats.map((c) => [c.id, c]));
  const messages = messageSearchQuery(query)
    ? (matches ?? []).flatMap((match) => {
        const chat = byId.get(match.id);
        return chat && !byTitle.has(chat.id) ? [{ chat, ranges: [], match }] : [];
      })
    : [];
  return [...titled, ...messages];
}

/** The chats to switch to: the pinned, then the active. */
export function openChats(
  s: Pick<ChatsState, "conversations" | "runs" | "approvals" | "questions">,
  now: number,
  autoSettleDays: number | null,
): Conversation[] {
  const shelves = shelveChats(
    s.conversations.filter((c) => !isBlank(c)),
    {
      working: new Set(Object.keys(s.runs)),
      needsYou: chatsWaitingOnYou(s),
      now,
      autoSettleDays,
    },
  );
  return [...shelves.pinned, ...shelves.active];
}

/** Its run ended where this device couldn't follow it: it's picked up again once the agent is back. */
export const isDetached = (s: Pick<ChatsState, "runs">, chat: Conversation) =>
  Boolean(chat.openRequest) && !s.runs[chat.id];

/** What runs or waits in a chat, as its row and its header say it. */
export type ChatActivity =
  | { kind: "approval"; title: string }
  | { kind: "input"; question: string }
  | { kind: "compacting" | "working"; since?: number }
  /** Handed off to subagents: "Waiting · Research pricing". */
  | { kind: "waiting"; label: string };

/** What a run handed off to subagents says it waits on, as T3 Code's phone app words it. */
export function waitingLabel(subagents: (string | null)[]): string {
  if (subagents.length > 1) return `Waiting on ${subagents.length} subagents`;
  if (subagents.length === 0) return "Waiting";
  return subagents[0] ? `Waiting · ${subagents[0]}` : "Waiting on a subagent";
}

export function chatActivity(
  s: Pick<ChatsState, "runs" | "approvals" | "questions">,
  chat: Pick<Conversation, "id" | "turns">,
): ChatActivity | null {
  const run = s.runs[chat.id];
  if (!run) return null;
  const approval = s.approvals.find((a) => a.requestId === run.requestId);
  if (approval) return { kind: "approval", title: approval.approval.title };
  const question = s.questions.find((q) => q.requestId === run.requestId);
  if (question) return { kind: "input", question: question.question.questions[0]?.question ?? "" };
  if (isCompacting(chat.turns)) return { kind: "compacting" };
  if (run.waiting) return { kind: "waiting", label: waitingLabel(run.waiting) };
  const since = chat.turns.find((t) => t.id === `a-${run.requestId}`)?.startedAt;
  return { kind: "working", ...(since !== undefined && { since }) };
}

/**
 * What a chat's working control says while its run goes, at `now`: "Working 1m 4s" from when its
 * answer (else your last message) started, "Compacting…", or what it waits on; null when nothing runs.
 */
export function runClock(
  s: Pick<ChatsState, "runs">,
  chat: Pick<Conversation, "id" | "turns">,
  now: number,
): string | null {
  const run = s.runs[chat.id];
  if (!run) return null;
  if (isCompacting(chat.turns)) return "Compacting…";
  if (run.waiting) return waitingLabel(run.waiting);
  const since =
    chat.turns.find((t) => t.id === `a-${run.requestId}`)?.startedAt ??
    chat.turns.findLast((t) => t.role === "user")?.startedAt;
  return since === undefined ? "Working" : `Working ${formatDuration(now - since)}`;
}

/** What a chat's header says under its title while something goes on: "working…". */
export function activityStatus(activity: ChatActivity): string {
  switch (activity.kind) {
    case "approval":
      return "needs your approval";
    case "input":
      return "has a question";
    case "compacting":
      return "compacting context…";
    case "working":
      return "working…";
    case "waiting":
      return activity.label[0].toLowerCase() + activity.label.slice(1);
  }
}

/** What a row of a phone's list says on its second line while something goes on, with how many messages wait behind it. */
export function activityPreview(activity: ChatActivity, queued = 0): string {
  switch (activity.kind) {
    case "approval":
      return activity.title ? `Approve: ${activity.title}` : "Needs your approval";
    case "input":
      return activity.question || "Has a question for you";
    default:
      return `${activityStatus(activity)}${queued > 0 ? ` · ${queued} queued` : ""}`;
  }
}

/** A table's row as its cells' words (its rule line, none); null for a line that isn't one. */
function tableRow(line: string): string | null {
  if (!line.startsWith("|")) return null;
  const cells = line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
  if (cells.every((cell) => /^:?-+:?$/.test(cell))) return "";
  return cells.filter(Boolean).join(" · ");
}

/** A message on one line: Markdown's marks gone, a list's items and a table's cells joined by " · ". */
export function flattenMessage(text: string): string {
  let out = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const row = tableRow(trimmed);
    const item = row !== null || /^([-*+]|\d+[.)])\s+/.test(trimmed);
    const words = row ?? trimmed.replace(/^(#+|[-*+]|\d+[.)]|>)\s+/, "");
    if (!words) continue;
    if (out) out += item ? " · " : " ";
    out += words;
  }
  return out
    .replaceAll("**", "")
    .replaceAll("`", "")
    .replace(/:\s·\s/g, ": ");
}

/**
 * A chat's last words on one line, the turn that said them, and, for yours, whether a reply
 * came after it (a phone's ticks). A stopped reply counts, with no words.
 */
export function lastMessage(
  chat: Conversation,
): { text: string; turn: ChatTurn; answered: boolean } | null {
  if (!chat.loaded) return null;
  for (let i = chat.turns.length - 1; i >= 0; i -= 1) {
    const turn = chat.turns[i];
    const text = flattenMessage(
      turn.role === "user" ? turn.text : splitAnswer(turn.items ?? []).answer || turn.text,
    );
    if (text || turn.error === STOPPED) return { text, turn, answered: i < chat.turns.length - 1 };
  }
  return null;
}

/** A row's second line with no message to show: what the chat used and made, else its agent, and where it runs. */
export function chatRowDetail(chat: Conversation, agentName: string): string {
  const summary = tabsSummary(chat.tabs);
  return [summary || agentName, chat.device && `On ${chat.device.name}`]
    .filter(Boolean)
    .join(" · ");
}

/** The chats that want you: unread, or waiting on your answer. What a tab's badge counts. */
export const unreadChats = (
  s: Pick<ChatsState, "unseen" | "runs" | "approvals" | "questions">,
): Set<string> => new Set([...s.unseen, ...chatsWaitingOnYou(s)]);

export type RecentChat = { chat: Conversation; status: "working" | "unread" | null };

/** The latest chats, for the bar's recents card: working, unread or neither. */
export function recentChats(
  s: Pick<ChatsState, "conversations" | "unseen" | "runs" | "approvals" | "questions">,
  count = 5,
): RecentChat[] {
  const unread = unreadChats(s);
  return s.conversations
    .filter((c) => !isBlank(c))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, count)
    .map((chat) => ({
      chat,
      status: s.runs[chat.id] ? "working" : unread.has(chat.id) ? "unread" : null,
    }));
}

/** A chat whose run just ended while another screen was up (Claude's "Completed"): the first, if any. */
export function finishedElsewhere(
  before: ChatsState["runs"],
  after: ChatsState["runs"],
  openId: string | null,
  conversations: Conversation[],
): string | null {
  return (
    Object.keys(before).find(
      (id) => !after[id] && id !== openId && conversations.some((c) => c.id === id),
    ) ?? null
  );
}
