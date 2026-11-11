import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlarmClockIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CircleXIcon,
  LaptopIcon,
  ListFilterIcon,
  PinIcon,
  SearchIcon,
  SquarePenIcon,
  UndoIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import type { ChatMessageMatch } from "@otter/contracts/chats";
import {
  findTokenRanges,
  messageTokens,
  rankChatTitles,
  splitSearchText,
  type SearchRange,
} from "@otter/shared/chat-search";
import { SCHEDULED_TASKS, useScheduledTasks } from "./agent-scheduled";
import { AgentAvatar, openClawAgentId, useAgentProviders } from "./agent-providers";
import { readableError } from "../mail/add-mailbox";
import {
  discardDraft,
  hasDraft,
  isBlank,
  isElsewhere,
  pinChat,
  regenerateTitle,
  renameChat,
  searchChatMessages,
  showFoundMessage,
  shelveChat,
  useChats,
  type Conversation,
} from "./chat-store";
import {
  chatReturnedAt,
  shelveChats,
  shortAgo,
  snoozePresets,
  tabsSummary,
  useNow,
  wakesIn,
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
} from "../mail/menu";
import { NewRow, SIDEBAR_ROW, SidebarBody } from "../mail/sidebar-ui";
import { TitleInput } from "./chat-title";
import { toast } from "../mail/toast";
import { inNewWindow } from "../new-window-click";
import { PLACE } from "../place-menu";
import { HintTooltip, cn } from "../mail/ui";

const SETTLED_FIRST = 10;
const SETTLED_PAGE = 25;

const HEADER_BUTTON =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring";

const ROW_BODY =
  "flex min-w-0 flex-1 gap-2.5 py-1.5 ps-(--sidebar-row-content-inset) pe-(--sidebar-row-content-inset) text-left outline-none";

/** The row's time or pin, which its settle button takes the place of on hover (T3 Code's). */
const ROW_END_HIDES = "group-hover/row:invisible group-has-focus-visible/row:invisible";
const ROW_ACTION_SHOWS = "group-hover/row:flex group-has-focus-visible/row:flex";

const DRAFT_SURFACE = "bg-warning/4 hover:bg-warning/8";
const DRAFT_PEN = "size-3 shrink-0 text-warning-foreground";

const AGENT_FILTER_KEY = "gmail:chat-agent-filter";

const resultId = (index: number) => `agent-search-result-${index}`;
const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" });

