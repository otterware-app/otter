import { useEffect, useState, type ReactNode } from "react";
import { AlarmClockIcon, LoaderCircleIcon, MessageSquarePlusIcon } from "lucide-react";
import { AgentAvatar, openClawAgentId } from "./agent-providers";
import { isBlank, shelveChat, useChats, type Conversation } from "./chat-store";
import { formatAgo } from "./chat-history";
import {
  chatReturnedAt,
  chatShelf,
  snoozePresets,
  wakesIn,
  workingFor,
  type ChatShelf,
} from "./chat-shelves";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from "./menu";
import { NewRow, Section, SidebarBody } from "./sidebar-ui";
import { cn } from "./ui";

/** Settled chats show this many at first, then this many more at a time (Otter Code's). */
const SETTLED_FIRST = 10;
const SETTLED_PAGE = 25;

/** The time, again every `ms`: what moves a snooze's countdown and a turn's clock along. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

/**
 * The Agent mode's sidebar, laid out like Otter Code's: a new chat, the chats
 * you're on, and at the bottom Working, Snoozed and Settled.
 */
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
  const runs = useChats((s) => s.runs);
  const approvals = useChats((s) => s.approvals);
  const questions = useChats((s) => s.questions);
  const anyWorking = Object.keys(runs).length > 0;
  const now = useNow(anyWorking ? 1000 : 30_000);
  const [settledShown, setSettledShown] = useState(SETTLED_FIRST);

  const waiting = new Set(
    [...approvals, ...questions].flatMap(
      ({ requestId }) => Object.values(runs).find((r) => r.requestId === requestId)?.convoId ?? [],
    ),
  );
  const shelves: Record<ChatShelf, Conversation[]> = {
    active: [],
    working: [],
    snoozed: [],
    settled: [],
  };
  for (const c of conversations) {
    if (isBlank(c)) continue;
    shelves[chatShelf(c, { working: Boolean(runs[c.id]), needsYou: waiting.has(c.id), now })].push(
      c,
    );
  }
  shelves.active.sort((a, b) => chatReturnedAt(b, now) - chatReturnedAt(a, now));
  shelves.working.sort((a, b) => b.updatedAt - a.updatedAt);
  shelves.snoozed.sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
  shelves.settled.sort((a, b) => b.updatedAt - a.updatedAt);
  // The open chat stays in sight even past the settled ones shown.
  const settled = shelves.settled.filter((c, i) => i < settledShown || c.id === chatId);
  const hiddenSettled = shelves.settled.length - settled.length;
  const current = conversations.find((c) => c.id === chatId);

  const row = (c: Conversation, shelf: ChatShelf) => {
    const selected = c.id === chatId;
    let trailing: ReactNode;
    if (shelf === "working") {
      const since = c.turns.at(-1)?.startedAt ?? c.updatedAt;
      trailing = (
        <span className="flex shrink-0 items-center gap-1 text-xs text-info">
          <LoaderCircleIcon className="size-3 animate-spin" />
          Working {workingFor(since, now)}
        </span>
      );
    } else if (shelf === "snoozed") {
      trailing = (
        <span className="flex shrink-0 items-center gap-1 text-xs text-info">
          <AlarmClockIcon className="size-3" />
          {wakesIn(c.snoozedUntil ?? now, now)}
        </span>
      );
    } else if ((unseen.has(c.id) || waiting.has(c.id)) && !selected) {
      trailing = <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-primary" />;
    } else {
      trailing = (
        <span className="shrink-0 text-xs text-sidebar-muted-foreground/80">
          {formatAgo(shelf === "active" ? chatReturnedAt(c, now) : c.updatedAt)}
        </span>
      );
    }
    return (
      <ChatRowMenu key={c.id} chat={c} shelf={shelf} now={now}>
        <button
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
          {trailing}
        </button>
      </ChatRowMenu>
    );
  };

  const empty = Object.values(shelves).every((list) => list.length === 0);
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
      <SidebarBody contentClassName="flex flex-col">
        {empty ? (
          <p className="px-(--sidebar-row-content-inset) py-1.5 text-[13px] text-sidebar-muted-foreground">
            Chats you start show up here.
          </p>
        ) : null}
        {shelves.active.map((c) => row(c, "active"))}
        {/* The shelves sit at the bottom, under the chats you're on (Otter Code's). */}
        <div className="mt-auto">
          {shelves.working.length > 0 ? (
            <Section title="Working" defaultOpen={false} count={shelves.working.length}>
              {shelves.working.map((c) => row(c, "working"))}
            </Section>
          ) : null}
          {shelves.snoozed.length > 0 ? (
            <Section title="Snoozed" defaultOpen={false} count={shelves.snoozed.length}>
              {shelves.snoozed.map((c) => row(c, "snoozed"))}
            </Section>
          ) : null}
          {shelves.settled.length > 0 ? (
            <Section title="Settled" defaultOpen={false} count={shelves.settled.length}>
              {settled.map((c) => row(c, "settled"))}
              {hiddenSettled > 0 ? (
                <button
                  type="button"
                  onClick={() => setSettledShown((n) => n + SETTLED_PAGE)}
                  className="flex h-8 w-full cursor-pointer items-center rounded-lg px-(--sidebar-row-content-inset) text-left text-sm text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  Show {Math.min(hiddenSettled, SETTLED_PAGE)} more
                </button>
              ) : null}
            </Section>
          ) : null}
        </div>
      </SidebarBody>
    </div>
  );
}

/** Snooze, settle, or bring back a chat, from its row's menu. */
function ChatRowMenu({
  chat,
  shelf,
  now,
  children,
}: {
  chat: Conversation;
  shelf: ChatShelf;
  now: number;
  children: ReactNode;
}) {
  const bringBack = () => void shelveChat(chat.id, { snoozedUntil: null, settledAt: null });
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {shelf === "snoozed" ? (
          <ContextMenuItem onSelect={bringBack}>Wake up now</ContextMenuItem>
        ) : null}
        {shelf === "settled" ? (
          <ContextMenuItem onSelect={bringBack}>Unsettle</ContextMenuItem>
        ) : null}
        <ContextMenuSub label={shelf === "snoozed" ? "Snooze until" : "Snooze"}>
          {snoozePresets(new Date(now)).map((p) => (
            <ContextMenuItem
              key={p.id}
              accelerator={p.when}
              onSelect={() => void shelveChat(chat.id, { snoozedUntil: p.until, settledAt: null })}
            >
              {p.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSub>
        {shelf === "settled" ? null : (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              onSelect={() =>
                void shelveChat(chat.id, { snoozedUntil: null, settledAt: Date.now() })
              }
            >
              Settle
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
