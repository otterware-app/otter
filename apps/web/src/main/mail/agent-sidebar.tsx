import { useState, type ReactNode } from "react";
import {
  AlarmClockIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  CircleXIcon,
  LaptopIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SquarePenIcon,
  UndoIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { Input } from "~/components/ui/input";
import { AgentAvatar, openClawAgentId, useAgentProviders } from "./agent-providers";
import { readableError } from "./add-mailbox";
import {
  discardDraft,
  hasDraft,
  isBlank,
  isElsewhere,
  pinChat,
  regenerateTitle,
  renameChat,
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
} from "./menu";
import { SidebarBody } from "./sidebar-ui";
import { TitleInput } from "./chat-title";
import { toast } from "./toast";
import { HintTooltip, cn } from "./ui";

const SETTLED_FIRST = 10;
const SETTLED_PAGE = 25;

const HEADER_BUTTON =
  "flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring";

const ROW_BODY =
  "flex min-w-0 flex-1 gap-2.5 py-1.5 ps-(--sidebar-row-content-inset) pe-(--sidebar-row-content-inset) text-left outline-none";

/** The row's time or pin, which its settle button takes the place of on hover (Otter Code's). */
const ROW_END_HIDES = "group-hover/row:invisible group-has-focus-visible/row:invisible";
const ROW_ACTION_SHOWS = "group-hover/row:flex group-has-focus-visible/row:flex";

const DRAFT_SURFACE = "bg-warning/4 hover:bg-warning/8";
const DRAFT_PEN = "size-3 shrink-0 text-warning-foreground";

const AGENT_FILTER_KEY = "gmail:chat-agent-filter";

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
  const [query, setQuery] = useState<string | null>(null);
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
  const needle = query?.trim().toLowerCase() ?? "";

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
  const shown = conversations.filter(
    (c) =>
      !isBlank(c) &&
      (!filter || agentOf(c).key === filter) &&
      (!needle || c.title.toLowerCase().includes(needle)),
  );
  const shelves = shelveChats(shown, {
    working: new Set(Object.keys(runs)),
    needsYou: waiting,
    now,
  });
  const settled = shelves.settled.filter((c, i) => i < settledShown || c.id === chatId);
  const hiddenSettled = shelves.settled.length - settled.length;
  const current = conversations.find((c) => c.id === chatId);

  // A new chat you're writing joins the drafts once you leave it, not as you type (Otter Code's).
  const [opened, setOpened] = useState({ chatId: "", hadDraft: false });
  if (opened.chatId !== chatId) setOpened({ chatId, hadDraft: hasDraft(drafts, chatId) });
  const newDrafts = needle
    ? []
    : conversations
        .filter(
          (c) =>
            isBlank(c) &&
            hasDraft(drafts, c.id) &&
            (c.id !== chatId || opened.hadDraft) &&
            (!filter || agentOf(c).key === filter),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
  const onNewChatPage = current !== undefined && isBlank(current) && !newDrafts.includes(current);

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

  const empty = newDrafts.length === 0 && Object.values(shelves).every((list) => list.length === 0);
  const divider = <div aria-hidden className="mx-2.5 my-1.5 h-px shrink-0 bg-sidebar-border/60" />;
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
              HEADER_BUTTON,
              query !== null && "bg-sidebar-row-hover text-sidebar-foreground",
            )}
          >
            <SearchIcon className="size-4" />
          </button>
          <HintTooltip label="New chat" shortcut="agent.newChat" side="bottom">
            <button
              type="button"
              aria-label="New chat"
              aria-current={onNewChatPage ? "page" : undefined}
              onClick={onNewChat}
              className={cn(
                HEADER_BUTTON,
                onNewChatPage && "bg-sidebar-row-selected text-sidebar-foreground",
              )}
            >
              <PlusIcon className="size-4" />
            </button>
          </HintTooltip>
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
      </div>
      <SidebarBody contentClassName="flex flex-col" flushBottom>
        {empty ? (
          <p className="px-(--sidebar-row-content-inset) py-1.5 text-[13px] text-sidebar-muted-foreground">
            {needle || filter ? "No chats match." : "Chats you start show up here."}
          </p>
        ) : needle ? (
          (Object.entries(shelves) as [ChatShelf, Conversation[]][])
            .flatMap(([shelf, list]) => list.map((c) => ({ c, shelf })))
            .sort((a, b) => b.c.updatedAt - a.c.updatedAt)
            .map(({ c, shelf }) => row(c, shelf))
        ) : (
          <>
            {newDrafts.map(draftRow)}
            {newDrafts.length > 0 && shelves.pinned.length + shelves.active.length > 0
              ? divider
              : null}
            {shelves.pinned.map((c) => row(c, "pinned"))}
            {shelves.pinned.length > 0 && shelves.active.length > 0 ? divider : null}
            {shelves.active.map((c) => row(c, "active"))}
            {/* The shelves sit at the bottom, under the chats you're on (Otter Code's). */}
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
  onRename,
  onRegenerate,
  children,
}: {
  chat: Conversation;
  shelf: ChatShelf;
  now: number;
  titles: boolean;
  regenerating: boolean;
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
