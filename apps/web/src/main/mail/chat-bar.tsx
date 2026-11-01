/**
 * The bar along the window's foot (Linear's): the agent's chats kept as tabs,
 * minimized or showing, then Agent (a new chat) and the chat history. A tab
 * spins while its chat works, and a dot says it waits on you or finished
 * while you were away.
 */

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, LoaderCircleIcon, XIcon } from "lucide-react";

import { useChatProvider } from "./agent-providers";
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
import { HintTooltip, cn } from "./ui";

type Status = "waiting" | "working" | "finished" | null;

/** How a chat is doing, for its tab. */
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
  onCloseTab,
  onNewChat,
}: {
  /** The chat on screen (the small window's, or the workspace's); null when none is. */
  shownId: string | null;
  /** A tab or a past chat, picked. */
  onSelect: (id: string) => void;
  /** Takes a tab out of the bar (and the window, if it shows it). */
  onCloseTab: (id: string) => void;
  onNewChat: () => void;
}) {
  const conversations = useChats((s) => s.conversations);
  const docked = useChats((s) => s.docked);
  const tabs = docked.flatMap((id) => conversations.find((c) => c.id === id) ?? []);
  const shown = conversations.find((c) => c.id === shownId);
  // A chat not in the bar that finished, or waits on you, marks History.
  const elsewhere = useChats((s) =>
    s.conversations.some((c) => {
      if (s.docked.includes(c.id)) return false;
      const run = s.runs[c.id];
      const asks = (r: { requestId: string }) => r.requestId === run?.requestId;
      return s.unseen.has(c.id) || (run && (s.approvals.some(asks) || s.questions.some(asks)));
    }),
  );

  const chat = useChatProvider(undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Other sessions persisted on the provider (Hermes WebUI, Codex threads…), fetched when history opens.
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
        {tabs.map((c) => (
          <ChatBarTab
            key={c.id}
            convo={c}
            shown={c.id === shownId}
            onSelect={() => onSelect(c.id)}
            onClose={() => onCloseTab(c.id)}
          />
        ))}
      </div>
      <HintTooltip label="New chat" shortcut="agent.newChat" side="top">
        <button
          type="button"
          onClick={onNewChat}
          className={cn(
            BAR_BUTTON,
            shown && isBlank(shown) && "bg-foreground/[0.06] text-foreground",
          )}
        >
          <AgentIcon className="size-3.5" />
          Agent
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
        />
      ) : null}
    </div>
  );
}

function ChatBarTab({
  convo,
  shown,
  onSelect,
  onClose,
}: {
  convo: Conversation;
  shown: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const status = useStatus(convo.id);
  return (
    <div className="group/tab relative min-w-0 max-w-56">
      <button
        type="button"
        onClick={onSelect}
        title={convo.title}
        className={cn(
          BAR_BUTTON,
          "w-full min-w-0 pe-6",
          shown && "bg-foreground/[0.08] text-foreground",
        )}
      >
        {status === "working" ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : status ? (
          <span
            aria-label={status === "waiting" ? "Waiting for you" : "Finished"}
            className={cn(
              "mx-1 size-1.5 shrink-0 rounded-full",
              status === "waiting" ? "bg-warning" : "bg-primary",
            )}
          />
        ) : null}
        <span className="min-w-0 truncate">{convo.title}</span>
      </button>
      {/* Takes the tab out of the bar; the chat stays in history. */}
      <button
        type="button"
        aria-label="Close tab"
        onClick={onClose}
        className="absolute right-1 top-1 flex size-4 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-foreground/[0.08] hover:text-foreground focus-visible:opacity-100 group-hover/tab:opacity-100"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  );
}
