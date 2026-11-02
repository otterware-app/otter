import { useEffect, useState, type ReactNode } from "react";
import {
  AlarmClockIcon,
  CheckIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  MessageSquarePlusIcon,
  SearchIcon,
  UndoIcon,
  XIcon,
} from "lucide-react";
import { Input } from "~/components/ui/input";
import { AgentAvatar, openClawAgentId, useAgentProviders } from "./agent-providers";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./menu";
import { NewRow, Section, SidebarBody } from "./sidebar-ui";
import { cn } from "./ui";

/** Settled chats show this many at first, then this many more at a time (Otter Code's). */
const SETTLED_FIRST = 10;
const SETTLED_PAGE = 25;

const AGENT_FILTER_KEY = "gmail:chat-agent-filter";

/** Who a chat talks to: its provider, and for OpenClaw the agent its session is on. */
function agentOf(c: Conversation): { key: string; kind: string; agent: string | null } {
  const agent = openClawAgentId(c.sessionId);
  return { key: agent ? `${c.provider}:${agent}` : c.provider, kind: c.provider, agent };
}

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
 * you're on (running ones say so), and at the bottom Snoozed and Settled.
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
  const providers = useAgentProviders().data?.providers ?? [];
  const [agentFilter, setAgentFilter] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AGENT_FILTER_KEY);
    } catch {
      return null;
    }
  });
  const [query, setQuery] = useState<string | null>(null);
  const pickAgent = (key: string | null) => {
    setAgentFilter(key);
    try {
      if (key) localStorage.setItem(AGENT_FILTER_KEY, key);
      else localStorage.removeItem(AGENT_FILTER_KEY);
    } catch {
      // A per-device convenience: without storage the filter just doesn't stick.
    }
  };

  // The agents your chats talk to, by how many chats each has.
  const agents = new Map<string, { kind: string; agent: string | null; count: number }>();
  for (const c of conversations) {
    if (isBlank(c)) continue;
    const { key, kind, agent } = agentOf(c);
    const seen = agents.get(key);
    agents.set(key, { kind, agent, count: (seen?.count ?? 0) + 1 });
  }
  const agentName = (kind: string, agent: string | null) => {
    const provider = providers.find((p) => p.kind === kind);
    return (
      (agent ? (provider?.models.find((m) => m.slug === agent)?.name ?? agent) : null) ??
      provider?.displayName ??
      kind
    );
  };
  const filter = agentFilter && agents.has(agentFilter) ? agentFilter : null;
  const needle = query?.trim().toLowerCase() ?? "";

  const waiting = new Set(
    [...approvals, ...questions].flatMap(
      ({ requestId }) => Object.values(runs).find((r) => r.requestId === requestId)?.convoId ?? [],
    ),
  );
  const shelves: Record<ChatShelf, Conversation[]> = {
    active: [],
    snoozed: [],
    settled: [],
  };
  const shown = conversations.filter(
    (c) =>
      !isBlank(c) &&
      (!filter || agentOf(c).key === filter) &&
      (!needle || c.title.toLowerCase().includes(needle)),
  );
  for (const c of shown) {
    shelves[chatShelf(c, { working: Boolean(runs[c.id]), needsYou: waiting.has(c.id), now })].push(
      c,
    );
  }
  shelves.active.sort((a, b) => chatReturnedAt(b, now) - chatReturnedAt(a, now));
  shelves.snoozed.sort((a, b) => (a.snoozedUntil ?? 0) - (b.snoozedUntil ?? 0));
  shelves.settled.sort((a, b) => b.updatedAt - a.updatedAt);
  // The open chat stays in sight even past the settled ones shown.
  const settled = shelves.settled.filter((c, i) => i < settledShown || c.id === chatId);
  const hiddenSettled = shelves.settled.length - settled.length;
  const current = conversations.find((c) => c.id === chatId);

  const row = (c: Conversation, shelf: ChatShelf) => {
    const selected = c.id === chatId;
    let trailing: ReactNode;
    if (runs[c.id] && shelf === "active") {
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
        <div
          className={cn(
            "group/row flex h-8 w-full min-w-0 items-center rounded-lg pe-1 text-sm has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
            selected
              ? "bg-sidebar-row-selected text-sidebar-foreground"
              : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            aria-current={selected ? "page" : undefined}
            className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 ps-(--sidebar-row-content-inset) text-left outline-none"
          >
            <AgentAvatar
              kind={c.provider}
              agent={openClawAgentId(c.sessionId)}
              className="size-3.5 shrink-0"
            />
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {/* At rest the time (or state); on hover, the row's actions in its place. */}
            <span className="flex shrink-0 pe-(--sidebar-row-content-inset) group-hover/row:hidden group-has-[[data-state=open]]/row:hidden">
              {trailing}
            </span>
          </button>
          <RowActions chat={c} shelf={shelf} now={now} />
        </div>
      </ChatRowMenu>
    );
  };

  const empty = Object.values(shelves).every((list) => list.length === 0);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col pt-(--sidebar-content-inset)">
        {/* Otter Code's "All projects ⌄" and search: which agent's chats, and a search of them. */}
        <div className="flex items-center gap-1 px-(--sidebar-content-inset) pb-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-(--sidebar-row-content-inset) text-[15px] font-semibold text-sidebar-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover"
              >
                {filter ? (
                  <AgentAvatar
                    kind={agents.get(filter)!.kind}
                    agent={agents.get(filter)!.agent}
                    className="size-4"
                  />
                ) : null}
                <span className="truncate">
                  {filter
                    ? agentName(agents.get(filter)!.kind, agents.get(filter)!.agent)
                    : "All agents"}
                </span>
                <ChevronDownIcon className="size-3.5 shrink-0 text-sidebar-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => pickAgent(null)}>All agents</DropdownMenuItem>
              {agents.size > 0 ? <DropdownMenuSeparator /> : null}
              {[...agents]
                .sort((a, b) => b[1].count - a[1].count)
                .map(([key, { kind, agent, count }]) => (
                  <DropdownMenuItem
                    key={key}
                    icon={<AgentAvatar kind={kind} agent={agent} className="size-4" />}
                    accelerator={String(count)}
                    onSelect={() => pickAgent(key)}
                  >
                    {agentName(kind, agent)}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="flex-1" />
          <button
            type="button"
            aria-label="Search chats"
            onClick={() => setQuery((q) => (q === null ? "" : null))}
            className={cn(
              "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring",
              query !== null && "bg-sidebar-row-hover text-sidebar-foreground",
            )}
          >
            <SearchIcon className="size-4" />
          </button>
        </div>
        {query !== null ? (
          <div className="relative px-(--sidebar-content-inset) pb-1">
            <Input
              autoFocus
              size="sm"
              value={query}
              placeholder="Search chats"
              aria-label="Search chats"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setQuery(null);
              }}
              className="pe-7"
            />
            <button
              type="button"
              aria-label="Close search"
              onClick={() => setQuery(null)}
              className="absolute inset-y-0 end-(--sidebar-content-inset) flex w-7 cursor-pointer items-center justify-center pb-1 text-sidebar-muted-foreground hover:text-sidebar-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : null}
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
            {needle || filter ? "No chats match." : "Chats you start show up here."}
          </p>
        ) : needle ? (
          // A search shows every match in one list, newest first, shelves and all.
          (Object.entries(shelves) as [ChatShelf, Conversation[]][])
            .flatMap(([shelf, list]) => list.map((c) => ({ c, shelf })))
            .sort((a, b) => b.c.updatedAt - a.c.updatedAt)
            .map(({ c, shelf }) => row(c, shelf))
        ) : (
          <>
            {shelves.active.map((c) => row(c, "active"))}
            {/* The shelves sit at the bottom, under the chats you're on (Otter Code's). */}
            <div className="mt-auto">
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
          </>
        )}
      </SidebarBody>
    </div>
  );
}

const ROW_ACTION =
  "flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-[state=open]:bg-sidebar-row-hover data-[state=open]:text-sidebar-foreground";

/** Otter Code's hover actions: snooze (⏰) and Settle, or Unsettle a settled chat. */
function RowActions({ chat, shelf, now }: { chat: Conversation; shelf: ChatShelf; now: number }) {
  return (
    <div className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex group-has-[[data-state=open]]/row:flex">
      {shelf === "settled" ? (
        <button
          type="button"
          className={ROW_ACTION}
          onClick={() => void shelveChat(chat.id, { snoozedUntil: null, settledAt: null })}
        >
          <UndoIcon className="size-3.5" />
          Unsettle
        </button>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Snooze" title="Snooze" className={ROW_ACTION}>
                <AlarmClockIcon className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {snoozePresets(new Date(now)).map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  accelerator={p.when}
                  onSelect={() =>
                    void shelveChat(chat.id, { snoozedUntil: p.until, settledAt: null })
                  }
                >
                  {p.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className={ROW_ACTION}
            onClick={() => void shelveChat(chat.id, { snoozedUntil: null, settledAt: Date.now() })}
          >
            <CheckIcon className="size-3.5" />
            Settle
          </button>
        </>
      )}
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
