import { MessageSquarePlusIcon } from "lucide-react";
import { AgentAvatar, openClawAgentId } from "./agent-providers";
import { isBlank, useChats } from "./chat-store";
import { formatAgo } from "./chat-history";
import { NewRow, Section, SidebarBody } from "./sidebar-ui";
import { cn } from "./ui";

/** The Agent mode's sidebar: a new chat, and the chats, newest first. */
export function AgentSidebar({
  chatId,
  onSelect,
  onNewChat,
}: {
  chatId: string;
  onSelect: (chatId: string) => void;
  onNewChat: () => void;
}) {
  const conversations = useChats((s) => s.conversations);
  const unseen = useChats((s) => s.unseen);
  const chats = conversations
    .filter((c) => !isBlank(c))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const current = conversations.find((c) => c.id === chatId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col pt-(--sidebar-content-inset)">
        <NewRow
          icon={<MessageSquarePlusIcon />}
          label="New chat"
          selected={current ? isBlank(current) : false}
          onClick={onNewChat}
        />
      </div>
      <SidebarBody>
        <Section title="Chats">
          {chats.length === 0 ? (
            <p className="px-(--sidebar-row-content-inset) py-1.5 text-[13px] text-sidebar-muted-foreground">
              Chats you start show up here.
            </p>
          ) : (
            chats.map((c) => {
              const selected = c.id === chatId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  aria-current={selected ? "page" : undefined}
                  className={cn(
                    "group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg px-(--sidebar-row-content-inset) text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    selected
                      ? "bg-sidebar-row-selected text-sidebar-foreground"
                      : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
                  )}
                >
                  <AgentAvatar
                    kind={c.provider}
                    agent={openClawAgentId(c.sessionId)}
                    className="size-3.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {unseen.has(c.id) && !selected ? (
                    <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-primary" />
                  ) : (
                    <span className="shrink-0 text-xs text-sidebar-muted-foreground/80">
                      {formatAgo(c.updatedAt)}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </Section>
      </SidebarBody>
    </div>
  );
}
