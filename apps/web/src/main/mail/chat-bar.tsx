import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, HistoryIcon, LoaderCircleIcon, PlusIcon } from "lucide-react";

import { AgentAvatar, openClawAgentId, useChatProvider } from "./agent-providers";
import { AgentIcon } from "./agent-icon";
import { mailApi, type ChatSession } from "./api";
import { HistoryList } from "./chat-history";
import {
  deleteConversation,
  isBlank,
  openServerSession,
  useChats,
  type Conversation,
} from "./chat-store";
import { settleChat } from "./chat-shelve-actions";
import { shelveChats, useNow } from "./chat-shelves";
import { HintTooltip, cn } from "./ui";

type Status = "waiting" | "working" | "finished" | null;

function useStatus(id: string): Status {
  return useChats((s) => {
    const run = s.runs[id];
    const asks = (r: { requestId: string }) => r.requestId === run?.requestId;
    if (run && (s.approvals.some(asks) || s.questions.some(asks))) return "waiting";
    if (run) return "working";
    return s.unseen.has(id) ? "finished" : null;
  });
}

const BAR_BUTTON =
  "flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring";

export function ChatBar({
  shownId,
  onSelect,
  onShelve,
  onNewChat,
  onOpenAgents,
}: {
  shownId: string | null;
  onSelect: (id: string) => void;
  onShelve: (id: string) => void;
  onNewChat: () => void;
  onOpenAgents: () => void;
}) {
  const conversations = useChats((s) => s.conversations);
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const unseen = useChats((s) => s.unseen);
  const now = useNow(30_000);
  const asked = new Set([...approvals, ...questions].map((r) => r.requestId));
  const needsYou = new Set(
    Object.values(runs).flatMap((r) => (asked.has(r.requestId) ? r.convoId : [])),
  );
  const shelves = shelveChats(
    conversations.filter((c) => !isBlank(c)),
    { working: new Set(Object.keys(runs)), needsYou, now },
  );
  const pinned = shelves.pinned;
  // The most recent sits by the pinned ones; the oldest are clipped off the left.
  const active = shelves.active.toReversed();
  const shown = conversations.find((c) => c.id === shownId);
  const elsewhere = [...shelves.snoozed, ...shelves.settled].some((c) => unseen.has(c.id));

  const chat = useChatProvider(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sessionsAvailable = Boolean(chat.provider?.sessions && chat.usable);
  const serverSessions = useQuery<ChatSession[]>({
    queryKey: ["agent-sessions", chat.kind],
    queryFn: () => mailApi.agentSessions(chat.kind, 40),
    enabled: historyOpen && sessionsAvailable,
    staleTime: 15_000,
  });

  return (
    <div
      role="toolbar"
      aria-label="Chats"
      data-tour="chats"
      className="flex h-8 shrink-0 items-center justify-end gap-1 ps-2 pe-2"
    >
      <div className="flex min-w-0 items-center justify-end gap-1 overflow-hidden">
        {active.map((c) => (
          <ChatBarTab
            key={c.id}
            convo={c}
            shown={c.id === shownId}
            onSelect={() => onSelect(c.id)}
            onSettle={() => onShelve(c.id)}
          />
        ))}
      </div>
      {pinned.length > 0 ? (
        <div
          role="group"
          aria-label="Pinned"
          className="flex min-w-0 shrink items-center gap-0.5 rounded-lg bg-foreground/[0.04] p-0.5"
        >
          {pinned.map((c) => (
            <ChatBarTab
              key={c.id}
              convo={c}
              shown={c.id === shownId}
              onSelect={() => onSelect(c.id)}
              onSettle={() => onShelve(c.id)}
            />
          ))}
        </div>
      ) : null}
      <HintTooltip label="New chat" shortcut="agent.newChat" side="top">
        <button
          type="button"
          aria-label="New chat"
          onClick={onNewChat}
          className={cn(
            BAR_BUTTON,
            "w-7 justify-center px-0",
            shown && isBlank(shown) && "bg-foreground/[0.06] text-foreground",
          )}
        >
          <PlusIcon className="size-3.5" />
        </button>
      </HintTooltip>
      <HintTooltip label="Chat history" side="top">
        <button
          type="button"
          aria-label="Chat history"
          onClick={() => setHistoryOpen((o) => !o)}
          className={cn(
            BAR_BUTTON,
            "relative w-7 justify-center px-0",
            historyOpen && "bg-foreground/[0.06] text-foreground",
          )}
        >
          <HistoryIcon className="size-3.5" />
          {elsewhere ? (
            <span
              aria-hidden
              className="absolute right-1 top-0.5 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </button>
      </HintTooltip>
      <HintTooltip label="Agents" shortcut="mode.agent" side="top">
        <button type="button" onClick={onOpenAgents} className={cn(BAR_BUTTON, "relative")}>
          <AgentIcon className="size-3.5" />
          Agents
          {unseen.size > 0 ? (
            <span
              aria-hidden
              className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </button>
      </HintTooltip>
      {historyOpen ? (
        <HistoryList
          className="fixed bottom-9 right-2"
          backdropClassName="fixed inset-0"
          conversations={conversations}
          activeId={shownId ?? ""}
          onPick={(id) => {
            setHistoryOpen(false);
            onSelect(id);
          }}
          onDelete={(id) => deleteConversation(id, chat.selectedKind)}
          onClose={() => setHistoryOpen(false)}
          serverSessions={
            sessionsAvailable && serverSessions.data
              ? serverSessions.data.filter(
                  (s) => s.messageCount > 0 && !conversations.some((c) => c.sessionId === s.id),
                )
              : undefined
          }
          serverLoading={sessionsAvailable && serverSessions.isPending}
          onPickServer={(session) => {
            setHistoryOpen(false);
            openServerSession(session, chat.kind, chat.name);
            onSelect(useChats.getState().activeId);
          }}
          providerName={chat.name}
          providerKind={chat.kind}
        />
      ) : null}
    </div>
  );
}

function ChatBarTab({
  convo,
  shown,
  onSelect,
  onSettle,
}: {
  convo: Conversation;
  shown: boolean;
  onSelect: () => void;
  onSettle: () => void;
}) {
  const status = useStatus(convo.id);
  return (
    <div className="group/tab relative min-w-24 max-w-56">
      <button
        type="button"
        onClick={onSelect}
        title={convo.title}
        className={cn(
          BAR_BUTTON,
          "w-full min-w-0",
          shown && "bg-foreground/[0.08] text-foreground",
        )}
      >
        {status === "working" ? (
          <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
        ) : (
          <AgentAvatar
            kind={convo.provider}
            agent={openClawAgentId(convo.sessionId)}
            className="size-3.5"
          />
        )}
        {status === "waiting" || status === "finished" ? (
          <span
            aria-label={status === "waiting" ? "Waiting for you" : "Finished"}
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              status === "waiting" ? "bg-warning" : "bg-primary",
            )}
          />
        ) : null}
        {/* Its actions show over its end on hover, the title fading under them. */}
        <span className="min-w-0 truncate group-hover/tab:mask-[linear-gradient(to_left,transparent_1.5rem,black_2.5rem)] group-has-focus-visible/tab:mask-[linear-gradient(to_left,transparent_1.5rem,black_2.5rem)]">
          {convo.title}
        </span>
      </button>
      <div className="absolute inset-y-0 right-0.5 flex items-center gap-0.5 opacity-0 has-focus-visible:opacity-100 group-hover/tab:opacity-100">
        <HintTooltip label="Settle" side="top">
          <button
            type="button"
            aria-label="Settle"
            onClick={() => {
              settleChat(convo.id);
              onSettle();
            }}
            className="flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <CheckIcon className="size-3.5" />
          </button>
        </HintTooltip>
      </div>
    </div>
  );
}
