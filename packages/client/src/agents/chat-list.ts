import { useQuery } from "@tanstack/react-query";
import type { ChatMessageMatch, ChatTab } from "@otter/contracts/chats";
import { messageTokens, rankChatTitles, type SearchRange } from "@otter/shared/chat-search";
import { host } from "../host.ts";
import { openClawAgentId } from "./agent-providers.ts";
import type { ProviderSnapshot } from "./api.ts";
import { shelveChats } from "./chat-shelves.ts";
import {
  hasDraft,
  isBlank,
  searchChatMessages,
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
 * works, its last reply failed, or it finished something you haven't seen.
 */
export function chatStatus(
  s: StatusState,
  id: string,
  chat = s.conversations.find((c) => c.id === id),
): ChatStatus | null {
  const run = s.runs[id];
  const asks = (r: { requestId: string }) => r.requestId === run?.requestId;
  if (run && s.approvals.some(asks)) return "approval";
  if (run && s.questions.some(asks)) return "input";
  if (run) return "working";
  if (chat?.turns.at(-1)?.error) return "failed";
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
  const kind = chatStatus(s, chat.id, chat);
  switch (kind) {
    case "approval":
      return { kind, label: "Approval", title: "Needs your approval" };
    case "input":
      return { kind, label: "Input", title: "Has a question" };
    case "working": {
      const run = s.runs[chat.id];
      const started = chat.turns.find((t) => t.id === `a-${run?.requestId}`)?.startedAt;
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

export function agentNameOf(
  providers: ProviderSnapshot[],
  id: string,
  agent: string | null,
): string {
  const provider = providers.find((p) => p.id === id);
  return (
    (agent ? (provider?.models.find((m) => m.slug === agent)?.name ?? agent) : null) ??
    provider?.name ??
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
