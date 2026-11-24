import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  DndContext,
  useSensor,
  useSensors,
  type AutoScrollOptions,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Modifier,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  LaptopIcon,
  ListFilterIcon,
  MessageCircleQuestionIcon,
  PinIcon,
  SearchIcon,
  ShieldQuestionIcon,
  SquarePenIcon,
  Undo2Icon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import {
  findTokenRanges,
  messageTokens,
  splitSearchText,
  type SearchRange,
} from "@otter/shared/chat-search";
import { SCHEDULED_TASKS } from "./agent-scheduled";
import { scheduledSummary, useScheduledTasks } from "@otter/client/agents/agent-scheduled";
import { useAutoSettleDays } from "@otter/client/agents/auto-settle";
import { AgentAvatar } from "./agent-providers";
import { TAB_ICONS } from "./chat-context-panel";
import {
  bringBackChat,
  regenerateChatTitle,
  renameChatAs,
  settleChat,
  snoozeChat,
} from "@otter/client/agents/chat-actions";
import {
  agentNameOf,
  chatAgentOf,
  chatAgents,
  chatRowStatus,
  chatSearchResults,
  chatsWaitingOnYou,
  draftPreview,
  getChatAgentFilter,
  messageSearchQuery,
  newDraftChats,
  rowRecedes,
  setChatAgentFilter,
  useChatMessageSearch,
  usedTabKinds,
  type ChatSearchResult,
  type ChatStatus,
} from "@otter/client/agents/chat-list";
import {
  discardDraft,
  hasDraft,
  isBlank,
  isElsewhere,
  pinChat,
  showFoundMessage,
  useChats,
  type Conversation,
} from "@otter/client/agents/chat-store";
import {
  chatLastMessageAt,
  chatSettledAt,
  shelveChats,
  shortAgo,
  snoozePresets,
  tabsSummary,
  useNow,
  wakesIn,
  type ChatShelf,
} from "@otter/client/agents/chat-shelves";
import {
  chatIdAtY,
  createCollisionDetection,
  createSortingStrategy,
  dropTarget,
  dropVerb,
  listItemId,
  planDrop,
  restrictBelowLabel,
  sweepIds,
  withDrop,
  type DropShelf,
  type ListItem,
  type ListMarker,
  type SweepAction,
} from "./sidebar-drag";
import {
  DragBoundary,
  DropBadge,
  ShelfHeader,
  ShelfPlaceholder,
  SortableRow,
} from "./sidebar-list";
import { createSidebarListMotion } from "./sidebar-motion";
import { SidebarPointerSensor } from "./sidebar-pointer";
import { SidebarAction, sidebarRowClassName, SidebarBody } from "@otter/ui/components/sidebar";
import { TitleInput } from "./chat-title";
import { inNewWindow } from "../new-window-click";
import { PLACE } from "../place-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuTrigger,
} from "@otter/ui/components/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";
import { cn } from "@otter/ui/lib/utils";
import { openClawAgentId, useAgentProviders } from "@otter/client/agents/agent-providers";

const SETTLED_FIRST = 10;
const SETTLED_PAGE = 25;

const DRAG_DISTANCE = 6;
// dnd-kit's 20% edge zone at full speed runs the list away while the pointer rests near the bottom.
const AUTO_SCROLL: AutoScrollOptions = { threshold: { x: 0, y: 0.05 }, acceleration: 3 };
const DRAG_LABEL_HEIGHT = 24;
const NO_PINS = new Map<string, number>();

/** The row's time or status, which its controls take the place of on hover (T3 Code's). */
const ROW_END_HIDES = "group-hover/row:invisible group-has-focus-visible/row:invisible";
const ROW_ACTION_SHOWS = "group-hover/row:flex group-has-focus-visible/row:flex";
const ROW_ACTION =
  "flex h-6 min-w-6 cursor-pointer items-center justify-center gap-1 rounded-md px-1 text-xs text-sidebar-muted-foreground outline-none hover:bg-foreground/[0.08] hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring data-popup-open:bg-foreground/[0.08]";

const DRAFT_SURFACE = "bg-warning/4 hover:bg-warning/8";
const DRAFT_PEN = "size-3 shrink-0 text-warning-foreground";

const resultId = (index: number) => `agent-search-result-${index}`;
const scrollIntoView = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest" });

const STATUS_LOOK: Record<ChatStatus, { icon: LucideIcon; className: string }> = {
  approval: { icon: ShieldQuestionIcon, className: "text-warning-foreground" },
  input: { icon: MessageCircleQuestionIcon, className: "text-question-foreground" },
  working: { icon: CircleDashedIcon, className: "text-info-foreground" },
  failed: { icon: CircleAlertIcon, className: "text-destructive-foreground" },
  done: { icon: CircleCheckIcon, className: "text-success-foreground" },
};

