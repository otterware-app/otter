import { useHandlers, useLatest } from "@otter/client/use-latest";
import { ExtensionDialogs } from "./extensions/slots";
import { useWorkspaces, workspaceOf } from "./extensions/workspaces";
import { CALENDAR_SPACE, CHATS_SPACE, workspaceSpace } from "@otter/client/places";
import type { WorkspaceLocation } from "./extensions/types";
import {
  useLayoutEffect,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useMatch, useNavigate, useRouter } from "@tanstack/react-router";
import { placeHref as hrefOf } from "@otter/client/places";
import { ArrowLeftIcon } from "lucide-react";
import { EmptyState } from "@otter/ui/components/empty-state";
import { useQueryClient } from "@tanstack/react-query";
import { toast, type ToastId } from "@otter/ui/components/toast";
import { setDraftOpener } from "./mail/undo-send";
import { AppSidebar, loadModeOrder, orderModes } from "./mail/app-sidebar";
import { SidebarPeekCard, useSidebarPeek } from "./mail/sidebar-peek";
import { ViewEditorDialog } from "./mail/view-editor";
import { MessageList } from "./mail/message-list";
import { MessageReader } from "./mail/message-reader";
import { NewMessageView } from "./mail/new-message-view";
import { CommandPalette } from "./mail/command-palette";
import {
  BrowserPanel,
  BrowserTabStrip,
  closePageRef,
  type FullView,
} from "./browser/browser-panel";
import { OtterCalendarIcon, OtterMailIcon } from "./mail/app-icons";
import { PageHost } from "@otter/browser/ui/page-host";
import { AgentCorner } from "./agent/agent-corner";
import { ChatWindow } from "./agent/chat-window";
import { ChatWorkspace, type ChatPanelControl } from "./agent/chat-workspace";
import { SCHEDULED_TASKS, ScheduledTasksView } from "./agent/agent-scheduled";
import { CALENDAR_MODES, CalendarView, calendarAccounts } from "./calendar/calendar-view";
import { CalendarPanel } from "./calendar/agenda";
import { useCalendar } from "./calendar/calendar-store";
import type { CalendarMode } from "./calendar/dates";
import { settleChat } from "@otter/client/agents/chat-actions";
import {
  isBlank,
  newChat,
  showAgentInAppNotice,
  showChat,
  useChatEvents,
  useChats,
} from "@otter/client/agents/chat-store";
import { useMailChatContext } from "@otter/client/agents/chat-context";
import { useChatProvider } from "@otter/client/agents/agent-providers";
import { SEARCH_MAILBOX } from "@otter/client/mail/gmail-query";
import { searchTabId, searchTitle, type SearchTab } from "./mail/search-tabs";
import {
  PanelControls,
  SidebarControl,
  TitleControls,
  TitleTrailing,
  PanelControlSlot,
  TitlebarInset,
  SidebarTitle,
} from "./mail/top-bar";
import { SettingsPage, type SettingsRoute } from "./settings/settings-page";
import { SettingsNav } from "./settings/settings-nav";
import { isTypingTarget } from "./mail/keyboard";
import { useMailLayout } from "./theme/interface-settings";
import { usePanelAnimationSettings, usePanelPresence } from "./panel-animations";
import {
  keybindingContext,
  useCommandHandlers,
  useKeybindingContext,
  useKeybindingDispatcher,
} from "./keybindings/dispatch";
import { MAILBOX_JUMP_COMMANDS, MODE_JUMP_COMMANDS } from "./keybindings/commands";
import { ShortcutText } from "./keybindings/store";
import {
  useAccounts,
  useAccountSync,
  useGlobalSyncStatus,
  useWriteFailureToasts,
  useExternalMailChanges,
  useModifyMessage,
  useModifyThread,
  useTrashMessage,
  useTrashThread,
  useUntrashThread,
  useUntrashMessage,
} from "@otter/client/mail/hooks";
import { useCalendarChanges } from "./calendar/api";
import {
  beginUndoGroup,
  onUndoableAction,
  quietParams,
  registerRedo,
  takeRedo,
  takeUndo,
  type UndoAction,
} from "@otter/client/mail/undo";
import { getAccountColor, getAccountContrastColor } from "@otter/client/mail/account-style";
import { mailApi } from "@otter/client/mail/api";
import type { QuoteContext } from "@otter/client/agents/chat-context";
import type { MailAccount, MessageSummary, MailView } from "@otter/client/mail/types";
import {
  useMailViews,
  resolveRules,
  loadLastLocation,
  saveLastLocation,
} from "@otter/client/mail/custom-views";
import { ALL_MAIL_LABEL_ID, ARCHIVE_LABEL_ID } from "@otter/client/mail/label-names";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { useMonochromeTheme } from "./theme/apply-theme";
import { features } from "./features";
import { useMailboxes } from "./mailboxes";
import type { AliasMailboxEntry } from "@otter/client/mail/alias-mailboxes";
import {
  modeOf,
  type AppMode,
  NEW_CHAT,
  VIEW_LIST,
  firstLabelOf,
  isViewSpaceId,
  spaceOf,
  spansMailboxes as spanning,
} from "./mail/spaces";
import { useSignInAlerts } from "./mail/sync-health";
import { useRecordRecentlyViewed } from "./recently-viewed";
import { takeNewWindowClick, watchNewWindowClicks } from "./new-window-click";
import { PlaceMenu } from "./place-menu";
import { HistorySwipeNavigation } from "./history-swipe";
import { SetupFlow } from "./onboarding/setup";
import {
  newTab,
  openLink,
  panelTabs,
  selectTab,
  useBrowser,
  useBrowserEvents,
} from "@otter/browser/ui/store";
import { Tour } from "./onboarding/tour";
import {
  endTour,
  getSetupStage,
  markSetUp,
  offerTour,
  useSetupStage,
  useTourRequested,
} from "./onboarding/onboarding";
import { cn } from "@otter/ui/lib/utils";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";
import { type ChatChange } from "@otter/client/agents/api";
import { appApi, type MailtoTarget, type SettingsPane } from "./app-api";

const READER_MIN_WIDTH = 360;
// Auto layout: below this, the reader beside the list is too narrow to read in.
const AUTO_SPLIT_READER_WIDTH = 560;
const BROWSER_OPEN_WIDTH = 720;
const FRAME_INSET = 4;
const IN_EVERY_MAILBOX = new Set(["INBOX", "SENT", "DRAFT", "STARRED", "UNREAD", "SPAM", "TRASH"]);

type MailLoc = {
  mailbox: string;
  label: string;
  messageId: string | null;
  account: string | null;
  focusId: string | null;
};

const sameLoc = (a: MailLoc, b: MailLoc | null) =>
  !!b &&
  a.mailbox === b.mailbox &&
  a.label === b.label &&
  a.messageId === b.messageId &&
  a.account === b.account &&
  a.focusId === b.focusId;

function useRouteMailLoc(): MailLoc | null {
  const mailboxMessage = useMatch({
    from: "/mail/mail/$mailbox/$label/$messageId",
    shouldThrow: false,
  });
  const spaceItem = useMatch({ from: "/mail/$space/$label/$messageId", shouldThrow: false });
  const mailboxList = useMatch({ from: "/mail/mail/$mailbox/$label", shouldThrow: false });
  const spaceList = useMatch({ from: "/mail/$space/$label", shouldThrow: false });
  const message = mailboxMessage ?? spaceItem;
  const list = mailboxList ?? spaceList;
  if (message) {
    const { mailbox, label, messageId } = message.params;
    const { account, message: focusId } = message.search;
    return { mailbox, label, messageId, account: account ?? null, focusId: focusId ?? null };
  }
  if (list) {
    const { mailbox, label } = list.params;
    return { mailbox, label, messageId: null, account: null, focusId: null };
  }
  return null;
}

function savedLoc(): MailLoc {
  const saved = loadLastLocation();
  const [mailbox, label] = saved ? [saved.accountId, saved.labelId] : ["", "INBOX"];
  return { mailbox, label, messageId: null, account: null, focusId: null };
}

function placeFor(
  loc: MailLoc,
  accounts: MailAccount[],
  aliases: AliasMailboxEntry[],
  views: MailView[] | null,
): MailLoc {
  const there =
    views === null && isViewSpaceId(loc.mailbox)
      ? true
      : spaceOf(loc.mailbox, { accounts, views: views ?? [], aliases }) !== null;
  if (there) return loc;
  const mailbox = accounts[0]?.id ?? loc.mailbox;
  return { mailbox, label: firstLabelOf(mailbox), messageId: null, account: null, focusId: null };
}

function useRouteSettings(): SettingsRoute | null {
  const paneMatch = useMatch({ from: "/mail/settings/$pane", shouldThrow: false });
  const itemMatch = useMatch({ from: "/mail/settings/$pane/$item", shouldThrow: false });
  const pane = itemMatch?.params.pane ?? paneMatch?.params.pane;
  const item = itemMatch?.params.item;
  const target = (itemMatch ?? paneMatch)?.search.target;
  return useMemo(() => (pane ? { pane, item, target } : null), [pane, item, target]);
}

function onWindowResize(listener: () => void): () => void {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
}

/**
 * Drag-resizable pane width persisted to localStorage. `room` (when given)
 * caps it so neighbouring panes keep their minimum: at drag start, and as
 * the window shrinks (the stored width comes back when it grows).
 */