function agentOf(c: Conversation): { key: string; kind: string; agent: string | null } {
  const agent = openClawAgentId(c.sessionId);
  return { key: agent ? `${c.provider}:${agent}` : c.provider, kind: c.provider, agent };
}

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
  const drafts = useChats((s) => s.drafts);
  const device = useChats((s) => s.device);
  const now = useNow(30_000);
  const [settledShown, setSettledShown] = useState(SETTLED_FIRST);
  const providers = useAgentProviders().data?.providers ?? [];
  const [agentFilter, setAgentFilter] = useState<string | null>(() => {
    try {
      return localStorage.getItem(AGENT_FILTER_KEY);
    } catch {
      return null;
    }
  });
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<ReadonlySet<string>>(new Set());
  const pickAgent = (key: string | null) => {
    setAgentFilter(key);
    try {
      if (key) localStorage.setItem(AGENT_FILTER_KEY, key);
      else localStorage.removeItem(AGENT_FILTER_KEY);
    } catch {
      // A per-device convenience: without storage the filter just doesn't stick.
    }
  };

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
  const searching = query.trim().length > 0;
  const messageQuery = messageTokens(query).length > 0 ? query.trim() : "";
  const messageSearch = useQuery({
    queryKey: ["chat-search", messageQuery],
    enabled: messageQuery !== "",
    queryFn: () => searchChatMessages(messageQuery),
  });

  const askedIn = (list: { requestId: string }[]) =>
    new Set(
      list.flatMap(
        ({ requestId }) =>
          Object.values(runs).find((r) => r.requestId === requestId)?.convoId ?? [],
      ),
    );
  const approving = askedIn(approvals);
  const asking = askedIn(questions);
  const waiting = new Set([...approving, ...asking]);
  const shown = conversations.filter((c) => !isBlank(c) && (!filter || agentOf(c).key === filter));
  const shelves = shelveChats(shown, {
    working: new Set(Object.keys(runs)),
    needsYou: waiting,
    now,
  });
  const settled = shelves.settled.filter((c, i) => i < settledShown || c.id === chatId);
  const hiddenSettled = shelves.settled.length - settled.length;
  const current = conversations.find((c) => c.id === chatId);

  // A new chat you're writing joins the drafts once you leave it, not as you type (T3 Code's).
  const [opened, setOpened] = useState({ chatId: "", hadDraft: false });
  if (opened.chatId !== chatId) setOpened({ chatId, hadDraft: hasDraft(drafts, chatId) });
  const newDrafts = conversations
    .filter(
      (c) =>
        isBlank(c) &&
        hasDraft(drafts, c.id) &&
        (c.id !== chatId || opened.hadDraft) &&
        (!filter || agentOf(c).key === filter),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const onNewChatPage = current !== undefined && isBlank(current) && !newDrafts.includes(current);

  // T3 Code's sidebar search: titles ranked first, then chats listed for a message.
  const titleResults = searching ? rankChatTitles(shown, query, now) : [];
  const titled = new Set(titleResults.map((r) => r.chat.id));
  const shownById = new Map(shown.map((c) => [c.id, c]));
  const messageResults =
    messageQuery && messageSearch.data
      ? messageSearch.data.flatMap((match) => {
          const chat = shownById.get(match.id);
          return chat && !titled.has(chat.id) ? [{ chat, ranges: [], match }] : [];
        })
      : [];
  const results: {
    chat: Conversation;
    ranges: readonly SearchRange[];
    match?: ChatMessageMatch;
  }[] = [...titleResults, ...messageResults];
  const active = Math.max(
    0,
    results.findIndex((r) => r.chat.id === highlighted),
  );
  const settledIds = new Set(shelves.settled.map((c) => c.id));
  const clearSearch = () => {
    setQuery("");
    setHighlighted(null);
  };
  const pickResult = ({ chat, match }: (typeof results)[number]) => {
    showFoundMessage(match ? { turnId: match.turnId, query: messageQuery } : null);
    clearSearch();
    onSelect(chat.id);
  };
  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape" && query) {
      e.preventDefault();
      e.stopPropagation();
      clearSearch();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && results.length > 0) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlighted(results[(active + step + results.length) % results.length]!.chat.id);
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      pickResult(results[active]);
    }
  };

  const status = (c: Conversation): ReactNode => {
    if (approving.has(c.id))
      return (
        <Status
          icon={CircleAlertIcon}
          className="text-warning-foreground"
          label="Needs your approval"
        />
      );
    if (asking.has(c.id))
      return (
        <Status icon={CircleAlertIcon} className="text-warning-foreground" label="Has a question" />
      );
    if (runs[c.id]) return <Status icon={CircleDashedIcon} className="text-info" label="Working" />;
    if (c.turns.at(-1)?.error)
      return <Status icon={CircleXIcon} className="text-destructive-foreground" label="Failed" />;
    if (isElsewhere(c, device)) return <Status icon={LaptopIcon} label={`On ${c.device!.name}`} />;
    return tabsSummary(c.tabs) || agentName(c.provider, openClawAgentId(c.sessionId));
  };

  const draftRow = (c: Conversation) => {
    const selected = c.id === chatId;
    const preview = drafts[c.id]!.trim().split("\n", 1)[0];
    const agent = openClawAgentId(c.sessionId);
    return (
      <div
        key={c.id}
        className={cn(
          "group/row relative rounded-lg has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
          selected ? "bg-sidebar-row-selected" : DRAFT_SURFACE,
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          aria-current={selected ? "page" : undefined}
          aria-label={`Unsent draft: ${preview}`}
          className="flex w-full min-w-0 cursor-pointer flex-col gap-0.5 py-1.5 ps-(--sidebar-row-content-inset) pe-(--sidebar-row-content-inset) text-left outline-none"
        >
          <span className="flex h-5 min-w-0 items-center gap-1.5 pe-5">
            <SquarePenIcon aria-hidden className={DRAFT_PEN} />
            <AgentAvatar kind={c.provider} agent={agent} className="size-3.5 shrink-0" />
            <span className="truncate text-xs font-medium text-sidebar-muted-foreground">
              {agentName(c.provider, agent)}
            </span>
          </span>
          <span className="truncate text-sm text-sidebar-foreground">{preview}</span>
        </button>
        <button
          type="button"
          aria-label="Discard draft"
          title="Discard draft"
          onClick={() => discardDraft(c.id)}
          className="absolute end-1.5 top-1.5 hidden size-5 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none group-hover/row:flex hover:text-sidebar-foreground focus-visible:flex focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <XIcon className="size-3" />
        </button>
      </div>
    );
  };

  const row = (c: Conversation, shelf: ChatShelf) => {
    const selected = c.id === chatId;
    const titles = Boolean(providers.find((p) => p.kind === c.provider)?.titles);
    const fresh = (unseen.has(c.id) || waiting.has(c.id)) && !selected;
    const drafted = !selected && hasDraft(drafts, c.id);
    const oneLine = shelf === "snoozed" || shelf === "settled";
    let end: ReactNode;
    if (shelf === "pinned") end = <PinIcon aria-label="Pinned" className="size-3" />;
    else if (shelf === "snoozed")
      end = (
        <span className="flex items-center gap-1">
          <AlarmClockIcon aria-label="Wakes in" className="size-3" />
          {wakesIn(c.snoozedUntil ?? now, now)}
        </span>
      );
    else
      end = shortAgo(
        shelf === "settled" ? (c.settledAt ?? c.updatedAt) : chatReturnedAt(c, now),
        now,
      );
    const renaming = editing === c.id;
    const busy = regenerating.has(c.id);
    const startRename = () => setEditing(c.id);
    const body = (title: ReactNode) => (
      <>
        <AgentAvatar
          kind={c.provider}
          agent={openClawAgentId(c.sessionId)}
          className={cn("size-3.5 shrink-0", !oneLine && "mt-[3px]")}
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            {drafted ? <SquarePenIcon aria-label="Unsent draft" className={DRAFT_PEN} /> : null}
            {title}
            {fresh ? (
              <span aria-label="New" className="size-1.5 shrink-0 rounded-full bg-primary" />
            ) : null}
            {renaming ? null : (
              <span
                className={cn(
                  "ms-auto shrink-0 ps-1 text-[11px] tabular-nums text-sidebar-muted-foreground/70",
                  ROW_END_HIDES,
                )}
              >
                {end}
              </span>
            )}
          </span>
          {oneLine ? null : (
            <span className="truncate text-xs text-sidebar-muted-foreground/80">{status(c)}</span>
          )}
        </span>
      </>
    );
    return (
      <ChatRowMenu
        key={c.id}
        chat={c}
        shelf={shelf}
        now={now}
        titles={titles}
        regenerating={busy}
        onOpen={() => onSelect(c.id)}
        onRename={startRename}
        onRegenerate={() => {
          setRegenerating((ids) => new Set(ids).add(c.id));
          void regenerateTitle(c.id)
            .catch((err: unknown) =>
              toast.error("Couldn't regenerate the title", { description: readableError(err) }),
            )
            .finally(() =>
              setRegenerating((ids) => {
                const next = new Set(ids);
                next.delete(c.id);
                return next;
              }),
            );
        }}
      >
        <div
          className={cn(
            "group/row relative flex w-full min-w-0 items-center rounded-lg",
            !renaming && "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
            selected
              ? "bg-sidebar-row-selected text-sidebar-foreground"
              : drafted
                ? cn(DRAFT_SURFACE, "text-sidebar-foreground")
                : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          )}
        >
          {renaming ? (
            <div className={cn(ROW_BODY, oneLine && "items-center")}>
              {body(
                <TitleInput
                  title={c.title}
                  onDone={(title) => {
                    setEditing(null);
                    if (title === null) return;
                    if (!title.trim()) toast.warning("A chat's title can't be empty");
                    else void renameChat(c.id, title, titles);
                  }}
                />,
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onSelect(c.id)}
              {...PLACE}
              onDoubleClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                startRename();
              }}
              onKeyDown={(e) => {
                if (e.key !== "F2") return;
                e.preventDefault();
                startRename();
              }}
              aria-current={selected ? "page" : undefined}
              aria-busy={busy || undefined}
              className={cn(ROW_BODY, oneLine && "items-center", "cursor-pointer")}
            >
              {body(
                <span
                  className={cn(
                    "min-w-0 truncate text-sm",
                    (selected || fresh || drafted) && "text-sidebar-foreground",
                    busy && "opacity-55",
                  )}
                >
                  {c.title}
                </span>,
              )}
            </button>
          )}
          {renaming ? null : (
            <button
              type="button"
              aria-label={shelf === "settled" ? "Unsettle" : "Settle"}
              title={shelf === "settled" ? "Unsettle" : "Settle"}
              onClick={() =>
                void shelveChat(
                  c.id,
                  shelf === "settled"
                    ? { snoozedUntil: null, settledAt: null }
                    : { snoozedUntil: null, settledAt: Date.now() },
                )
              }
              className={cn(
                "absolute end-1.5 hidden size-6 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring",
                oneLine ? "inset-y-0 my-auto" : "top-1",
                ROW_ACTION_SHOWS,
              )}
            >
              {shelf === "settled" ? (
                <UndoIcon className="size-3.5" />
              ) : (
                <CheckIcon className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </ChatRowMenu>
    );
  };

  const resultRow = (result: (typeof results)[number], index: number) => {
    const { chat: c, ranges, match } = result;
    const lit = index === active;
    const selected = c.id === chatId;
    const settled = settledIds.has(c.id);
    return (
      <li key={c.id} ref={lit ? scrollIntoView : undefined} role="presentation">
        <button
          id={resultId(index)}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={lit}
          aria-current={selected ? "page" : undefined}
          onMouseMove={() => setHighlighted(c.id)}
          onClick={() => pickResult(result)}
          className={cn(
            "flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-lg py-1.5 ps-(--sidebar-row-content-inset) pe-(--sidebar-row-content-inset) text-left outline-none",
            lit || selected
              ? "bg-sidebar-row-selected text-sidebar-foreground"
              : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          )}
        >
          <AgentAvatar
            kind={c.provider}
            agent={openClawAgentId(c.sessionId)}
            className={cn(
              "size-3.5 shrink-0",
              settled && !lit && !selected && "opacity-40 grayscale",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-sm",
                  (!settled || lit || selected) && "text-sidebar-foreground",
                )}
              >
                <Highlighted text={c.title} ranges={ranges} />
              </span>
              <span className="shrink-0 ps-1 text-[11px] tabular-nums text-sidebar-muted-foreground/70">
                {shortAgo(c.updatedAt, now)}
              </span>
            </span>
            {match ? (
              <span className="truncate text-xs text-sidebar-muted-foreground/85">
                <span
                  className={
                    match.role === "user" ? "text-info-foreground" : "text-success-foreground"
                  }
                >
                  {match.role === "user" ? "You:" : "Agent:"}
                </span>{" "}
                <Highlighted
                  text={match.snippet}
                  ranges={findTokenRanges(match.snippet, messageTokens(messageQuery))}
                />
              </span>
            ) : null}
          </span>
        </button>
      </li>
    );
  };

  const empty = newDrafts.length === 0 && Object.values(shelves).every((list) => list.length === 0);
  const divider = <div aria-hidden className="mx-2.5 my-1.5 h-px shrink-0 bg-sidebar-border/60" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col pt-(--sidebar-content-inset)">
        <NewRow
          icon={<SquarePenIcon />}
          label="New chat"
          selected={onNewChatPage}
          place
          onClick={onNewChat}
        />
        <ScheduledRow
          selected={chatId === SCHEDULED_TASKS}
          onSelect={() => onSelect(SCHEDULED_TASKS)}
        />
        {/* T3 Code's thread search and project filter: a search of the chats, and which agent's. */}
        <div className="flex items-center gap-1 px-(--sidebar-content-inset) pt-3 pb-1">
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-(--sidebar-row-content-inset) text-sidebar-muted-foreground focus-within:bg-sidebar-row-hover focus-within:text-sidebar-foreground focus-within:ring-1 focus-within:ring-focus-ring focus-within:ring-inset hover:bg-sidebar-row-hover hover:text-sidebar-foreground">
            <SearchIcon aria-hidden className="size-4 shrink-0" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search"
              aria-label="Search chats"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={searching && results.length > 0}
              aria-controls={searching && results.length > 0 ? "agent-search-results" : undefined}
              aria-activedescendant={searching && results[active] ? resultId(active) : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlighted(null);
              }}
              onKeyDown={onSearchKeyDown}
              className="min-w-0 flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-sidebar-muted-foreground [&::-webkit-search-cancel-button]:hidden"
            />
            {searching ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  clearSearch();
                  searchRef.current?.focus();
                }}
                className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <XIcon className="size-3" />
              </button>
            ) : null}
          </div>
          <DropdownMenu>
            <HintTooltip
              label={
                filter
                  ? `Showing ${agentName(agents.get(filter)!.kind, agents.get(filter)!.agent)}'s chats`
                  : "Filter chats by agent"
              }
              side="bottom"
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Filter chats by agent"
                  className={cn(HEADER_BUTTON, "data-[state=open]:bg-sidebar-row-hover")}
                >
                  {filter ? (
                    <AgentAvatar
                      kind={agents.get(filter)!.kind}
                      agent={agents.get(filter)!.agent}
                      className="size-4"
                    />
                  ) : (
                    <ListFilterIcon className="size-4" />
                  )}
                </button>
              </DropdownMenuTrigger>
            </HintTooltip>
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
        </div>
      </div>
      <SidebarBody contentClassName="flex flex-col" flushBottom>
        {searching ? (
          results.length > 0 ? (
            <ul id="agent-search-results" role="listbox" aria-label="Chat search results">
              {results.map(resultRow)}
            </ul>
          ) : (
            <p
              role="status"
              className="px-(--sidebar-row-content-inset) py-6 text-center text-xs text-sidebar-muted-foreground"
            >
              {messageSearch.isFetching ? "Searching messages…" : "No chats found"}
            </p>
          )
        ) : empty ? (
          <p className="px-(--sidebar-row-content-inset) py-1.5 text-[13px] text-sidebar-muted-foreground">
            {filter ? "No chats match." : "Chats you start show up here."}
          </p>
        ) : (
          <>
            {newDrafts.map(draftRow)}
            {newDrafts.length > 0 && shelves.pinned.length + shelves.active.length > 0
              ? divider
              : null}
            {shelves.pinned.map((c) => row(c, "pinned"))}
            {shelves.pinned.length > 0 && shelves.active.length > 0 ? divider : null}
            {shelves.active.map((c) => row(c, "active"))}
            {/* The shelves sit at the bottom, under the chats you're on (T3 Code's). */}
            <div className="mt-auto pt-4">
              {shelves.snoozed.length > 0 ? (
                <Shelf title="Snoozed" count={shelves.snoozed.length}>
                  {shelves.snoozed.map((c) => row(c, "snoozed"))}
                </Shelf>
              ) : null}
              {shelves.settled.length > 0 ? (
                <Shelf title="Settled" count={shelves.settled.length}>
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
                </Shelf>
              ) : null}
            </div>
          </>
        )}
      </SidebarBody>
    </div>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: readonly SearchRange[] }) {
  if (ranges.length === 0) return text;
  return splitSearchText(text, ranges).map((part) =>
    part.highlighted ? (
      <mark key={part.start} className="bg-transparent font-semibold text-sidebar-foreground">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

/** Every agent's scheduled tasks. */
function ScheduledRow({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  const agents = useScheduledTasks().data ?? [];
  const tasks = agents.flatMap((a) => a.tasks);
  const active = tasks.filter((t) => t.enabled && !t.managedBy).length;
  const failing =
    tasks.some((t) => t.enabled && t.lastRun?.status === "error") || agents.some((a) => a.error);
  return (
    <div className="flex shrink-0 flex-col px-(--sidebar-content-inset)">
      <button
        type="button"
        onClick={onSelect}
        {...PLACE}
        aria-current={selected ? "page" : undefined}
        className={cn(
          SIDEBAR_ROW,
          "px-(--sidebar-row-content-inset)",
          selected
            ? "bg-sidebar-row-selected text-sidebar-foreground"
            : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
        )}
      >
        <CalendarClockIcon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Scheduled</span>
        {failing ? (
          <CircleAlertIcon
            aria-label="One isn't working"
            className="size-3.5 shrink-0 text-warning-foreground"
          />
        ) : null}
        {active > 0 ? (
          <span className="shrink-0 text-xs tabular-nums text-sidebar-muted-foreground/70">
            {active}
          </span>
        ) : null}
      </button>
    </div>
  );
}

function Status({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function Shelf({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-(--sidebar-row-content-inset) text-left text-xs font-medium text-sidebar-muted-foreground outline-none hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="flex-1">{title}</span>
        <span className="font-normal tabular-nums">{count}</span>
        <ChevronRightIcon
          aria-hidden
          className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open ? children : null}
    </div>
  );
}

function ChatRowMenu({
  chat,
  shelf,
  now,
  titles,
  regenerating,
  onOpen,
  onRename,
  onRegenerate,
  children,
}: {
  chat: Conversation;
  shelf: ChatShelf;
  now: number;
  titles: boolean;
  regenerating: boolean;
  onOpen: () => void;
  onRename: () => void;
  onRegenerate: () => void;
  children: ReactNode;
}) {
  const bringBack = () => void shelveChat(chat.id, { snoozedUntil: null, settledAt: null });
  const pinned = chat.pinnedAt != null;
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => inNewWindow(onOpen)}>Open in New Window</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void pinChat(chat.id, !pinned)}>
          {pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
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
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onRename}>Rename</ContextMenuItem>
        {titles && chat.sessionId ? (
          <ContextMenuItem disabled={regenerating} onSelect={onRegenerate}>
            {regenerating ? "Regenerating…" : "Regenerate title"}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