type Held = { id: string; shelf: DropShelf; at: number; pinnedAt: ReadonlyMap<string, number> };

type Drag = {
  id: string;
  from: ChatShelf;
  to: ChatShelf | null;
  /** It follows the pointer through the drag, so it lasts as long as the drag does. */
  detect: CollisionDetection;
};

const ANY_TARGET = createCollisionDetection(() => true);

const chatItems = (list: Conversation[], shelf: ChatShelf): ListItem[] =>
  list.map((c) => ({ kind: "chat", id: c.id, shelf }));
const marker = (name: ListMarker): ListItem => ({ kind: "marker", marker: name });

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
  const now = useNow(Object.keys(runs).length > 0 ? 1_000 : 30_000);
  const autoSettleDays = useAutoSettleDays();
  const [settledShown, setSettledShown] = useState(SETTLED_FIRST);
  const [snoozedOpen, setSnoozedOpen] = useState(false);
  const [settledOpen, setSettledOpen] = useState(false);
  const providersState = useAgentProviders().data;
  const providers = providersState?.providers ?? [];
  const [agentFilter, setAgentFilter] = useState(getChatAgentFilter);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<ReadonlySet<string>>(new Set());
  // A drop shows at once, while the chat loads and saves (T3 Code's optimistic drop).
  const [held, setHeld] = useState<Held | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sweep, setSweep] = useState<{ action: SweepAction; ids: ReadonlySet<string> } | null>(
    null,
  );
  const listRef = useRef<HTMLUListElement | null>(null);
  const motionRef = useRef<ReturnType<typeof createSidebarListMotion> | null>(null);
  const sensorRef = useRef<SidebarPointerSensor | null>(null);
  const labelOffsetRef = useRef(0);
  const pickAgent = (key: string | null) => {
    setAgentFilter(key);
    setChatAgentFilter(key);
  };

  const agents = chatAgents(conversations);
  const agentName = (id: string, agent: string | null) => agentNameOf(providersState, id, agent);
  const filter = agentFilter && agents.has(agentFilter) ? agentFilter : null;
  const searching = query.trim().length > 0;
  const messageQuery = messageSearchQuery(query);
  const messageSearch = useChatMessageSearch(query);
  const statusState = { runs, approvals, questions, conversations, unseen };
  const waiting = chatsWaitingOnYou(statusState);
  const listed =
    held === null
      ? conversations
      : conversations.map((c) =>
          c.id === held.id
            ? withDrop(c, held.shelf, held.at, held.pinnedAt.get(c.id))
            : held.pinnedAt.has(c.id)
              ? { ...c, pinnedAt: held.pinnedAt.get(c.id)! }
              : c,
        );
  const shown = listed.filter((c) => !isBlank(c) && (!filter || chatAgentOf(c).key === filter));
  const shelves = shelveChats(shown, {
    working: new Set(Object.keys(runs)),
    needsYou: waiting,
    now,
    autoSettleDays,
  });
  const settled = settledOpen
    ? shelves.settled.filter((c, i) => i < settledShown || c.id === chatId)
    : [];
  const hiddenSettled = settledOpen ? shelves.settled.length - settled.length : 0;
  const current = conversations.find((c) => c.id === chatId);

  // A new chat you're writing joins the drafts once you leave it, not as you type (T3 Code's).
  const [opened, setOpened] = useState({ chatId: "", hadDraft: false });
  if (opened.chatId !== chatId) setOpened({ chatId, hadDraft: hasDraft(drafts, chatId) });
  const newDrafts = newDraftChats(conversations, drafts, {
    openId: chatId,
    openedWithDraft: opened.hadDraft,
    agent: filter,
  });
  const onNewChatPage = current !== undefined && isBlank(current) && !newDrafts.includes(current);

  // T3 Code's list: the pinned chats, the active ones, then the shelves, with the markers a drag
  // moves rows around and drops them by.
  const noChats = Object.values(shelves).every((list) => list.length === 0);
  const freshItems: ListItem[] = noChats
    ? []
    : [
        marker("pinned-header"),
        ...chatItems(shelves.pinned, "pinned"),
        marker("pinned-divider"),
        marker("active-placeholder"),
        ...chatItems(shelves.active, "active"),
        ...(shelves.snoozed.length > 0
          ? [
              marker("snoozed-header"),
              ...(snoozedOpen ? chatItems(shelves.snoozed, "snoozed") : []),
            ]
          : []),
        marker("settled-header"),
        marker("settled-placeholder"),
        ...chatItems(settled, "settled"),
      ];
  // Kept while the order holds, so a drag isn't thrown off by the list re-rendering under it.
  const itemsKey = freshItems
    .map((item) => (item.kind === "chat" ? `${item.shelf}:${item.id}` : item.marker))
    .join("\n");
  const [kept, setKept] = useState({ key: itemsKey, items: freshItems });
  if (kept.key !== itemsKey) setKept({ key: itemsKey, items: freshItems });
  const items = kept.key === itemsKey ? kept.items : freshItems;
  const chatById = new Map(listed.map((c) => [c.id, c]));
  const shelfOf = new Map(
    items.flatMap((item) => (item.kind === "chat" ? [[item.id, item.shelf] as const] : [])),
  );
  const orderedIds = items.flatMap((item) => (item.kind === "chat" ? [item.id] : []));
  const idsOn = (shelf: ChatShelf) =>
    items.flatMap((item) => (item.kind === "chat" && item.shelf === shelf ? [item.id] : []));
  const shelfOfRef = useRef(shelfOf);
  const orderedIdsRef = useRef(orderedIds);
  useLayoutEffect(() => {
    shelfOfRef.current = shelfOf;
    orderedIdsRef.current = orderedIds;
  });

  const results = chatSearchResults(shown, query, now, messageSearch.data);
  const active = Math.max(
    0,
    results.findIndex((r) => r.chat.id === highlighted),
  );
  const settledIds = new Set(shelves.settled.map((c) => c.id));
  const clearSearch = () => {
    setQuery("");
    setHighlighted(null);
  };
  const pickResult = ({ chat, match }: ChatSearchResult) => {
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

  // T3 Code's drag: a chat dropped among the pinned ones is pinned there, on Settled it settles,
  // among the active ones it comes back.
  const dropChat = (id: string, from: ChatShelf, overId: string) => {
    // Shown at `now` until it's saved, with the time it's saved at.
    const at = now;
    const target = dropTarget(items, id, overId);
    if (!target) return;
    const plan = planDrop({
      id,
      from,
      target,
      pinnedOrder: idsOn("pinned"),
      pinnedAt: new Map(shelves.pinned.map((c) => [c.id, c.pinnedAt ?? 0])),
      now: at,
    });
    if (plan.kind === "none") return;
    const hold: Held = {
      id,
      shelf: target.shelf,
      at,
      pinnedAt: plan.kind === "pin" ? plan.pinnedAt : NO_PINS,
    };
    setHeld(hold);
    const saves =
      plan.kind === "pin"
        ? [...plan.pinnedAt].map(([pinned, when]) => pinChat(pinned, true, when))
        : plan.kind === "settle"
          ? [settleChat(id)]
          : from === "pinned"
            ? [pinChat(id, false)]
            : [bringBackChat(id)];
    void Promise.all(saves).finally(() => setHeld((h) => (h === hold ? null : h)));
  };

  // Made once: fresh options would rebuild the DndContext and every row with it.
  const [sensorOptions] = useState(() => ({
    distance: DRAG_DISTANCE,
    onAttach: (sensor: SidebarPointerSensor) => {
      sensorRef.current = sensor;
    },
    onFinish: (started: boolean) => {
      sensorRef.current = null;
      if (started) {
        motionRef.current?.release();
        setDrag(null);
      }
    },
  }));
  const sensors = useSensors(useSensor(SidebarPointerSensor, sensorOptions));
  const restrictBelowPins: Modifier = (args) => restrictBelowLabel(args, labelOffsetRef.current);
  const modifiers = [restrictToVerticalAxis, restrictBelowPins, restrictToFirstScrollableAncestor];
  const onDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const from = shelfOf.get(id);
    if (from === undefined) return;
    motionRef.current?.suspend();
    const list = listRef.current;
    const header = list?.querySelector<HTMLElement>('[data-marker="pinned-header"]');
    if (list && header) {
      const listRect = list.getBoundingClientRect();
      const scale = list.offsetWidth > 0 ? listRect.width / list.offsetWidth : 1;
      labelOffsetRef.current =
        header.getBoundingClientRect().top - listRect.top + DRAG_LABEL_HEIGHT * scale;
    } else {
      labelOffsetRef.current = 0;
    }
    const pinnedOrder = idsOn("pinned");
    const detect = createCollisionDetection(
      (overId) => {
        const target = dropTarget(items, id, overId);
        if (target === null) return false;
        const plan = planDrop({ id, from, target, pinnedOrder, pinnedAt: NO_PINS, now: 0 });
        return plan.kind !== "none";
      },
      {
        items,
        activationY:
          event.activatorEvent instanceof PointerEvent ? event.activatorEvent.clientY : null,
      },
    );
    setDrag({ id, from, to: from, detect });
  };
  const onDragOver = (event: DragOverEvent) => {
    const id = String(event.active.id);
    const target = event.over ? dropTarget(items, id, String(event.over.id)) : null;
    setDrag((d) => (d === null || d.id !== id ? d : { ...d, to: target?.shelf ?? null }));
  };
  const onDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    const from = shelfOf.get(id);
    if (from !== undefined && event.over) dropChat(id, from, String(event.over.id));
  };
  // A drag whose row left the list (deleted, or settled elsewhere) can never drop.
  useEffect(() => {
    if (drag !== null && !items.some((item) => item.kind === "chat" && item.id === drag.id))
      sensorRef.current?.cancel();
  }, [drag, items]);

  const dragId = drag?.id;
  const dragFrom = drag?.from;
  const collisionDetection = drag?.detect ?? ANY_TARGET;
  // Where the dragged chat would sort on each shelf: on top of the active and settled ones, as
  // coming back and settling date it now.
  const onTop = (shelf: "active" | "settled", ids: string[]) =>
    dragId === undefined || dragFrom === shelf
      ? ids
      : [dragId, ...ids.filter((id) => id !== dragId)];
  const sortingStrategy = createSortingStrategy({
    items,
    activeOrder: onTop("active", idsOn("active")),
    settledOrder: onTop(
      "settled",
      shelves.settled.map((c) => c.id),
    ),
    settledExpanded: settledOpen,
    settledVisibleCount: settledShown,
    openId: chatId,
    snoozedCount: shelves.snoozed.length,
    boundaryLabelHeight: DRAG_LABEL_HEIGHT,
  });
  const dragTo = drag === null ? null : drag.to;

  // Press Settle, Unsettle or Wake and sweep over the rows to do it to each (T3 Code's).
  const startSweep = (originId: string, action: SweepAction, event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.stopPropagation();
    const originShelf = shelfOfRef.current.get(originId);
    const canApply = (id: string) => shelfOfRef.current.get(id) === originShelf;
    let targetId: string | null = null;
    let swept: string[] = [];
    const sweepTo = (id: string | null) => {
      if (id === null || id === targetId) return;
      targetId = id;
      swept = sweepIds(orderedIdsRef.current, originId, id, canApply);
      setSweep({ action, ids: new Set(swept) });
    };
    sensorRef.current = new SidebarPointerSensor({
      active: originId,
      event: event.nativeEvent,
      options: {
        distance: DRAG_DISTANCE,
        onAttach: () => {},
        onFinish: () => {
          sensorRef.current = null;
          setSweep(null);
        },
      },
      onPending: () => {},
      onStart: () => sweepTo(originId),
      onMove: ({ y }) => sweepTo(listRef.current && chatIdAtY(listRef.current, y)),
      onEnd: () => {
        for (const id of swept.filter(canApply)) {
          void (action === "settle" ? settleChat(id) : bringBackChat(id));
        }
      },
      onCancel: () => {},
      onAbort: () => {},
    });
  };
  const sweepVerb = (id: string) =>
    sweep?.ids.has(id)
      ? sweep.action === "settle"
        ? ("settle" as const)
        : sweep.action === "unsettle"
          ? ("unsettle" as const)
          : ("wake" as const)
      : null;

  // Stable, so its cleanup runs only as the list goes (search replaces it).
  const attachList = useCallback((node: HTMLUListElement) => {
    listRef.current = node;
    const motion = createSidebarListMotion(node);
    motionRef.current = motion;
    motion.update(false);
    return () => {
      // A drag whose rows are gone can never drop.
      sensorRef.current?.cancel();
      motion.dispose();
      if (motionRef.current === motion) motionRef.current = null;
      if (listRef.current === node) listRef.current = null;
    };
  }, []);
  // Rows glide to where a change puts them, except rows a shelf opens or closes on, which would
  // travel over the headers anchored at the bottom.
  const animate = drag === null && items.length + newDrafts.length > 0;
  useLayoutEffect(() => {
    motionRef.current?.update(animate);
  });
  const toggleShelf = (toggle: () => void) => {
    motionRef.current?.suspend();
    toggle();
  };

  const draftRow = (c: Conversation) => {
    const selected = c.id === chatId;
    const preview = draftPreview(drafts[c.id]!);
    const agent = openClawAgentId(c.sessionId);
    return (
      <li key={c.id} className="list-none py-0.5">
        <div
          className={cn(
            "group/row relative rounded-lg select-none has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
            selected ? "bg-sidebar-row-selected" : DRAFT_SURFACE,
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(c.id)}
            aria-current={selected ? "page" : undefined}
            aria-label={`Unsent draft: ${preview}`}
            className="flex w-full min-w-0 cursor-pointer flex-col px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-left outline-none"
          >
            <span className="flex h-5 min-w-0 items-center gap-1.5 pe-6">
              <SquarePenIcon aria-hidden className={DRAFT_PEN} />
              <AgentAvatar id={c.provider} agent={agent} className="size-4 shrink-0" />
              <span className="truncate text-xs text-secondary-label">
                {agentName(c.provider, agent)}
              </span>
            </span>
            <span className="mt-1 truncate text-sm font-medium text-sidebar-foreground/90">
              {preview}
            </span>
          </button>
          <button
            type="button"
            aria-label="Discard draft"
            title="Discard draft"
            onClick={() => discardDraft(c.id)}
            className={cn(
              ROW_ACTION,
              "absolute end-1.5 top-1.5 hidden group-hover/row:flex focus-visible:flex",
            )}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </li>
    );
  };

  const row = (c: Conversation, shelf: ChatShelf, dragging: boolean) => {
    const selected = c.id === chatId;
    const titles = Boolean(providers.find((p) => p.id === c.provider)?.titles);
    const status = chatRowStatus(statusState, c, selected, now);
    const look = status && STATUS_LOOK[status.kind];
    const unread = unseen.has(c.id) && !selected;
    const recede = rowRecedes(status, unread, selected);
    const drafted = !selected && hasDraft(drafts, c.id);
    const card = shelf === "pinned" || shelf === "active";
    const renaming = editing === c.id;
    const busy = regenerating.has(c.id);
    const startRename = () => setEditing(c.id);
    const agent = openClawAgentId(c.sessionId);
    const swept = sweepVerb(c.id);
    const verb = dragging && drag ? dropVerb(drag.from, dragTo) : swept;
    const badge = verb ? <DropBadge verb={verb} /> : null;
    const draftPen = drafted ? (
      <HintTooltip label="Unsent draft">
        <SquarePenIcon aria-label="Unsent draft" className={DRAFT_PEN} />
      </HintTooltip>
    ) : null;
    const elsewhere = isElsewhere(c, device) ? (
      <HintTooltip label={`On ${c.device!.name}`}>
        <LaptopIcon
          aria-label={`On ${c.device!.name}`}
          className="ms-auto size-3.5 shrink-0 text-sidebar-muted-foreground/70"
        />
      </HintTooltip>
    ) : null;
    const used = usedTabKinds(c.tabs);
    const meta =
      used.length > 0 ? (
        <span className="mt-0.5 flex h-4 min-w-0 items-center gap-1.5 text-secondary-label">
          <HintTooltip label={tabsSummary(c.tabs)}>
            <span
              role="img"
              aria-label={tabsSummary(c.tabs)}
              className="flex shrink-0 items-center gap-1.5"
            >
              {used.map((kind) => {
                const Icon = TAB_ICONS[kind];
                return <Icon key={kind} aria-hidden className="size-3 shrink-0" />;
              })}
            </span>
          </HintTooltip>
          {elsewhere}
        </span>
      ) : null;
    const title = renaming ? (
      <TitleInput
        title={c.title}
        onDone={(next) => {
          setEditing(null);
          if (next !== null) renameChatAs(c.id, next, titles);
        }}
      />
    ) : (
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          recede ? "font-normal" : "font-medium",
          card
            ? recede
              ? "text-sidebar-foreground/75 group-hover/row:text-sidebar-foreground"
              : "text-sidebar-foreground"
            : cn(
                "group-hover/row:text-sidebar-foreground group-has-focus-visible/row:text-sidebar-foreground",
                recede
                  ? "text-secondary-label"
                  : selected || status?.kind === "input"
                    ? "text-sidebar-foreground"
                    : unread
                      ? "text-sidebar-muted-foreground"
                      : "text-secondary-label/70",
              ),
          busy && "opacity-55",
        )}
      >
        {c.title}
      </span>
    );
    const end =
      shelf === "snoozed" ? (
        <span className="flex items-center gap-1 text-info-foreground">
          <AlarmClockIcon aria-label="Wakes in" className="size-3" />
          {wakesIn(c.snoozedUntil ?? now, now)}
        </span>
      ) : status && look && card ? (
        <span className={cn("flex min-w-0 items-center gap-1 font-medium", look.className)}>
          <look.icon
            aria-hidden
            className={cn(
              "size-3.5 shrink-0",
              status.kind === "working" && "animate-spin [animation-duration:3s]",
            )}
          />
          <span className="sr-only">{status.title}</span>
          <span aria-hidden className="truncate">
            {status.label}
          </span>
        </span>
      ) : (
        shortAgo(shelf === "settled" ? chatSettledAt(c, now) : chatLastMessageAt(c), now)
      );
    const endSlot = renaming ? null : dragging || swept ? (
      badge
    ) : (
      <span
        className={cn(
          "ms-auto flex shrink-0 items-center ps-1 text-xs tabular-nums text-secondary-label",
          ROW_END_HIDES,
        )}
      >
        {end}
      </span>
    );
    const body = card ? (
      <>
        <span className="flex h-5 min-w-0 items-center gap-1.5">
          {draftPen}
          <AgentAvatar id={c.provider} agent={agent} className="size-4 shrink-0" />
          {c.pinnedAt != null && (!dragging || dragTo === "pinned") ? (
            <PinIcon
              aria-label="Pinned"
              className="size-3 shrink-0 text-sidebar-muted-foreground/65"
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate text-xs text-secondary-label">
            {agentName(c.provider, agent)}
          </span>
          {endSlot}
        </span>
        <span className="mt-1 flex min-w-0 items-center gap-1.5">
          {title}
          {meta ? null : elsewhere}
        </span>
        {meta}
      </>
    ) : (
      <>
        <span
          className={cn(
            "flex shrink-0 items-center transition-opacity",
            (!selected || shelf === "settled") &&
              "opacity-40 grayscale group-hover/row:opacity-100 group-hover/row:grayscale-0 group-has-focus-visible/row:opacity-100 group-has-focus-visible/row:grayscale-0",
          )}
        >
          <AgentAvatar id={c.provider} agent={agent} className="size-4" />
        </span>
        {draftPen}
        {title}
        {endSlot}
      </>
    );
    const bodyClass = card
      ? "flex w-full min-w-0 flex-col px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-left outline-none"
      : "flex h-9 w-full min-w-0 items-center gap-2.5 px-(--sidebar-row-content-inset) text-left outline-none";
    const actions =
      renaming || dragging || sweep !== null ? null : (
        <span
          className={cn(
            "absolute end-1.5 hidden items-center gap-0.5 has-data-popup-open:flex",
            card ? "top-1.5" : "inset-y-0 my-auto h-6",
            ROW_ACTION_SHOWS,
          )}
        >
          {drafted && card ? (
            <HintTooltip label="Discard draft" side="bottom">
              <button
                type="button"
                aria-label="Discard draft"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => discardDraft(c.id)}
                className={ROW_ACTION}
              >
                <XIcon className="size-3.5" />
              </button>
            </HintTooltip>
          ) : null}
          {card ? (
            <DropdownMenu>
              <HintTooltip label="Snooze" side="bottom">
                <DropdownMenuTrigger
                  aria-label="Snooze"
                  onPointerDown={(e) => e.stopPropagation()}
                  className={ROW_ACTION}
                >
                  <AlarmClockIcon className="size-3.5" />
                </DropdownMenuTrigger>
              </HintTooltip>
              <DropdownMenuContent align="end">
                {snoozePresets(new Date(now)).map((p) => (
                  <DropdownMenuItem
                    key={p.id}
                    accelerator={p.when}
                    onClick={() => void snoozeChat(c.id, p.until)}
                  >
                    {p.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {card ? (
            <button
              type="button"
              onPointerDown={(e) => startSweep(c.id, "settle", e)}
              onClick={() => void settleChat(c.id)}
              className={ROW_ACTION}
            >
              <CheckIcon className="size-3.5" />
              Settle
            </button>
          ) : (
            <HintTooltip label={shelf === "settled" ? "Unsettle" : "Wake up now"} side="bottom">
              <button
                type="button"
                aria-label={shelf === "settled" ? "Unsettle" : "Wake up now"}
                onPointerDown={(e) =>
                  startSweep(c.id, shelf === "settled" ? "unsettle" : "unsnooze", e)
                }
                onClick={() => void bringBackChat(c.id)}
                className={ROW_ACTION}
              >
                {shelf === "settled" ? (
                  <Undo2Icon className="size-3.5" />
                ) : (
                  <AlarmClockOffIcon className="size-3.5" />
                )}
              </button>
            </HintTooltip>
          )}
        </span>
      );
    return (
      <ChatRowMenu
        chat={c}
        shelf={shelf}
        now={now}
        titles={titles}
        regenerating={busy}
        onOpen={() => onSelect(c.id)}
        onRename={startRename}
        onRegenerate={() => {
          setRegenerating((ids) => new Set(ids).add(c.id));
          void regenerateChatTitle(c.id).finally(() =>
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
            "group/row relative w-full min-w-0 rounded-lg select-none",
            !renaming && "has-focus-visible:ring-2 has-focus-visible:ring-focus-ring",
            dragging
              ? "bg-sidebar-surface bg-linear-to-b from-sidebar-row-active to-sidebar-row-active text-sidebar-foreground shadow-lg margin:shadow-none"
              : selected || swept
                ? "bg-sidebar-row-selected text-sidebar-foreground"
                : drafted
                  ? cn(DRAFT_SURFACE, "text-sidebar-foreground")
                  : "text-sidebar-foreground hover:bg-sidebar-row-hover",
            shelf === "settled" &&
              !selected &&
              !dragging &&
              !swept &&
              "[&:not(:hover):not(:focus-within)_*]:text-secondary-label",
            recede &&
              status?.kind === "working" &&
              !dragging &&
              "opacity-70 hover:opacity-100 focus-within:opacity-100",
          )}
        >
          {renaming ? (
            <div className={bodyClass}>{body}</div>
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
              className={cn(bodyClass, "cursor-pointer")}
            >
              {body}
            </button>
          )}
          {actions}
        </div>
      </ChatRowMenu>
    );
  };

  const resultRow = (result: ChatSearchResult, index: number) => {
    const { chat: c, ranges, match } = result;
    const lit = index === active;
    const selected = c.id === chatId;
    const settled = settledIds.has(c.id);
    return (
      <li key={c.id} ref={lit ? scrollIntoView : undefined} role="presentation" className="py-0.5">
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
            "flex w-full min-w-0 cursor-pointer flex-col rounded-lg px-(--sidebar-row-content-inset) py-(--sidebar-content-inset) text-left outline-none",
            lit || selected
              ? "bg-sidebar-row-selected text-sidebar-foreground"
              : "text-sidebar-muted-foreground hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
          )}
        >
          <span className="flex h-5 min-w-0 items-center gap-1.5 text-xs text-secondary-label">
            <AgentAvatar
              id={c.provider}
              agent={openClawAgentId(c.sessionId)}
              className={cn(
                "size-4 shrink-0",
                settled && !lit && !selected && "opacity-40 grayscale",
              )}
            />
            <span className="truncate">
              {agentName(c.provider, openClawAgentId(c.sessionId))}
              {settled ? " · Settled" : ""}
            </span>
            <span className="ms-auto shrink-0 ps-1 tabular-nums">
              {shortAgo(chatLastMessageAt(c), now)}
            </span>
          </span>
          <span className="mt-1 flex min-w-0 flex-col">
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                !settled || lit || selected
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/70",
              )}
            >
              <Highlighted text={c.title} ranges={ranges} />
            </span>
            {match ? (
              <span className="mt-0.5 truncate text-xs text-secondary-label">
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

  const from = drag?.from ?? null;
  const renderItem = (item: ListItem) => {
    if (item.kind === "chat") {
      const c = chatById.get(item.id)!;
      return (
        <SortableRow
          key={c.id}
          id={c.id}
          disabled={editing === c.id || held !== null}
          className={item.shelf === "pinned" || item.shelf === "active" ? "py-0.5" : undefined}
        >
          {(dragging) => row(c, item.shelf, dragging)}
        </SortableRow>
      );
    }
    switch (item.marker) {
      case "pinned-header":
      case "pinned-divider":
        return (
          <DragBoundary
            key={item.marker}
            marker={item.marker}
            label={item.marker === "pinned-header" ? "Pinned" : "Active"}
            visible={from !== null}
            dropTarget={dragTo === (item.marker === "pinned-header" ? "pinned" : "active")}
          />
        );
      case "active-placeholder":
        return (
          <ShelfPlaceholder
            key={item.marker}
            marker={item.marker}
            label="Active"
            visible={
              from !== null &&
              (shelves.active.length === 0 ||
                (from === "active" &&
                  shelves.active.length === 1 &&
                  dragTo !== null &&
                  dragTo !== "active"))
            }
            dropTarget={dragTo === "active"}
          />
        );
      case "settled-placeholder":
        return (
          <ShelfPlaceholder
            key={item.marker}
            marker={item.marker}
            label="Settled"
            visible={
              from !== null &&
              (settled.length === 0 ||
                (from === "settled" &&
                  settled.length === 1 &&
                  dragTo !== null &&
                  dragTo !== "settled"))
            }
            dropTarget={dragTo === "settled"}
          />
        );
      case "snoozed-header":
        return (
          <ShelfHeader
            key={item.marker}
            marker={item.marker}
            className="mt-auto"
            label="Snoozed"
            count={shelves.snoozed.length}
            open={snoozedOpen}
            onToggle={() => toggleShelf(() => setSnoozedOpen((o) => !o))}
          />
        );
      case "settled-header":
        return (
          <ShelfHeader
            key={item.marker}
            marker={item.marker}
            className={cn(shelves.snoozed.length === 0 && "mt-auto")}
            label="Settled"
            count={shelves.settled.length}
            open={settledOpen}
            onToggle={() => toggleShelf(() => setSettledOpen((o) => !o))}
            dragging={from !== null}
            dropTarget={dragTo === "settled"}
          />
        );
    }
  };

  const empty = newDrafts.length === 0 && noChats;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col pt-(--sidebar-content-inset)">
        <SidebarAction
          icon={<SquarePenIcon />}
          label="New chat"
          selected={onNewChatPage}
          {...PLACE}
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
                  ? `Showing ${agentName(agents.get(filter)!.id, agents.get(filter)!.agent)}'s chats`
                  : "Filter chats by agent"
              }
              side="bottom"
            >
              <DropdownMenuTrigger
                render={
                  <IconButton
                    label="Filter chats by agent"
                    size="icon"
                    className="hover:bg-sidebar-row-hover data-popup-open:bg-sidebar-row-hover"
                  />
                }
              >
                {filter ? (
                  <AgentAvatar
                    id={agents.get(filter)!.id}
                    agent={agents.get(filter)!.agent}
                    className="size-4"
                  />
                ) : (
                  <ListFilterIcon />
                )}
              </DropdownMenuTrigger>
            </HintTooltip>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => pickAgent(null)}>All agents</DropdownMenuItem>
              {agents.size > 0 ? <DropdownMenuSeparator /> : null}
              {[...agents]
                .sort((a, b) => b[1].count - a[1].count)
                .map(([key, { id, agent, count }]) => (
                  <DropdownMenuItem
                    key={key}
                    icon={<AgentAvatar id={id} agent={agent} className="size-4" />}
                    accelerator={String(count)}
                    onClick={() => pickAgent(key)}
                  >
                    {agentName(id, agent)}
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
          <p className="px-(--sidebar-row-content-inset) py-1.5 text-body text-sidebar-muted-foreground">
            {filter ? "No chats match." : "Chats you start show up here."}
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            autoScroll={AUTO_SCROLL}
            collisionDetection={collisionDetection}
            modifiers={modifiers}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={items.map(listItemId)} strategy={sortingStrategy}>
              <ul
                ref={attachList}
                role="presentation"
                className={cn(
                  "relative flex flex-1 flex-col gap-px",
                  sweep !== null && "**:pointer-events-none",
                  // The projected rows extend the scroll range; a range that shrinks as the target
                  // changes would clamp scrollTop and flip the target under a still pointer.
                  drag !== null &&
                    "after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-30 after:h-px after:content-['']",
                )}
              >
                {newDrafts.map(draftRow)}
                {items.map(renderItem)}
                {hiddenSettled > 0 ? (
                  <li className="list-none">
                    <button
                      type="button"
                      onClick={() => toggleShelf(() => setSettledShown((n) => n + SETTLED_PAGE))}
                      className="flex h-9 w-full cursor-pointer items-center rounded-lg px-(--sidebar-row-content-inset) text-left text-sm text-sidebar-muted-foreground outline-none hover:bg-sidebar-row-hover hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      Show {Math.min(hiddenSettled, SETTLED_PAGE)} more
                    </button>
                  </li>
                ) : null}
              </ul>
            </SortableContext>
          </DndContext>
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
  const { active, failing } = scheduledSummary(useScheduledTasks().data ?? []);
  return (
    <div className="flex shrink-0 flex-col px-(--sidebar-content-inset)">
      <button
        type="button"
        onClick={onSelect}
        {...PLACE}
        aria-current={selected ? "page" : undefined}
        className={cn(
          sidebarRowClassName,
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
  const bringBack = () => void bringBackChat(chat.id);
  const pinned = chat.pinnedAt != null;
  return (
    <ContextMenu>
      <ContextMenuTrigger>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => inNewWindow(onOpen)}>Open in New Window</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => void pinChat(chat.id, !pinned)}>
          {pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        {shelf === "snoozed" ? (
          <ContextMenuItem onClick={bringBack}>Wake up now</ContextMenuItem>
        ) : null}
        {shelf === "settled" ? (
          <ContextMenuItem onClick={bringBack}>Unsettle</ContextMenuItem>
        ) : null}
        <ContextMenuSub label={shelf === "snoozed" ? "Snooze until" : "Snooze"}>
          {snoozePresets(new Date(now)).map((p) => (
            <ContextMenuItem
              key={p.id}
              accelerator={p.when}
              onClick={() => void snoozeChat(chat.id, p.until)}
            >
              {p.label}
            </ContextMenuItem>
          ))}
        </ContextMenuSub>
        {shelf === "settled" ? null : (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void settleChat(chat.id)}>Settle</ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename}>Rename</ContextMenuItem>
        {titles && chat.sessionId ? (
          <ContextMenuItem disabled={regenerating} onClick={onRegenerate}>
            {regenerating ? "Regenerating…" : "Regenerate title"}
          </ContextMenuItem>
        ) : null}
      </ContextMenuContent>
    </ContextMenu>
  );
}