function useStoredWidth(
  key: string,
  def: number,
  min: number,
  max: number,
  dir: 1 | -1 = 1,
  room?: () => number,
  cssVar?: string,
  onDrag?: (width: number | null) => void,
) {
  const [width, setWidth] = useState(() => {
    const saved = Number(localStorage.getItem(key));
    return Number.isFinite(saved) && saved >= min && saved <= max ? saved : def;
  });
  const shown = useSyncExternalStore(onWindowResize, () =>
    room ? Math.min(width, Math.max(min, room())) : width,
  );
  const widthRef = useLatest(shown);
  useLayoutEffect(() => {
    if (cssVar) document.documentElement.style.setProperty(cssVar, `${shown}px`);
  }, [cssVar, shown]);
  const paneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ cleanup: () => void; finish: () => void } | null>(null);
  useEffect(() => () => dragRef.current?.cleanup(), []);

  const start = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current?.finish();
    e.preventDefault();
    const handle = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startW = widthRef.current;
    const cap = Math.max(min, Math.min(max, room ? room() : max));
    let latest = startW;
    let raf = 0;
    let finished = false;
    // Browser guests and message iframes must not swallow the release.
    const cover = document.createElement("div");
    cover.className = "no-drag fixed inset-0 z-[200] touch-none select-none cursor-col-resize";
    document.body.append(cover);
    const apply = () => {
      raf = 0;
      if (paneRef.current) paneRef.current.style.width = `${latest}px`;
      if (frameRef.current) frameRef.current.style.width = `${latest}px`;
      if (cssVar) document.documentElement.style.setProperty(cssVar, `${latest}px`);
      onDrag?.(latest);
    };
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!(ev.buttons & 1)) {
        finish();
        return;
      }
      latest = Math.min(cap, Math.max(min, startW + dir * (ev.clientX - startX)));
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const cleanup = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("blur", finish);
      handle.removeEventListener("lostpointercapture", finish);
      if (raf) cancelAnimationFrame(raf);
      cover.remove();
      if (frameRef.current) frameRef.current.style.transitionProperty = "";
      dragRef.current = null;
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    const finish = () => {
      if (finished) return;
      cleanup();
      apply();
      widthRef.current = latest;
      setWidth(latest);
      onDrag?.(null);
      localStorage.setItem(key, String(latest));
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };
    dragRef.current = { cleanup, finish };
    if (frameRef.current) frameRef.current.style.transitionProperty = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("blur", finish);
    handle.addEventListener("lostpointercapture", finish);
    handle.setPointerCapture(pointerId);
  };

  const widen = useCallback(
    (to: number) => setWidth((w) => Math.max(w, Math.min(max, Math.max(min, to)))),
    [min, max],
  );

  return { width: shown, start, widen, paneRef, frameRef };
}

type PaneWidths = { sidebar: number; list: number; browser: number; calendar: number };

function PaneResizer({
  onPointerDown,
  joined,
}: {
  onPointerDown: (e: ReactPointerEvent) => void;
  /** Between the panes of one panel: its line is the panel's, below the titlebar. */
  joined?: boolean;
}) {
  return (
    <div className="relative z-20 w-0 shrink-0" aria-hidden>
      <div
        onPointerDown={onPointerDown}
        className={cn(
          "no-drag group absolute inset-y-0 -left-1 flex w-1 cursor-col-resize justify-center",
          joined && "top-(--workspace-card-top) -left-[2.5px]",
        )}
      >
        <div className="w-px group-hover:bg-input" />
      </div>
    </div>
  );
}

// Left to CSS (the root's data attributes) and made once: the list then keeps its props, and
// skips re-rendering, when the sidebar or a panel opening flips the layout.
const LIST_LEADING = (
  <span className="contents [[data-sidebar-open=true]_&]:hidden">
    <TitlebarInset />
  </span>
);
const LIST_TRAILING = (
  <span className="hidden [[data-mail-layout=full][data-right-panels=none]_&]:contents">
    <PanelControlSlot />
  </span>
);

const PANE = "min-h-0 overflow-hidden";
const CARD = `${PANE} relative pr-1 before:pointer-events-none before:absolute before:left-0 before:right-1 before:bottom-0 before:top-(--workspace-card-top) before:-z-10 before:rounded-xl after:pointer-events-none after:absolute after:left-0 after:right-1 after:bottom-0 after:top-(--workspace-card-top) after:z-30 after:rounded-xl after:border after:border-(--panel-edge) dark:after:border-[0.5px]`;
const PANE_SIDEBAR = `${PANE} relative text-sidebar-foreground`;
const PANE_LIST = `${CARD} before:bg-canvas`;
const PANE_MAIN = PANE_LIST;
const PANE_BROWSER = PANE_LIST;
// The list and the reader side by side are one panel (Linear's): the list's edge is the
// line between them. The browser stays a card of its own.
const JOINED_LIST = "pr-0 before:right-0 after:right-0 before:rounded-r-none after:rounded-r-none";
const JOINED_MAIN =
  "before:rounded-l-none after:rounded-l-none after:border-l-0 dark:after:border-l-0";
const PANE_FRAME =
  "flex min-h-0 shrink-0 overflow-hidden [[data-panel-animations=true]_&]:transition-[width] [[data-panel-animations=true]_&]:[transition-duration:var(--panel-animation-duration)] [[data-panel-animations=true]_&]:ease-out";

/** The same object until the view or the mailboxes change, so the list's rows can skip
 *  re-rendering. */
function useCombined(view: MailView | null, accounts: MailAccount[]) {
  return useMemo(
    () => (view ? { viewId: view.id, name: view.name, rules: resolveRules(view, accounts) } : null),
    [view, accounts],
  );
}

/** Settled or snoozed: the small window opens on a new chat instead. */
function activeChatShelved(): boolean {
  const { activeId, conversations } = useChats.getState();
  const active = conversations.find((c) => c.id === activeId);
  return !!active && (active.settledAt != null || (active.snoozedUntil ?? 0) > Date.now());
}

export function HomeView() {
  const accountsQuery = useAccounts();
  const stage = useSetupStage();
  const loaded = !accountsQuery.isLoading;
  if (loaded && ((accountsQuery.data ?? []).length === 0 || stage === "setup")) {
    return <SetupFlow />;
  }
  return <MailHome />;
}

function MailHome() {
  const navigate = useNavigate();
  const router = useRouter();
  const routeLoc = useRouteMailLoc();
  const settingsRoute = useRouteSettings();

  const accountsQuery = useAccounts();
  const { views, loaded: viewsLoaded, saveView, deleteView } = useMailViews();

  const mailboxes = useMailboxes();
  const accounts = mailboxes.accounts;
  const aliases = mailboxes.aliases;
  const accountIds = accounts.map((a) => a.id);
  const firstRealAccountId = accounts[0]?.id ?? null;
  const ready = !accountsQuery.isLoading && accounts.length > 0;

  const [lastMail, setLastMail] = useState<MailLoc | null>(null);
  if (routeLoc && !sameLoc(routeLoc, lastMail)) setLastMail(routeLoc);
  // Where the route names no place in the mail (the index route, or a window
  // that started in Settings), it's where it was last time. Once the
  // mailboxes are known, it's always one of theirs (effects below catch the
  // route up), so nothing shows a place only to leave it at once.
  const placed = routeLoc ?? lastMail;
  const where = ready
    ? placeFor(placed ?? savedLoc(), accounts, aliases, viewsLoaded ? views : null)
    : placed;
  // Rebuilt from its fields, so it keeps its identity (and so does every handler built on it)
  // until the place changes: a pane toggling then doesn't re-render the list and reader.
  const mailLoc = where && {
    mailbox: where.mailbox,
    label: where.label,
    messageId: where.messageId,
    account: where.account,
    focusId: where.focusId,
  };
  const initialized = ready && mailLoc !== null;
  const selectedAccountId = mailLoc?.mailbox ?? null;
  const selectedLabelId = mailLoc?.label ?? "INBOX";
  // A workspace's item (a document) is its own, never a message the mail would load.
  const inWorkspace = workspaceOf(selectedAccountId) !== undefined;
  // Agents' only item is a scheduled task (/agents/scheduled/<task>), never a message.
  const selectedMessageId =
    inWorkspace || selectedAccountId === CHATS_SPACE ? null : (mailLoc?.messageId ?? null);
  const workspaceItem = inWorkspace ? (mailLoc?.messageId ?? null) : null;
  const readerAccountId = mailLoc?.account ?? null;
  const focusedMessageId = mailLoc?.focusId ?? null;
  const [autoFocusDraft, setAutoFocusDraft] = useState(true);
  const [searchTabs, setSearchTabs] = useState<SearchTab[]>([]);
  const [activeSearchId, setActiveSearchId] = useState<string | null>(null);
  const composeOpen = useMatch({ from: "/mail/compose", shouldThrow: false }) !== undefined;
  const [viewEditor, setViewEditor] = useState<string | null>(null);
  // What the new message starts with (a mailto: link from the OS, an address
  // from the reader). The seq keys NewMessageView so one arriving while the
  // composer is open re-seeds it.
  const [mailtoPrefill, setMailtoPrefill] = useState<MailtoTarget | null>(null);
  const [mailtoSeq, setMailtoSeq] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const lastPaneRef = useRef<SettingsPane>("general");
  useLayoutEffect(() => {
    if (settingsRoute) lastPaneRef.current = settingsRoute.pane;
  });
  const openSettings = useCallback(
    (route: SettingsRoute) => {
      const replace =
        !!settingsRoute && route.pane === settingsRoute.pane && route.item === settingsRoute.item;
      void (route.item
        ? navigate({
            to: "/settings/$pane/$item",
            params: { pane: route.pane, item: route.item },
            search: { target: route.target },
            replace,
          })
        : navigate({
            to: "/settings/$pane",
            params: { pane: route.pane },
            search: { target: route.target },
            replace,
          }));
    },
    [navigate, settingsRoute],
  );
  const openSettingsRef = useLatest(openSettings);
  useEffect(() => {
    const pull = () =>
      Promise.resolve()
        .then(() => appApi.getSettingsTarget())
        .then((target) => {
          if (!target) return;
          const pane = target.pane ?? lastPaneRef.current;
          console.log("[HomeView:openSettings]", { pane, item: target.item });
          openSettingsRef.current({ pane, item: target.item });
        })
        .catch((error: unknown) => {
          console.log("[HomeView:getSettingsTarget] failed", { error: String(error) });
        });
    void pull();
    return window.desktopBridge.on("settings:open", () => void pull());
  }, [openSettingsRef]);

  const closeBrowserTabRef = useRef<(() => boolean) | null>(null);
  const closeWorkspaceTabRef = useRef<(() => boolean) | null>(null);
  const chatPanelRef = useRef<ChatPanelControl | null>(null);
  const [chatPanelOpen, setChatPanelOpen] = useState(false);
  const closeChatWindowRef = useRef<() => boolean>(() => false);
  useEffect(
    () =>
      window.desktopBridge.on("window:closeRequest", () => {
        if (closeBrowserTabRef.current?.()) return;
        if (closeWorkspaceTabRef.current?.()) return;
        if (closeChatWindowRef.current()) return;
        void appApi.closeMainWindow();
      }),
    [],
  );

  const go = (to: Partial<MailLoc>, replace = false) => {
    if (!mailLoc) return;
    const next = { ...mailLoc, ...to };
    const href = hrefOf(next.mailbox, next.label, next.messageId, {
      account: next.account && next.account !== next.mailbox ? next.account : undefined,
      message: next.focusId ?? undefined,
    });
    void navigate({ href, replace });
  };
  const closeMessage = () => go({ messageId: null });
  const correct = (to: Partial<MailLoc>) => {
    if (routeLoc) go(to, true);
    else if (lastMail) setLastMail({ ...lastMail, ...to });
  };

  const leaveSettings = () => {
    if (mailLoc) go({});
    else void navigate({ to: "/" });
  };
  const openCompose = (prefill: MailtoTarget | null = null) => {
    if (composeOpen && !prefill) return;
    setMailtoPrefill(prefill);
    if (prefill) setMailtoSeq((n) => n + 1);
    if (!composeOpen) void navigate({ to: "/compose" });
  };
  const settingsRouteRef = useLatest(settingsRoute);
  const leaveSettingsRef = useLatest(leaveSettings);
  const composeOpenRef = useLatest(composeOpen);
  const openComposeRef = useLatest(openCompose);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !settingsRouteRef.current) return;
      if (isTypingTarget(e)) {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      e.preventDefault();
      leaveSettingsRef.current();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [leaveSettingsRef, settingsRouteRef]);

  const space = selectedAccountId ? spaceOf(selectedAccountId, { accounts, views, aliases }) : null;
  const aliasSpace = space?.kind === "alias" ? space.alias : null;
  const isChats = space?.kind === "chats";
  const isCalendar = space?.kind === "calendar";
  const workspace = space?.kind === "workspace" ? workspaceOf(space.id) : undefined;
  // Turning one off re-reads where we are (spaceOf drops it).
  const workspaces = useWorkspaces();
  const ownsMain = isChats || isCalendar || workspace !== undefined;
  const mailLayoutSetting = useMailLayout();
  const viewSpace = space?.kind === "view" ? space.view : null;
  const spansMailboxes = spanning(space);

  const globalSync = useGlobalSyncStatus(accountIds);
  useWriteFailureToasts();
  useSignInAlerts();
  useExternalMailChanges();
  useCalendarChanges();
  useBrowserEvents();
  useEffect(() => {
    const unwatch = watchNewWindowClicks();
    const unblock = router.history.block({
      blockerFn: ({ nextLocation }) => {
        if (!takeNewWindowClick()) return false;
        void appApi.openWindow(nextLocation.href);
        return true;
      },
      enableBeforeUnload: false,
    });
    return () => {
      unwatch();
      unblock();
    };
  }, [router]);
  useChatEvents();

  // Panes resize outside React while dragged; this re-renders only when Auto's choice flips.
  const [dragSplit, setDragSplit] = useState<boolean | null>(null);
  const splitFitsRef = useRef<(dragged: Partial<PaneWidths>) => boolean>(() => true);
  const dragAutoLayout = (pane: keyof PaneWidths, width: number | null) =>
    setDragSplit(width === null ? null : splitFitsRef.current({ [pane]: width }));
  const {
    width: sidebarWidth,
    start: sidebarStart,
    paneRef: sidebarPaneRef,
    frameRef: sidebarFrameRef,
  } = useStoredWidth(
    "gmail:pane:sidebar",
    240,
    180,
    400,
    1,
    undefined,
    "--workspace-sidebar-width",
    (width) => dragAutoLayout("sidebar", width),
  );
  const {
    width: listWidth,
    start: listStart,
    paneRef: listPaneRef,
  } = useStoredWidth("gmail:pane:list", 380, 280, 640, 1, undefined, undefined, (width) =>
    dragAutoLayout("list", width),
  );
  const [browserOpen, setBrowserOpen] = useState(
    () => features.browser && localStorage.getItem("gmail:browser-open") === "1",
  );
  const [browserFull, setBrowserFull] = useState(
    () => localStorage.getItem("gmail:browser-full") === "1",
  );
  const [calendarPanelOpen, setCalendarPanelOpen] = useState(
    () => localStorage.getItem("gmail:calendar-panel-open") === "1",
  );
  const [chatWindowOpen, setChatWindowOpen] = useState(
    () => localStorage.getItem("gmail:chat-window-open") === "1",
  );
  const [mailSidebarOpen, setMailSidebarOpen] = useState(
    () => localStorage.getItem("gmail:sidebar-open") !== "0",
  );
  const [settingsSidebarOpen, setSettingsSidebarOpen] = useState(
    () => localStorage.getItem("gmail:settings-sidebar-open") !== "0",
  );
  const sidebarOpen = settingsRoute ? settingsSidebarOpen : mailSidebarOpen;
  const hasCalendars = calendarAccounts(accounts).length > 0;
  const calendarPanelVisible = calendarPanelOpen && hasCalendars && !settingsRoute && !isChats;
  const {
    width: calendarPanelWidth,
    start: calendarPanelStart,
    paneRef: calendarPanelPaneRef,
    frameRef: calendarPanelFrameRef,
  } = useStoredWidth(
    "gmail:pane:calendar",
    260,
    220,
    480,
    -1,
    () => window.innerWidth - FRAME_INSET - (sidebarOpen ? sidebarWidth : 0) - READER_MIN_WIDTH,
    undefined,
    (width) => dragAutoLayout("calendar", width),
  );
  const browserRoomBeside = (list: boolean) =>
    window.innerWidth -
    FRAME_INSET -
    (sidebarOpen ? sidebarWidth : 0) -
    (calendarPanelVisible ? calendarPanelWidth : 0) -
    (list && !ownsMain ? listWidth : 0) -
    READER_MIN_WIDTH;
  // Dragged, it may take the list's room unless the layout is Split view: Auto then gives
  // way to Full inbox.
  const browserRoom = () => browserRoomBeside(mailLayoutSetting === "split");
  const {
    width: browserWidth,
    start: browserStart,
    widen: widenBrowser,
    paneRef: browserPaneRef,
    frameRef: browserFrameRef,
  } = useStoredWidth("gmail:pane:browser", 340, 280, 2400, -1, browserRoom, undefined, (width) =>
    dragAutoLayout("browser", width),
  );
  const { active: panelAnimationsActive, durationMs: panelAnimationDurationMs } =
    usePanelAnimationSettings(settingsRoute ? "settings" : "mail");
  const browserVisible = browserOpen && !settingsRoute && !isChats;
  const fullView = browserFull && browserVisible;
  // In full view the mode (Mail…) is a tab beside the pages: shown alone, as they are.
  // Shown until a page is revealed (a link opened): as of which reveal, then.
  const revealed = useBrowser((s) => s.revealed);
  const [homeAt, setHomeAt] = useState<number | null>(null);
  const homeShown = fullView && homeAt === revealed;
  const windowWidth = useSyncExternalStore(onWindowResize, () => window.innerWidth);
  const splitFits = ({ sidebar, list, browser, calendar }: PaneWidths) =>
    windowWidth -
      FRAME_INSET -
      (sidebarOpen ? sidebar : 0) -
      list -
      (browserVisible ? browser : 0) -
      (calendarPanelVisible ? calendar : 0) >=
    AUTO_SPLIT_READER_WIDTH;
  const paneWidths = {
    sidebar: sidebarWidth,
    list: listWidth,
    browser: browserWidth,
    calendar: calendarPanelWidth,
  };
  useLayoutEffect(() => {
    splitFitsRef.current = (dragged) => splitFits({ ...paneWidths, ...dragged });
  });
  const mailLayout =
    mailLayoutSetting !== "auto"
      ? mailLayoutSetting
      : (dragSplit ?? splitFits(paneWidths))
        ? "split"
        : "full";
  const fullInbox = mailLayout === "full" && !ownsMain;
  const browserPresent = usePanelPresence(
    browserVisible,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const calendarPanelPresent = usePanelPresence(
    calendarPanelVisible,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  // Pages need room: the panel opens wide, as far as the reader allows (narrower by hand).
  const openRoomRef = useLatest(() => browserRoomBeside(mailLayoutSetting !== "full"));
  useEffect(() => {
    if (browserVisible) widenBrowser(Math.min(BROWSER_OPEN_WIDTH, openRoomRef.current()));
  }, [browserVisible, widenBrowser, openRoomRef]);
  const toggleSidebar = () => {
    const [key, setOpen] = settingsRoute
      ? ["gmail:settings-sidebar-open", setSettingsSidebarOpen]
      : ["gmail:sidebar-open", setMailSidebarOpen];
    setOpen((open) => {
      localStorage.setItem(key, open ? "0" : "1");
      return !open;
    });
  };
  const [chatSelection, setChatSelection] = useState<MessageSummary[]>([]);
  const openBrowser = () => {
    localStorage.setItem("gmail:browser-open", "1");
    setBrowserOpen(true);
  };
  const setFullView = (full: boolean) => {
    localStorage.setItem("gmail:browser-full", full ? "1" : "0");
    setBrowserFull(full);
    setHomeAt(null);
  };
  const closeBrowser = () => {
    localStorage.setItem("gmail:browser-open", "0");
    setBrowserOpen(false);
    setFullView(false);
  };
  const toggleBrowser = () => {
    if (!features.browser) return false;
    if (isChats) {
      if (!chatPanelRef.current) return false;
      chatPanelRef.current.toggle();
      return;
    }
    if (browserVisible) {
      closeBrowser();
      return;
    }
    if (settingsRouteRef.current) leaveSettingsRef.current();
    const browser = useBrowser.getState();
    const pages = panelTabs(browser.tabs);
    if (!pages.some((tab) => tab.id === browser.activeId)) {
      const page = pages.at(-1);
      if (page) selectTab(page.id);
      else newTab();
    }
    openBrowser();
  };
  const toggleCalendarPanel = () => {
    if (!hasCalendars) return false;
    if (settingsRouteRef.current) leaveSettingsRef.current();
    if (isChats) leaveWorkspace();
    const open = !calendarPanelVisible;
    localStorage.setItem("gmail:calendar-panel-open", open ? "1" : "0");
    setCalendarPanelOpen(open);
  };
  const browserRevealed = useBrowser((s) => s.revealed);
  const openBrowserForEffect = useLatest(openBrowser);
  useEffect(() => {
    if (!browserRevealed) return;
    if (settingsRouteRef.current) leaveSettingsRef.current();
    openBrowserForEffect.current();
  }, [browserRevealed, leaveSettingsRef, openBrowserForEffect, settingsRouteRef]);

  const [pendingQuote, setPendingQuote] = useState<QuoteContext | null>(null);
  const setChatWindow = (open: boolean) => {
    localStorage.setItem("gmail:chat-window-open", open ? "1" : "0");
    setChatWindowOpen(open);
    if (!open) setPendingQuote(null);
  };
  const openChat = () => {
    if (settingsRouteRef.current) leaveSettingsRef.current();
    if (isChats) leaveWorkspace();
    if (activeChatShelved()) newChat(selectedKind);
    setChatWindow(true);
  };
  const chatWindowShown = chatWindowOpen && !isChats && !settingsRoute;
  const settingsSidebarPresent = usePanelPresence(
    sidebarOpen,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const chatWindowPresent = usePanelPresence(
    chatWindowShown,
    panelAnimationsActive,
    panelAnimationDurationMs,
  );
  const agentCornerShown = !isChats || settingsRoute;
  const closeChat = () => setChatWindow(false);
  useLayoutEffect(() => {
    closeChatWindowRef.current = () => {
      if (!chatWindowShown) return false;
      closeChat();
      return true;
    };
  });
  const toggleChat = () => {
    if (isChats && !settingsRoute) return false;
    if (chatWindowOpen && !settingsRoute) setChatWindow(false);
    else openChat();
  };
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const selectedKind = useChatProvider(undefined).selectedId ?? "";
  const activeChatId = useChats((s) => s.activeId);
  const mailBeforeChats = useRef<MailLoc | null>(null);
  const lastCalendarMode = useRef<string>("week");
  const lastInWorkspace = useRef(new Map<string, WorkspaceLocation>());
  useEffect(() => {
    if (mailLoc && !ownsMain) mailBeforeChats.current = mailLoc;
    if (isCalendar && CALENDAR_MODES.some((m) => m.mode === selectedLabelId))
      lastCalendarMode.current = selectedLabelId;
    if (workspace)
      lastInWorkspace.current.set(workspace.id, {
        location: selectedLabelId,
        item: workspaceItem,
      });
  });
  const goInWorkspace = (to: Partial<WorkspaceLocation>, replace = false) =>
    go(
      {
        label: to.location ?? selectedLabelId,
        messageId: to.item ?? null,
        account: null,
        focusId: null,
      },
      replace,
    );
  const openWorkspace = (chatId: string) => {
    setChatWindow(false);
    showChat(chatId);
    go({ mailbox: CHATS_SPACE, label: chatId, messageId: null, account: null, focusId: null });
  };
  const openWorkspaceRef = useLatest(openWorkspace);
  useEffect(() => {
    const offOpen = window.desktopBridge.on("agent:openChat", (id: unknown) => {
      if (typeof id === "string") openWorkspaceRef.current(id);
    });
    const offNotice = window.desktopBridge.on("agent:inAppNotice", (raw: unknown) => {
      const notice = raw as Parameters<typeof showAgentInAppNotice>[0] | null;
      if (notice?.id && notice.title) showAgentInAppNotice(notice, openWorkspaceRef.current);
    });
    return () => {
      offOpen();
      offNotice();
    };
  }, [openWorkspaceRef]);
  const leaveWorkspace = () => {
    const back = mailBeforeChats.current;
    if (back && modeOf(back.mailbox) === "mail") go({ ...back, messageId: null });
    else if (firstRealAccountId) handleSelectAccount(firstRealAccountId);
  };
  const mode: AppMode = composeOpen ? "mail" : modeOf(space?.id ?? null);
  const switchMode = (next: AppMode) => {
    sidebarPeek.close();
    if (next === mode && !settingsRoute) return;
    if (next === "mail") {
      if (composeOpen || (settingsRoute && mode === "mail")) leaveSettings();
      else leaveWorkspace();
    } else if (next === "calendar") {
      go({
        mailbox: CALENDAR_SPACE,
        label: lastCalendarMode.current,
        messageId: null,
        account: null,
        focusId: null,
      });
    } else if (next.startsWith("workspace:")) {
      const id = next.slice("workspace:".length);
      const last = lastInWorkspace.current.get(id);
      go({
        mailbox: workspaceSpace(id),
        label: last?.location ?? firstLabelOf(workspaceSpace(id)),
        messageId: last?.item ?? null,
        account: null,
        focusId: null,
      });
    } else {
      openWorkspace(activeChatId);
    }
  };
  const showNewChat = useLatest(() => go({ label: newChat(selectedKind) }, true));
  const chatsLabel = isChats ? selectedLabelId : null;
  useEffect(() => {
    if (chatsLabel === NEW_CHAT) showNewChat.current();
    else if (chatsLabel && chatsLabel !== SCHEDULED_TASKS) showChat(chatsLabel);
  }, [chatsLabel, showNewChat]);
  const startNewChat = () => {
    if (isChats && !settingsRoute) {
      go({ label: newChat(selectedKind) });
      return;
    }
    newChat(selectedKind);
    openChat();
    requestAnimationFrame(() => chatInputRef.current?.focus());
  };
  useEffect(() => {
    if (accountsQuery.isLoading || accounts.length === 0 || getSetupStage()) return;
    markSetUp();
    offerTour();
  }, [accountsQuery.isLoading, accounts.length]);
  const tourRequested = useTourRequested();
  useEffect(() => {
    if (!tourRequested) return;
    if (settingsRouteRef.current || composeOpenRef.current) leaveSettingsRef.current();
    localStorage.setItem("gmail:sidebar-open", "1");
    // oxlint-disable-next-line react/set-state-in-effect -- The tour asks for the sidebar.
    setMailSidebarOpen(true);
  }, [tourRequested, leaveSettingsRef, settingsRouteRef, composeOpenRef]);

  const advanceRef = useRef<(fromMessageId: string) => boolean>(() => false);
  const handleReaderAdvance = () => {
    if (!selectedMessageId || !advanceRef.current(selectedMessageId)) closeMessage();
  };

  const searchRef = useRef<HTMLInputElement>(null);

  const accountSwitchRef = useRef<{
    ids: string[];
    select: (id: string) => void;
  }>({ ids: [], select: () => {} });

  const undoModifyMessage = useModifyMessage();
  const undoModifyThread = useModifyThread();
  const undoUntrashThread = useUntrashThread();
  const undoUntrashMessage = useUntrashMessage();
  const redoTrashThread = useTrashThread();
  const redoTrashMessage = useTrashMessage();
  const undoRunner = useRef<(action: UndoAction) => void>(() => {});
  const redoRunner = useRef<() => boolean>(() => false);
  // An undo runs quietly (quietParams: no undo or toast of its own). A redo is
  // the action again: it registers its undo and shows its toast, so a bulk
  // redo regroups to announce itself once.
  const runAction = (action: UndoAction, quiet: boolean): Promise<unknown> => {
    const params = <T extends object>(p: T) => (quiet ? quietParams(p) : p);
    switch (action.kind) {
      case "modifyMessage":
        return undoModifyMessage.mutateAsync(params(action.params));
      case "modifyThread":
        return undoModifyThread.mutateAsync(params(action.params));
      case "untrashThread":
        return undoUntrashThread.mutateAsync(params(action.params));
      case "untrashMessage":
        return undoUntrashMessage.mutateAsync(params(action.params));
      case "trashThread":
        return redoTrashThread.mutateAsync(params(action.params));
      case "trashMessage":
        return redoTrashMessage.mutateAsync(params(action.params));
      case "callback":
        action.run();
        return Promise.resolve();
      case "batch":
        if (!quiet) beginUndoGroup(action.actions.length);
        return Promise.all(action.actions.map((a) => runAction(a, quiet)));
    }
  };
  useEffect(() => {
    const onEdit = (native: "edit:nativeUndo" | "edit:nativeRedo", run: () => void) => () => {
      const context = keybindingContext();
      if (context.editableFocus) {
        void window.desktopBridge.invoke(native);
        return;
      }
      if (context.dialogOpen) return;
      run();
    };
    const offUndo = window.desktopBridge.on(
      "edit:undo",
      onEdit("edit:nativeUndo", () => {
        const action = takeUndo();
        if (action) undoRunner.current(action);
      }),
    );
    const offRedo = window.desktopBridge.on(
      "edit:redo",
      onEdit("edit:nativeRedo", () => redoRunner.current()),
    );
    return () => {
      offUndo();
      offRedo();
    };
  }, []);
  const actionToasts = useRef(new Map<UndoAction, ToastId>());
  useLayoutEffect(() => {
    undoRunner.current = (action) => {
      console.log("[HomeView:undo]", {
        kind: action.kind,
        count: action.kind === "batch" ? action.actions.length : 1,
      });
      const toastId = actionToasts.current.get(action);
      if (toastId) toast.close(toastId);
      actionToasts.current.delete(action);
      runAction(action, true).then(
        () => {
          registerRedo(action);
          if (action.kind !== "callback") toast.success("Undone");
        },
        () => toast.error("Could not undo"),
      );
    };
  });
  useLayoutEffect(() => {
    redoRunner.current = () => {
      const action = takeRedo();
      if (!action) return false;
      console.log("[HomeView:redo]", {
        kind: action.kind,
        count: action.kind === "batch" ? action.actions.length : 1,
      });
      runAction(action, false).catch(() => toast.error("Could not redo"));
      return true;
    };
  });
  useEffect(
    () =>
      onUndoableAction((title, action) => {
        const toastId = toast.success(title, {
          action: {
            label: "Undo",
            onClick: () => {
              if (!takeUndo(action)) {
                actionToasts.current.delete(action);
                toast.info("That can no longer be undone");
                return;
              }
              undoRunner.current(action);
            },
          },
          onRemove: () => actionToasts.current.delete(action),
        });
        actionToasts.current.set(action, toastId);
      }),
    [],
  );

  useKeybindingDispatcher();
  useKeybindingContext("settingsOpen", settingsRoute !== null);
  useKeybindingContext("workspaceOpen", ownsMain && !settingsRoute);
  useKeybindingContext("agentOpen", !settingsRoute && (isChats || chatWindowOpen));
  useKeybindingContext("messageOpen", selectedMessageId !== null);
  const goTo = (labelId: string | ((account: MailAccount) => string)) => {
    const mailbox = isChats || viewSpace ? firstRealAccountId : selectedAccountId;
    const account = aliasSpace?.parent ?? accounts.find((a) => a.id === mailbox);
    if (!account) return;
    go({
      mailbox: aliasSpace?.id ?? account.id,
      label: typeof labelId === "string" ? labelId : labelId(account),
      messageId: null,
    });
  };
  const jumpToMode = (index: number) => {
    const modes: { mode: AppMode }[] = [
      { mode: "mail" },
      { mode: "calendar" },
      ...workspaces.map((w) => ({ mode: `workspace:${w.id}` as const })),
      { mode: "agent" },
    ];
    const target = orderModes(modes, loadModeOrder())[index];
    if (!target) return false;
    switchMode(target.mode);
  };
  const jumpToMailbox = (digit: number) => {
    const { ids, select } = accountSwitchRef.current;
    const target = ids[digit - 1];
    if (!target) return false;
    select(target);
  };
  useCommandHandlers({
    "commandPalette.toggle": () => setPaletteOpen((o) => !o),
    "sidebar.toggle": () => toggleSidebar(),
    "agent.toggle": () => toggleChat(),
    "agent.openWorkspace": () => {
      if (settingsRouteRef.current) leaveSettingsRef.current();
      if (isChats) leaveWorkspace();
      else openWorkspace(activeChatId);
    },
    "agent.newChat": () => startNewChat(),
    "agent.settle": () => {
      const chat = useChats.getState().conversations.find((c) => c.id === activeChatId);
      if (!chat || isBlank(chat)) return false;
      void settleChat(chat.id);
      if (isChats) go({ label: newChat(selectedKind) });
      else closeChat();
    },
    "browser.toggle": () => toggleBrowser(),
    "browser.fullView": () => {
      if (!features.browser || isChats) return false;
      if (!browserVisible) toggleBrowser();
      setFullView(!fullView);
    },
    "calendar.togglePanel": () => toggleCalendarPanel(),
    "browser.newTab": () => {
      if (!features.browser) return false;
      if (isChats) {
        if (!chatPanelRef.current) return false;
        chatPanelRef.current.newPage();
        return;
      }
      newTab();
    },
    "search.focus": () => searchFromView(),
    "compose.new": () => openCompose(),
    "keybindings.show": () => openSettings({ pane: "keybindings" }),
    "mail.undo": () => {
      const action = takeUndo();
      if (!action) return false;
      undoRunner.current(action);
    },
    "mail.redo": () => redoRunner.current(),
    "go.inbox": () => goTo("INBOX"),
    "go.sent": () => goTo("SENT"),
    "go.starred": () => goTo("STARRED"),
    "go.drafts": () => goTo("DRAFT"),
    "go.allMail": () =>
      goTo((account) =>
        capabilitiesOf(account).archiveFolder ? ARCHIVE_LABEL_ID : ALL_MAIL_LABEL_ID,
      ),
    "message.close": () => closeMessage(),
    ...Object.fromEntries(
      MAILBOX_JUMP_COMMANDS.map((command, i) => [command, () => jumpToMailbox(i + 1)]),
    ),
    ...Object.fromEntries(MODE_JUMP_COMMANDS.map((command, i) => [command, () => jumpToMode(i)])),
  });

  const onIndex = !routeLoc && !settingsRoute && !composeOpen;
  const hasMail = mailLoc !== null;
  const goForEffect = useLatest(go);
  useEffect(() => {
    if (!onIndex || !hasMail) return;
    goForEffect.current({}, true);
  }, [onIndex, hasMail, goForEffect]);

  useEffect(() => {
    if (!initialized || !selectedAccountId) return;
    if (selectedLabelId === SEARCH_MAILBOX) return;
    saveLastLocation({ accountId: selectedAccountId, labelId: selectedLabelId });
  }, [initialized, selectedAccountId, selectedLabelId]);

  // ⌘[ / ⌘] (the menu accelerators, main.ts "Go"; a DOM keydown never
  // arrives for them because the webview consumes it) and a Mac's swipes
  // (main's history-buttons.ts) move through the window's history. Chromium
  // moves it on the mouse's back/forward buttons itself, and a browser does
  // all of this itself.
  useEffect(() => {
    const back = () => {
      // Never back out of the app, to the page before it.
      if (!router.history.canGoBack()) return;
      console.log("[HomeView:navBack]");
      router.history.back();
    };
    const forward = () => {
      console.log("[HomeView:navForward]");
      router.history.forward();
    };
    const unsubBack = window.desktopBridge.on("nav:back", back);
    const unsubForward = window.desktopBridge.on("nav:forward", forward);
    return () => {
      unsubBack();
      unsubForward();
    };
  }, [router]);

  useEffect(() => {
    const pull = async () => {
      const target = await appApi.takePendingMailto();
      if (!target) return;
      console.log("[HomeView:mailto]", { to: target.to });
      openComposeRef.current(target);
    };
    void pull();
    const unsub = window.desktopBridge.on("compose:mailto", () => void pull());
    return unsub;
  }, [openComposeRef]);

  const [openFromNotification, setOpenFromNotification] = useState<{
    accountId: string;
    messageId: string;
    mailbox?: string;
  } | null>(null);
  useEffect(() => {
    const pull = async () => {
      const target = await appApi.takePendingOpenMessage().catch(() => null);
      if (!target) return;
      console.log("[HomeView:openFromNotification]", { messageId: target.messageId });
      setOpenFromNotification(target);
    };
    void pull();
    return window.desktopBridge.on("mail:open", () => void pull());
  }, []);

  // An alias mailbox shows, and acts on, its parent's mail.
  const effectiveAccountId = (aliasSpace ? aliasSpace.parent.id : space?.id) ?? firstRealAccountId;
  const effectiveSpaceId = space?.id ?? firstRealAccountId;

  const correctForEffect = useLatest(correct);
  /* oxlint-disable react/exhaustive-effect-dependencies -- Explicit DOM and reset triggers must re-run this lifecycle. */
  useEffect(() => {
    if (!initialized || !viewsLoaded || selectedLabelId === SEARCH_MAILBOX) return;
    if (isChats || workspace) return;
    if (isCalendar) {
      if (!CALENDAR_MODES.some((m) => m.mode === selectedLabelId))
        correctForEffect.current({ label: "week" });
      return;
    }
    if (viewSpace) {
      if (selectedLabelId !== VIEW_LIST) correctForEffect.current({ label: VIEW_LIST });
      return;
    }
    const view = views.find((v) => v.id === selectedLabelId);
    if (view) correctForEffect.current({ mailbox: view.id, label: VIEW_LIST });
  }, [
    initialized,
    viewsLoaded,
    views,
    selectedLabelId,
    effectiveAccountId,
    isChats,
    isCalendar,
    workspace,
    viewSpace,
    correctForEffect,
  ]);
  /* oxlint-enable react/exhaustive-effect-dependencies */

  useAccountSync(spansMailboxes ? null : effectiveAccountId);

  // Per-account branding: the primary (send, unread dot, focus ring) and the
  // accent take the active account's color; selection surfaces stay
  // neutral. Set on the document root so portaled dialogs/menus rebrand too;
  // inline properties win over the injected theme rule.
  const brandAccount = accounts.find((a) => a.id === effectiveAccountId) ?? null;
  const monochrome = useMonochromeTheme();
  const brand = monochrome
    ? null
    : (aliasSpace?.color ?? (brandAccount ? getAccountColor(brandAccount) : null));
  useEffect(() => {
    const root = document.documentElement.style;
    const props = ["--accent", "--accent-contrast", "--primary", "--primary-foreground", "--ring"];
    if (!brand) {
      for (const p of props) root.removeProperty(p);
      return;
    }
    const contrast = getAccountContrastColor(brand);
    root.setProperty("--accent", brand);
    root.setProperty("--accent-contrast", contrast);
    root.setProperty("--primary", brand);
    root.setProperty("--primary-foreground", contrast);
    root.setProperty("--ring", brand);
  }, [brand]);

  const combined = useCombined(viewSpace, accounts);

  const handleSelectAccount = (accountId: string) => {
    console.log("[HomeView:selectAccount]", { accountId });
    go({ mailbox: accountId, label: firstLabelOf(accountId), messageId: null });
  };
  useLayoutEffect(() => {
    accountSwitchRef.current = {
      ids: mailboxes.tabs.map((tab) => tab.id),
      select: handleSelectAccount,
    };
  });

  const misplaced = ready && !!routeLoc && routeLoc.mailbox !== mailLoc?.mailbox;
  const goForAccountEffect = useLatest(go);
  useEffect(() => {
    if (!misplaced) return;
    goForAccountEffect.current({}, true);
  }, [misplaced, goForAccountEffect]);

  const sidebarPeek = useSidebarPeek();
  const peeking = sidebarPeek.open && !sidebarOpen && !settingsRoute;
  const goToSpace = (spaceId: string, label?: string) => {
    sidebarPeek.close();
    if (label === undefined) handleSelectAccount(spaceId);
    else {
      go({ mailbox: spaceId, label, messageId: null, account: null, focusId: null });
    }
  };

  const openViewEditor = (viewId: string) => {
    console.log("[HomeView:openViewEditor]", { isNew: viewId === "new" });
    sidebarPeek.close();
    setViewEditor(viewId);
  };

  const handleSelectMessage = (
    messageId: string,
    accountId: string,
    focusId?: string,
    options?: { autoFocusDraft?: boolean },
  ) => {
    console.log("[HomeView:selectMessage]", { messageId, accountId, focusId });
    setAutoFocusDraft(options?.autoFocusDraft !== false);
    go({ messageId, account: accountId, focusId: focusId ?? null });
  };

  const queryClient = useQueryClient();
  const openChatChange = async ({ target }: ChatChange) => {
    if (target.kind === "view") {
      goToSpace(target.id, VIEW_LIST);
    } else if (target.kind === "theme") {
      openSettings({ pane: "appearance" });
    } else if (target.kind === "event") {
      if (target.url) openLink(target.url);
    } else if (target.kind === "label") {
      goToSpace(target.accountId, target.id);
    } else {
      let messageId: string;
      if (target.kind === "draft") {
        const version = await mailApi.getDraftVersion(target.accountId, target.id);
        if (!version.messageId) throw new Error("This draft was sent or deleted.");
        await mailApi.loadDraftVersion(target.accountId, target.id, version.messageId);
        messageId = version.messageId;
      } else {
        const messages = await mailApi.getThread(target.accountId, target.id);
        const message = messages.at(-1);
        if (!message) throw new Error("This conversation is no longer available.");
        messageId = message.id;
      }
      void queryClient.invalidateQueries({ queryKey: ["gmail:messages", target.accountId] });
      go({
        mailbox: target.accountId,
        label: target.kind === "draft" ? "DRAFT" : ALL_MAIL_LABEL_ID,
        messageId,
        account: null,
        focusId: null,
      });
    }
  };
  const selectMessageRef = useLatest(handleSelectMessage);
  useEffect(
    () =>
      setDraftOpener(({ accountId, messageId }) => {
        void queryClient.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
        void queryClient.invalidateQueries({ queryKey: ["gmail:combinedMessages"] });
        selectMessageRef.current(messageId, accountId);
      }),
    [queryClient, selectMessageRef],
  );

  const searchActive = selectedLabelId === SEARCH_MAILBOX;
  const searchReturnRef = useRef<string>("INBOX");
  // Mail search from a workspace searches mail, from the first mailbox.
  const searchMailbox = (workspace ? firstRealAccountId : selectedAccountId) ?? "";
  const topSearchId = searchTabId(searchMailbox, null);
  const activeSearch = searchActive
    ? (searchTabs.find((t) => t.id === activeSearchId) ?? null)
    : null;
  const patchSearch = (id: string, patch: Partial<SearchTab>) =>
    setSearchTabs((tabs) => tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  // Search looks in every mailbox. From a view, in the mailboxes it shows: a label, folder or
  // category is one mailbox's, while every mailbox has an Inbox or Sent.
  const defaultScope = (fromView: boolean): string[] =>
    !fromView
      ? accountIds
      : combined && selectedLabelId !== SEARCH_MAILBOX
        ? [...new Set(combined.rules.map((r) => r.accountId))]
        : spansMailboxes || !effectiveAccountId || IN_EVERY_MAILBOX.has(selectedLabelId)
          ? accountIds
          : [aliasSpace?.id ?? effectiveAccountId];
  const focusSearchEnd = () =>
    setTimeout(() => {
      const input = searchRef.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }, 0);
  const showSearch = (id: string) => {
    if (!searchActive) searchReturnRef.current = workspace ? "INBOX" : selectedLabelId;
    setActiveSearchId(id);
    go({
      ...(workspace ? { mailbox: searchMailbox, account: null, focusId: null } : {}),
      label: SEARCH_MAILBOX,
      messageId: null,
    });
  };
  const openSearch = (q?: string) => {
    console.log("[HomeView:openSearch]", { hasQuery: Boolean(q) });
    setSearchTabs((tabs) => {
      const existing = tabs.find((t) => t.id === topSearchId);
      if (existing)
        return q === undefined
          ? tabs
          : tabs.map((t) => (t.id === topSearchId ? { ...t, query: q, draft: q } : t));
      return [
        ...tabs,
        {
          id: topSearchId,
          mailbox: searchMailbox,
          parent: null,
          base: "",
          query: q ?? "",
          draft: q ?? "",
          scope: defaultScope(false),
        },
      ];
    });
    showSearch(topSearchId);
    if (!q) focusSearchEnd();
  };
  const viewQueryRef = useRef("");
  const searchFromView = () => {
    if (searchActive && !settingsRoute) {
      searchRef.current?.focus();
      return;
    }
    const base = viewQueryRef.current;
    if (!base) return openSearch();
    const id = searchTabId(searchMailbox, selectedLabelId);
    console.log("[HomeView:searchFromView]", { base });
    setSearchTabs((tabs) =>
      tabs.some((t) => t.id === id)
        ? tabs
        : [
            ...tabs,
            {
              id,
              mailbox: searchMailbox,
              parent: selectedLabelId,
              base,
              query: "",
              draft: `${base} `,
              scope: defaultScope(true),
            },
          ],
    );
    showSearch(id);
    focusSearchEnd();
  };
  const runSearch = (q: string) => {
    const tab = activeSearch;
    if (!tab) return openSearch(q);
    if (tab.parent && !q.includes(tab.base)) {
      console.log("[HomeView:searchLeavesView]");
      setSearchTabs((tabs) => [
        ...tabs.filter((t) => t.id !== tab.id && t.id !== topSearchId),
        { ...tab, id: topSearchId, parent: null, base: "", query: q, draft: q },
      ]);
      setActiveSearchId(topSearchId);
      return;
    }
    patchSearch(tab.id, { query: q, draft: q });
  };
  const closeSearch = (id: string) => {
    const tab = searchTabs.find((t) => t.id === id);
    console.log("[HomeView:closeSearch]", { child: Boolean(tab?.parent) });
    setSearchTabs((tabs) => tabs.filter((t) => t.id !== id));
    if (searchActive && activeSearchId === id) {
      go({ label: tab?.parent ?? searchReturnRef.current, messageId: null });
    }
  };
  const handleSearchChange = (q: string) => openSearch(q);
  const openSearchForEffect = useLatest(openSearch);
  useEffect(() => {
    if (searchActive && !activeSearch) openSearchForEffect.current();
  }, [searchActive, activeSearch, openSearchForEffect]);

  const handlePaletteOpenMessage = (message: MessageSummary) => {
    console.log("[HomeView:paletteOpenMessage]", {
      messageId: message.id,
      accountId: message.accountId,
    });
    const owner = message.accountId ?? firstRealAccountId;
    if (!owner) return;
    openMessage(owner, message.id);
  };

  const openMessage = (owner: string, messageId: string, alias?: string) => {
    // Agents', Calendar's and a workspace's items aren't messages: mail opens in its own mailbox.
    // An alias mailbox lists only its own mail, so other mail leaves it.
    const mailbox = alias && aliases.some((a) => a.id === alias) ? alias : owner;
    const switching = alias
      ? mailbox !== space?.id
      : (!spansMailboxes && owner !== effectiveAccountId) || ownsMain || aliasSpace !== null;
    setAutoFocusDraft(true);
    go({
      ...(switching ? { mailbox, label: "INBOX" } : {}),
      messageId,
      account: owner,
      focusId: null,
    });
  };
  const openMessageForEffect = useLatest(openMessage);
  useEffect(() => {
    if (!openFromNotification || !hasMail) return;
    // oxlint-disable-next-line react/set-state-in-effect -- Synchronize pane and composer state with route, notification and navigation events.
    setOpenFromNotification(null);
    openMessageForEffect.current(
      openFromNotification.accountId,
      openFromNotification.messageId,
      openFromNotification.mailbox,
    );
  }, [openFromNotification, hasMail, openMessageForEffect]);

  // Manual refresh: spin from the click until every account's sync settles
  // (any phase — the passive indicator only shows long full/body syncs), and
  // for at least a beat so a fast incremental sync still reads as feedback.
  const [manualSyncing, setManualSyncing] = useState(false);
  const syncNow = () => {
    if (manualSyncing) return;
    console.log("[HomeView:syncNow]");
    setManualSyncing(true);
    const startedAt = Date.now();
    const settle = async () => {
      const remaining = 700 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      setManualSyncing(false);
    };
    // A promise's finally, not try/finally: the React Compiler can't compile a try without a
    // catch, and would leave this whole component unmemoized.
    void (async () => {
      await Promise.all(accountIds.map((id) => mailApi.syncAccount(id).catch(() => null)));
      for (let i = 0; i < 150; i++) {
        const statuses = await Promise.all(
          accountIds.map((id) => mailApi.getSyncStatus(id).catch(() => null)),
        );
        if (!statuses.some((st) => st?.syncing)) break;
        await new Promise((r) => setTimeout(r, 400));
      }
    })()
      .catch(() => null)
      .finally(() => void settle());
  };
  const syncNowRef = useLatest(syncNow);
  useEffect(
    () => window.desktopBridge.on("mail:syncNow", () => syncNowRef.current()),
    [syncNowRef],
  );

  const composeAccountId = viewSpace
    ? (combined?.rules[0]?.accountId ?? firstRealAccountId)
    : spansMailboxes
      ? firstRealAccountId
      : effectiveAccountId;
  const readerAccount =
    readerAccountId ?? (spansMailboxes ? firstRealAccountId : effectiveAccountId);
  const mailChatContext = useMailChatContext({
    accountId: selectedMessageId ? readerAccount : null,
    messageId: selectedMessageId,
    selectedRows: chatSelection,
    quote: pendingQuote,
  });
  const locationHref = router.state.location.href;
  const [workspaceTitle, setWorkspaceTitle] = useState<{ href: string; title: string } | null>(
    null,
  );
  // Bound to this address, so a new address asks again (even for an equal title).
  const nameWorkspacePlace = useCallback(
    (title: string | null) => setWorkspaceTitle(title ? { href: locationHref, title } : null),
    [locationHref],
  );
  useRecordRecentlyViewed({
    ready: initialized,
    href: locationHref,
    workspaceTitle: workspaceTitle?.href === locationHref ? workspaceTitle.title : null,
    settingsPane: settingsRoute?.pane ?? null,
    composing: composeOpen,
    mailbox: selectedAccountId,
    label: selectedLabelId,
    messageId: selectedMessageId,
    readerAccount,
    accounts,
    aliases,
    views,
  });
  const hasListTarget = effectiveAccountId != null && !ownsMain;
  const showMain =
    !!settingsRoute || !fullInbox || !hasListTarget || !!selectedMessageId || composeOpen;
  const listVisible = hasListTarget && !settingsRoute && !composeOpen && (!fullInbox || !showMain);
  const joined = listVisible && showMain;

  const readerOwnsBand =
    !settingsRoute && !(composeOpen && composeAccountId) && !!readerAccount && !!selectedMessageId;
  const panelControls = settingsRoute
    ? 0
    : isChats
      ? Number(features.browser)
      : Number(features.browser) + Number(hasCalendars);
  const browserToggleRoom =
    panelControls > 0 && (isChats || (!browserVisible && !calendarPanelVisible));
  const titleTrailing = <TitleTrailing showPanelToggle={browserToggleRoom} />;
  const titlebarInset = <TitlebarInset />;
  const full: FullView | null = fullView
    ? {
        home: isCalendar
          ? { title: "Calendar", icon: <OtterCalendarIcon className="size-4" /> }
          : workspace
            ? { title: workspace.title, icon: <workspace.Icon className="size-4" /> }
            : { title: "Mail", icon: <OtterMailIcon className="size-4" /> },
        homeShown,
        onShowHome: () => setHomeAt(revealed),
        onShowPage: () => setHomeAt(null),
        onExit: () => setFullView(false),
        leading: titlebarInset,
      }
    : null;
  const readerLeading = fullInbox ? (
    <>
      {sidebarOpen ? null : titlebarInset}
      <HintTooltip label="Back to message list" hint={<ShortcutText command="message.close" />}>
        <IconButton label="Back to message list" onClick={closeMessage}>
          <ArrowLeftIcon className="size-4" />
        </IconButton>
      </HintTooltip>
    </>
  ) : undefined;
  const h = useHandlers({
    go,
    closeMessage,
    goToSpace,
    switchMode,
    startNewChat,
    openViewEditor,
    openSettings,
    closeSearch,
    selectSearch: (id: string) => {
      showSearch(id);
      focusSearchEnd();
    },
    composeFromSidebar: () => {
      sidebarPeek.close();
      openCompose();
    },
    handleSelectMessage,
    handleReaderAdvance,
    openChat,
    searchFromView,
    quote: (q: QuoteContext) => {
      if (chatWindowOpen) setPendingQuote(q);
    },
    openCompose,
    handleSearchChange,
  });
  const renderReader = (
    leading: ReactNode = readerLeading,
    trailing: ReactNode = titleTrailing,
  ) => (
    <MessageReader
      titleLeading={leading}
      titleTrailing={trailing}
      accountId={readerAccount ?? ""}
      messageId={focusedMessageId ?? selectedMessageId}
      listLabelId={spansMailboxes || selectedLabelId === SEARCH_MAILBOX ? null : selectedLabelId}
      alias={aliasSpace ?? undefined}
      autoFocusDraft={autoFocusDraft}
      single={focusedMessageId != null}
      onShowConversation={() => h.go({ focusId: null })}
      onDeselect={h.closeMessage}
      onAdvance={h.handleReaderAdvance}
      onOpenChat={h.openChat}
      onQuote={h.quote}
      onComposeTo={(email) => h.openCompose({ to: email, cc: "", subject: "", body: "" })}
      onSearchSender={(email) => h.handleSearchChange(`from:${email}`)}
    />
  );
  // With the sidebar hidden and no list pane, this band is the window's first:
  // it needs the traffic-light clearance and the toggle to bring the sidebar
  // (and Settings' Back button) back.
  const mainIsLeftmost = !sidebarOpen && !listVisible;
  const titleControls = (
    <TitleControls
      leading={mainIsLeftmost ? titlebarInset : null}
      syncing={globalSync.syncing}
      syncLabel={globalSync.label}
      showPanelToggle={browserToggleRoom}
    />
  );
  const sidebar = (
    <AppSidebar
      accounts={accounts}
      tabs={mailboxes.tabs}
      views={views}
      mode={mode}
      spaceId={effectiveSpaceId}
      labelId={selectedLabelId}
      workspace={
        workspace
          ? { workspace, location: selectedLabelId, item: workspaceItem, go: goInWorkspace }
          : null
      }
      settingsOpen={settingsRoute !== null}
      composing={composeOpen}
      onGo={h.goToSpace}
      onMoveMailbox={mailboxes.move}
      onMode={h.switchMode}
      onSelectChat={(id) => h.go({ label: id }, true)}
      onNewChat={h.startNewChat}
      onCompose={h.composeFromSidebar}
      onNewView={() => h.openViewEditor("new")}
      onEditView={h.openViewEditor}
      onOpenSettings={(pane) => h.openSettings({ pane: pane ?? lastPaneRef.current })}
      searches={searchTabs
        .filter((t) => t.mailbox === searchMailbox && t.parent)
        .map((t) => ({
          id: t.id,
          parent: t.parent!,
          title: searchTitle(t),
          selected: activeSearch?.id === t.id,
        }))}
      onSelectSearch={h.selectSearch}
      onCloseSearch={h.closeSearch}
    />
  );
  return (
    <>
      <PlaceMenu />
      {features.swipeNavigation ? <HistorySwipeNavigation /> : null}
      <div
        className="flex h-full flex-col bg-sidebar-surface text-foreground"
        data-panel-animations={panelAnimationsActive ? "true" : "false"}
        data-mail-layout={ownsMain ? "split" : mailLayout}
        data-sidebar-open={sidebarOpen}
        data-right-panels={
          !panelControls ? "off" : browserVisible || calendarPanelVisible ? "open" : "none"
        }
        style={
          {
            "--panel-animation-duration": `${panelAnimationDurationMs}ms`,
            "--workspace-panel-controls": panelControls,
          } as CSSProperties
        }
      >
        <div className="flex min-h-0 flex-1">
          {/* The frame's width round the cards (the right edge is the last
              card's own gap), so they float with every corner rounded. */}
          <div className="relative isolate flex min-w-0 flex-1 pb-(--workspace-frame-inset) pl-1">
            {/* Inside the frame's stacking: what floats over a page (the agent's window, resize
                handles, the cards' edges) stays over it. */}
            {features.browser ? <PageHost /> : null}
            <div
              data-mail-workspace=""
              className={cn(
                "relative flex min-h-0 min-w-0 flex-1 flex-col",
                fullView && !homeShown && "hidden",
              )}
            >
              {homeShown && full ? (
                <BrowserTabStrip
                  full={full}
                  onClose={(id) => closePageRef.current(id)}
                  onFullView={setFullView}
                  controlSlot={!calendarPanelVisible}
                />
              ) : null}
              <div className="relative flex min-h-0 min-w-0 flex-1">
                {peeking ? (
                  <SidebarPeekCard width={sidebarWidth} onHover={sidebarPeek.hover}>
                    {sidebar}
                  </SidebarPeekCard>
                ) : null}
                {/* Hidden, the sidebar peeks from the window's left edge. */}
                {sidebarOpen || settingsRoute ? null : (
                  <div
                    aria-hidden
                    onMouseEnter={() => sidebarPeek.hover(true)}
                    onMouseLeave={() => sidebarPeek.hover(false)}
                    onDragEnter={() => sidebarPeek.hover(true)}
                    className="absolute inset-y-0 -left-1 z-30 w-3"
                  />
                )}
                {/* Kept mounted while closed, so opening it only slides (but not twice: the peek
                  has its own). Settings' isn't: its search shortcut would act while hidden. */}
                {peeking || (settingsRoute && !settingsSidebarPresent) ? null : (
                  <>
                    <div
                      ref={sidebarFrameRef}
                      inert={!sidebarOpen}
                      style={{ width: sidebarOpen ? sidebarWidth : 0 }}
                      className={cn(
                        PANE_FRAME,
                        "-mb-(--workspace-frame-inset)",
                        sidebarOpen && "[[data-panel-animations=true]_&]:starting:w-0!",
                        !sidebarOpen && "pointer-events-none",
                      )}
                    >
                      <div
                        ref={sidebarPaneRef}
                        style={{ width: sidebarWidth }}
                        className={`${PANE_SIDEBAR} flex shrink-0 flex-col`}
                        data-app-sidebar=""
                      >
                        {settingsRoute ? (
                          <>
                            <SidebarTitle />
                            <SettingsNav
                              pane={settingsRoute.pane}
                              onSelect={(pane, target, item) =>
                                openSettings({ pane, target, item })
                              }
                              onBack={leaveSettings}
                            />
                          </>
                        ) : (
                          <>
                            {/* The traffic lights and the pinned toggle sit over its band. */}
                            <div className="drag-region h-(--workspace-topbar-height) shrink-0" />
                            {sidebar}
                          </>
                        )}
                      </div>
                    </div>
                    {sidebarOpen ? <PaneResizer onPointerDown={sidebarStart} /> : null}
                  </>
                )}
                <div data-main-pane="" className="relative flex min-h-0 min-w-0 flex-1">
                  {hasListTarget && !settingsRoute ? (
                    <>
                      {/* Keep the list mounted while reading in Full inbox: its
                    scroll position, selection and next-message shortcuts stay. */}
                      <div
                        ref={listPaneRef}
                        style={{ width: fullInbox ? undefined : listWidth }}
                        className={cn(
                          fullInbox ? `${PANE_LIST} min-w-0 flex-1` : `${PANE_LIST} shrink-0`,
                          joined && JOINED_LIST,
                          !listVisible && "invisible absolute inset-0",
                        )}
                        inert={!listVisible}
                        data-tour="list"
                      >
                        <MessageList
                          headerLeading={LIST_LEADING}
                          headerTrailing={LIST_TRAILING}
                          accountId={
                            (spansMailboxes ? firstRealAccountId : effectiveAccountId) ?? ""
                          }
                          alias={aliasSpace?.id}
                          labelId={selectedLabelId}
                          combined={combined}
                          accountIds={accountIds}
                          accounts={accounts}
                          selectedMessageId={selectedMessageId}
                          focusedMessageId={focusedMessageId}
                          onSelectMessage={h.handleSelectMessage}
                          onDeselect={h.closeMessage}
                          advanceRef={advanceRef}
                          onSelectionChange={setChatSelection}
                          onOpenChat={h.openChat}
                          onSearchView={h.searchFromView}
                          viewQueryRef={viewQueryRef}
                          search={
                            activeSearch
                              ? {
                                  id: activeSearch.id,
                                  query: activeSearch.query,
                                  base: activeSearch.base,
                                  accountIds: activeSearch.scope,
                                  onSearch: runSearch,
                                  onClear: () => {
                                    const base = activeSearch.base ? `${activeSearch.base} ` : "";
                                    patchSearch(activeSearch.id, { query: "", draft: base });
                                    focusSearchEnd();
                                  },
                                  onExit: () => closeSearch(activeSearch.id),
                                  onScope: (scope) => patchSearch(activeSearch.id, { scope }),
                                  focusRef: searchRef,
                                  draft: activeSearch.draft,
                                  onDraftChange: (draft) => patchSearch(activeSearch.id, { draft }),
                                  messageOpen: selectedMessageId !== null,
                                }
                              : undefined
                          }
                        />
                      </div>
                      {fullInbox ? null : <PaneResizer onPointerDown={listStart} joined={joined} />}
                    </>
                  ) : null}
                  <div
                    className={cn(
                      `${PANE_MAIN} min-w-0 flex-1 flex-col`,
                      joined && JOINED_MAIN,
                      showMain ? "flex" : "hidden",
                    )}
                    data-tour={showMain ? "reader" : undefined}
                  >
                    {readerOwnsBand || (ownsMain && !settingsRoute && !composeOpen)
                      ? null
                      : titleControls}
                    <div className="flex min-h-0 flex-1 flex-col">
                      {settingsRoute ? (
                        <SettingsPage route={settingsRoute} onNavigate={openSettings} />
                      ) : composeOpen && composeAccountId ? (
                        <NewMessageView
                          key={mailtoSeq}
                          accounts={accounts}
                          defaultAccountId={composeAccountId}
                          defaultAddress={aliasSpace?.alias.address}
                          onClose={() => {
                            setMailtoPrefill(null);
                            leaveSettings();
                          }}
                          prefill={mailtoPrefill ?? undefined}
                        />
                      ) : workspace ? (
                        <workspace.Main
                          location={selectedLabelId}
                          item={workspaceItem}
                          go={goInWorkspace}
                          setTitle={nameWorkspacePlace}
                          titleLeading={sidebarOpen ? null : titlebarInset}
                          titleTrailing={titleTrailing}
                        />
                      ) : isCalendar ? (
                        <CalendarView
                          mode={selectedLabelId as CalendarMode}
                          accounts={accounts}
                          titleLeading={sidebarOpen ? null : titlebarInset}
                          titleTrailing={titleTrailing}
                          onMode={(mode) => go({ label: mode }, true)}
                        />
                      ) : isChats ? (
                        selectedLabelId === SCHEDULED_TASKS ? (
                          <ScheduledTasksView
                            taskKey={mailLoc?.messageId ?? null}
                            onOpenTask={(key) => go({ messageId: key })}
                            titleLeading={sidebarOpen ? null : titlebarInset}
                            titleTrailing={titleTrailing}
                            onSelectChat={(id) => go({ label: id }, true)}
                          />
                        ) : selectedLabelId !== NEW_CHAT ? (
                          <ChatWorkspace
                            key={selectedLabelId}
                            chatId={selectedLabelId}
                            titleLeading={sidebarOpen ? null : titlebarInset}
                            titleTrailing={titleTrailing}
                            inputRef={chatInputRef}
                            closeTabRef={closeWorkspaceTabRef}
                            panelRef={chatPanelRef}
                            onPanelOpen={setChatPanelOpen}
                            onNavigate={openChatChange}
                            onSelectChat={(id) => go({ label: id }, true)}
                            onOpenTask={(key) => go({ label: SCHEDULED_TASKS, messageId: key })}
                          />
                        ) : null
                      ) : readerAccount ? (
                        showMain ? (
                          renderReader()
                        ) : null
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <EmptyState
                            title="No account selected"
                            description="Select a mailbox from the sidebar."
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {browserPresent ? (
              <>
                {browserVisible && !fullView ? <PaneResizer onPointerDown={browserStart} /> : null}
                <div
                  ref={browserFrameRef}
                  data-page-clip=""
                  style={{ width: fullView ? undefined : browserVisible ? browserWidth : 0 }}
                  className={cn(
                    PANE_FRAME,
                    fullView && "min-w-0 flex-1",
                    homeShown && "hidden",
                    browserVisible && "[[data-panel-animations=true]_&]:starting:w-0!",
                    !browserVisible && "pointer-events-none",
                  )}
                >
                  <div
                    ref={browserPaneRef}
                    style={{ width: fullView ? "100%" : browserWidth }}
                    className={cn(PANE_BROWSER, "shrink-0")}
                  >
                    <BrowserPanel
                      closeTabRef={closeBrowserTabRef}
                      onClosePanel={closeBrowser}
                      controlSlot={!calendarPanelVisible}
                      full={full}
                      onFullView={setFullView}
                    />
                  </div>
                </div>
              </>
            ) : null}
            {calendarPanelPresent ? (
              <>
                {calendarPanelVisible ? <PaneResizer onPointerDown={calendarPanelStart} /> : null}
                <div
                  ref={calendarPanelFrameRef}
                  style={{ width: calendarPanelVisible ? calendarPanelWidth : 0 }}
                  className={cn(
                    PANE_FRAME,
                    // Drawn from the window's edge as it slides: its title never passes under the toggles.
                    "justify-end",
                    calendarPanelVisible && "[[data-panel-animations=true]_&]:starting:w-0!",
                    !calendarPanelVisible && "pointer-events-none",
                  )}
                >
                  <div
                    ref={calendarPanelPaneRef}
                    style={{ width: calendarPanelWidth }}
                    className={cn(PANE_BROWSER, "shrink-0")}
                  >
                    <CalendarPanel
                      onOpen={(event) => {
                        if (!isCalendar || composeOpen) switchMode("calendar");
                        useCalendar.getState().show(event);
                      }}
                    />
                  </div>
                </div>
              </>
            ) : null}
            {/* The agent's small window, in its corner button's place (over the browser too). */}
            {chatWindowPresent ? (
              <ChatWindow
                animationMs={panelAnimationsActive ? panelAnimationDurationMs : 0}
                closing={!chatWindowShown}
                context={mailChatContext}
                onClearQuote={() => setPendingQuote(null)}
                onOpenChange={openChatChange}
                onOpenWorkspace={openWorkspace}
                onOpenTask={(key) => {
                  setChatWindow(false);
                  go({
                    mailbox: CHATS_SPACE,
                    label: SCHEDULED_TASKS,
                    messageId: key,
                    account: null,
                    focusId: null,
                  });
                }}
                onMinimize={() => setChatWindow(false)}
                onShelve={closeChat}
                onNewChat={startNewChat}
                onOpenAgents={() => switchMode("agent")}
                inputRef={chatInputRef}
              />
            ) : null}
            {agentCornerShown && !chatWindowPresent ? <AgentCorner onOpen={toggleChat} /> : null}
          </div>
        </div>
      </div>

      {/* Pinned titlebar toggles (T3 Code): same window spot whatever the panes do. */}
      <SidebarControl
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onHover={sidebarOpen || settingsRoute ? undefined : sidebarPeek.hover}
      />
      {panelControls > 0 ? (
        <PanelControls
          calendar={
            hasCalendars && !isChats
              ? { open: calendarPanelVisible, onToggle: toggleCalendarPanel }
              : undefined
          }
          browser={
            features.browser && !isChats
              ? { open: browserVisible, onToggle: toggleBrowser }
              : undefined
          }
          chatPanel={
            features.browser && isChats
              ? { open: chatPanelOpen, onToggle: toggleBrowser }
              : undefined
          }
        />
      ) : null}

      {tourRequested && initialized ? (
        <Tour
          actions={{
            agentOpen: chatWindowOpen,
            setAgentOpen: (open) => (open ? openChat() : setChatWindow(false)),
            openMessage: () => {
              if (selectedMessageId) return;
              const row =
                document.querySelector<HTMLElement>(
                  "[data-message-row]:not([data-draft]):not([data-unread])",
                ) ?? document.querySelector<HTMLElement>("[data-message-row]:not([data-draft])");
              row?.click();
            },
          }}
          onClose={endTour}
        />
      ) : null}

      <ExtensionDialogs />
      <ViewEditorDialog
        key={viewEditor ?? "closed"}
        open={viewEditor !== null}
        view={views.find((v) => v.id === viewEditor) ?? null}
        accounts={accountsQuery.data ?? []}
        onSave={(input) =>
          saveView(input).then((saved) => {
            if (!input.id) handleSelectAccount(saved.id);
          })
        }
        onDelete={deleteView}
        onClose={() => setViewEditor(null)}
      />

      {accounts.length > 0 ? (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          accounts={accounts}
          views={views}
          tabs={mailboxes.tabs}
          selectedAccountId={effectiveSpaceId}
          onOpenMessage={handlePaletteOpenMessage}
          onSearchMail={(q) => openSearch(q)}
          onSelectAccount={handleSelectAccount}
          onOpenChat={openWorkspace}
          onNewChat={startNewChat}
          onToggleBrowser={toggleBrowser}
          onToggleCalendarPanel={hasCalendars ? toggleCalendarPanel : undefined}
          onCompose={() => openCompose()}
          onOpenSettings={(pane) => openSettings({ pane: pane ?? lastPaneRef.current })}
          onNewView={() => openViewEditor("new")}
          onToggleChat={toggleChat}
          onToggleSidebar={toggleSidebar}
          onSync={syncNow}
        />
      ) : null}
    </>
  );
}
