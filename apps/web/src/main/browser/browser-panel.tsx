import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import {
  ArrowUpLeftIcon,
  ChevronRightIcon,
  ChevronsLeftRightIcon,
  ChevronsRightLeftIcon,
  Maximize2Icon,
  MessageSquareIcon,
  Minimize2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";

import { useCommandHandlers } from "../keybindings/dispatch";
import { ShortcutText } from "../keybindings/store";
import { PanelTab } from "../mail/panel-tab";
import { mostRecentTab } from "../mail/panel-tabs";
import { PanelControlSlot } from "../mail/top-bar";
import { usePanelTabDrag } from "../mail/use-panel-tab-drag";
import { HOME, TabSwitcher, type Switching } from "./tab-switcher";
import { BrowserTabIcon } from "@otter/browser/ui/browser-view";
import { PageSlot } from "@otter/browser/ui/page-host";
import { AgentIcon } from "../agent/agent-icon";
import { closeChatTab } from "@otter/client/agents/chat-store";
import {
  closeChatPage,
  closeTab,
  giveBack,
  giveToChat,
  newTab,
  panelTabs,
  reorderTabs,
  selectTab,
  useBrowser,
  type BrowserTab,
} from "@otter/browser/ui/store";
import { hostOf } from "@otter/client/web-address";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@otter/ui/components/context-menu";
import { cn } from "@otter/ui/lib/utils";

/**
 * Full view (ChatGPT's): the browser's pages and what they opened beside (Mail, Calendar…) are
 * tabs of one strip, shown one at a time across the window; the chevron restores split view.
 */
export type FullView = {
  home: { title: string; icon: ReactNode };
  /** The home tab is the one shown. */
  homeShown: boolean;
  onShowHome: () => void;
  /** A page's tab picked: the browser is shown. */
  onShowPage: () => void;
  onExit: () => void;
  /** Room for the window's own controls, over the strip's start. */
  leading: ReactNode;
};

/** The chat in the small agent window: its pages show after yours, as its own group. */
export type AgentChat = { chatId: string; title: string; onOpen: () => void };

/** A chat's page, back to the chat's own way of closing it: its tab there goes too. */
function closeAgentTab(tab: BrowserTab): void {
  if (!tab.chatId || !tab.chatTabId) return;
  closeChatTab(tab.chatId, tab.chatTabId);
  closeChatPage(tab.chatId, tab.chatTabId);
}

/** A chat's page made yours: the chat keeps no tab for it. */
function takeBack(tab: BrowserTab): void {
  if (!tab.chatId || !tab.chatTabId) return;
  const { chatId, chatTabId } = tab;
  giveBack(tab.id);
  closeChatTab(chatId, chatTabId);
}

/** Yours, then the small window's chat's: the tabs the strip shows. */
const stripIds = (tabs: BrowserTab[], chatId: string | undefined) =>
  [...panelTabs(tabs), ...tabs.filter((t) => chatId && t.chatId === chatId)].map((t) => t.id);

/** The pages' tabs, with full view's home tab before them and its toggle after. */
export function BrowserTabStrip({
  full,
  onClose,
  onFullView,
  controlSlot,
  tabListRef,
  agentChat,
}: {
  full: FullView | null;
  onClose: (id: string) => void;
  onFullView: (full: boolean) => void;
  controlSlot: boolean;
  tabListRef?: MutableRefObject<HTMLDivElement | null>;
  agentChat?: AgentChat | null;
}) {
  const all = useBrowser((s) => s.tabs);
  const tabs = panelTabs(all);
  const agentTabs = agentChat ? all.filter((t) => t.chatId === agentChat.chatId) : [];
  const activeId = useBrowser((s) => s.activeId);
  const { ref, draggingId, handlers } = usePanelTabDrag(reorderTabs);
  const focusSelected = () =>
    requestAnimationFrame(() =>
      tabListRef?.current
        ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus(),
    );
  const show = (id: string) => {
    selectTab(id);
    full?.onShowPage();
    focusSelected();
  };
  const tabOf = (tab: BrowserTab, menu: ReactNode, className?: string) => {
    const title = tab.title || (tab.url ? hostOf(tab.url) : "New tab");
    return (
      <ContextMenu key={tab.id}>
        <ContextMenuTrigger>
          <PanelTab
            id={tab.id}
            title={title}
            tooltip={tab.url ? `${title}\n${tab.url}` : title}
            selected={tab.id === activeId && !full?.homeShown}
            dragging={draggingId === tab.id}
            onSelect={() => show(tab.id)}
            onClose={() => onClose(tab.id)}
            icon={<BrowserTabIcon tab={tab} />}
            className={className}
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          {menu}
          <ContextMenuSeparator />
          <ContextMenuItem icon={<XIcon />} onClick={() => onClose(tab.id)}>
            Close tab
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  return (
    <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 px-3">
      {full ? (
        <>
          {full.leading}
          <PanelTab
            id="home"
            title={full.home.title}
            icon={full.home.icon}
            selected={full.homeShown}
            closable={false}
            onSelect={full.onShowHome}
            onClose={full.onShowHome}
            className="no-drag shrink-0"
          />
          <HintTooltip label="Restore split view" side="bottom">
            <IconButton
              label="Restore split view"
              size="icon"
              className="no-drag shrink-0"
              onClick={full.onExit}
            >
              <ChevronRightIcon className="size-4" />
            </IconButton>
          </HintTooltip>
        </>
      ) : null}
      <div
        role="tablist"
        ref={(node) => {
          ref.current = node;
          if (tabListRef) tabListRef.current = node;
        }}
        aria-label="Open pages"
        className="no-drag scroll-fade-x relative flex min-w-0 shrink items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        {...handlers}
      >
        {tabs.map((tab) =>
          tabOf(
            tab,
            agentChat ? (
              <ContextMenuItem
                icon={<AgentIcon />}
                onClick={() => giveToChat(tab.id, agentChat.chatId)}
              >
                Give to {agentChat.title}
              </ContextMenuItem>
            ) : (
              <ContextMenuItem icon={<PlusIcon />} onClick={newTab}>
                New tab
              </ContextMenuItem>
            ),
          ),
        )}
        {agentChat && agentTabs.length > 0 ? (
          <AgentGroup
            chat={agentChat}
            tabs={agentTabs}
            activeId={full?.homeShown ? null : activeId}
            onShow={show}
            tabOf={tabOf}
          />
        ) : null}
      </div>
      <HintTooltip label="New tab" hint={<ShortcutText command="browser.newTab" />} side="bottom">
        <IconButton
          label="New tab"
          size="icon"
          className="shrink-0"
          onClick={() => {
            newTab();
            full?.onShowPage();
          }}
        >
          <PlusIcon className="size-4" />
        </IconButton>
      </HintTooltip>
      <span className="min-w-0 flex-1" />
      <HintTooltip
        label={full ? "Exit full view" : "Enter full view"}
        hint={<ShortcutText command="browser.fullView" />}
        side="bottom"
      >
        <IconButton
          label={full ? "Exit full view" : "Enter full view"}
          size="icon"
          className="no-drag shrink-0"
          onClick={() => onFullView(!full)}
        >
          {full ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
        </IconButton>
      </HintTooltip>
      {/* The pinned panel toggles (home view) sit here, over the rightmost panel. */}
      {controlSlot ? <PanelControlSlot /> : null}
    </div>
  );
}

/**
 * A chat's pages, Chrome's tab group: its chip names the chat and folds the group away (the
 * page shown stays out), and a line under the group's tabs holds them together.
 */
function AgentGroup({
  chat,
  tabs,
  activeId,
  onShow,
  tabOf,
}: {
  chat: AgentChat;
  tabs: BrowserTab[];
  activeId: string | null;
  onShow: (id: string) => void;
  tabOf: (tab: BrowserTab, menu: ReactNode, className?: string) => ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  const shown = folded ? tabs.filter((t) => t.id === activeId) : tabs;
  const working = tabs.some((t) => t.working);
  return (
    <div
      role="group"
      aria-label={`${chat.title}'s pages`}
      className="relative ml-1 flex shrink-0 items-center gap-1 pb-0.5 after:pointer-events-none after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-primary/70"
    >
      <ContextMenu>
        <ContextMenuTrigger>
          <HintTooltip
            label={folded ? `Show ${chat.title}'s pages` : `Fold ${chat.title}'s pages`}
            side="bottom"
          >
            <button
              type="button"
              aria-expanded={!folded}
              onClick={() => setFolded(!folded)}
              className="flex h-6 max-w-40 shrink-0 cursor-pointer items-center gap-1.5 rounded-md bg-primary/15 px-2 text-xs font-medium text-primary outline-none hover:bg-primary/25 focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <AgentIcon className={cn("size-3.5 shrink-0", working && "animate-pulse")} />
              <span className="min-w-0 truncate">{chat.title}</span>
              {folded ? <span className="tabular-nums opacity-70">{tabs.length}</span> : null}
            </button>
          </HintTooltip>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <ContextMenuItem icon={<MessageSquareIcon />} onClick={chat.onOpen}>
            Open chat
          </ContextMenuItem>
          <ContextMenuItem
            icon={folded ? <ChevronsLeftRightIcon /> : <ChevronsRightLeftIcon />}
            onClick={() => setFolded(!folded)}
          >
            {folded ? "Show pages" : "Fold pages"}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem icon={<ArrowUpLeftIcon />} onClick={() => tabs.forEach(takeBack)}>
            Move pages to your tabs
          </ContextMenuItem>
          <ContextMenuItem icon={<XIcon />} onClick={() => tabs.forEach(closeAgentTab)}>
            Close pages
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {shown.map((tab) =>
        tabOf(
          tab,
          <>
            <ContextMenuItem icon={<MessageSquareIcon />} onClick={chat.onOpen}>
              Open chat
            </ContextMenuItem>
            <ContextMenuItem
              icon={<ArrowUpLeftIcon />}
              onClick={() => {
                takeBack(tab);
                onShow(tab.id);
              }}
            >
              Move to your tabs
            </ContextMenuItem>
          </>,
          cn(tab.working && "ring-1 ring-inset ring-primary/60"),
        ),
      )}
    </div>
  );
}

export function BrowserPanel({
  closeTabRef,
  onClosePanel,
  controlSlot,
  full,
  onFullView,
  agentChat,
}: {
  closeTabRef: MutableRefObject<(() => boolean) | null>;
  onClosePanel: () => void;
  controlSlot: boolean;
  full: FullView | null;
  onFullView: (full: boolean) => void;
  agentChat?: AgentChat | null;
}) {
  const allTabs = useBrowser((s) => s.tabs);
  const activeId = useBrowser((s) => s.activeId);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const recentRef = useRef<string[]>([]);
  const chatShown = agentChat?.chatId;
  // In full view, the home tab (Mail…) takes its turn with the pages.
  const homeShown = full?.homeShown ?? false;
  const fullView = full !== null;
  // A chat's page no longer in the strip (its window closed): back to one of yours.
  useEffect(() => {
    const shown = allTabs.find((t) => t.id === activeId);
    if (!shown?.chatId || shown.chatId === chatShown) return;
    const mine = panelTabs(allTabs).map((t) => t.id);
    selectTab(recentRef.current.find((id) => mine.includes(id)) ?? mine.at(-1) ?? null);
  }, [activeId, allTabs, chatShown]);
  useEffect(() => {
    const open = new Set(stripIds(allTabs, chatShown));
    if (fullView) open.add(HOME);
    const shown = homeShown ? HOME : activeId;
    recentRef.current = [
      ...(shown && open.has(shown) ? [shown] : []),
      ...recentRef.current.filter((id) => id !== shown && open.has(id)),
    ];
  }, [activeId, allTabs, homeShown, fullView, chatShown]);

  const close = (id: string) => {
    const { tabs, activeId: shown } = useBrowser.getState();
    const ids = stripIds(tabs, chatShown);
    if (ids.length < 2) onClosePanel();
    const next = mostRecentTab(ids, id, recentRef.current);
    const tab = tabs.find((t) => t.id === id);
    if (tab?.chatId) closeAgentTab(tab);
    else closeTab(id);
    if (shown === id && next) selectTab(next);
  };
  useEffect(() => {
    closePageRef.current = close;
  });
  // ⌃Tab: the tabs, most recently used first, stepped through while ⌃ is held.
  const [switching, setSwitching] = useState<Switching | null>(null);
  // Kept as it changes, not as React draws it: ⌃ can come up before the strip is drawn.
  const switchingRef = useRef(switching);
  const setChoice = (next: Switching | null) => {
    switchingRef.current = next;
    setSwitching(next);
  };
  const step = (back: boolean) => {
    const open = [...stripIds(useBrowser.getState().tabs, chatShown), ...(full ? [HOME] : [])];
    if (open.length < 2) return false;
    const current = switchingRef.current;
    if (current) {
      const n = current.order.length;
      setChoice({ ...current, index: (current.index + (back ? n - 1 : 1)) % n });
    } else {
      const order = [
        ...recentRef.current.filter((id) => open.includes(id)),
        ...open.filter((id) => !recentRef.current.includes(id)),
      ];
      setChoice({ order, index: back ? order.length - 1 : 1 });
    }
    return true;
  };
  const pick = (index?: number) => {
    const current = switchingRef.current;
    if (!current) return;
    if (index !== undefined) current.index = index;
    setChoice(null);
    const id = current.order[current.index];
    if (!id) return;
    if (id === HOME) {
      full?.onShowHome();
      return;
    }
    selectTab(id);
    full?.onShowPage();
    // Into the page, as Chrome's switch: once it's the one shown.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>("[data-browser-page]:not([inert]) webview")?.focus(),
      ),
    );
  };
  const inBrowser = (event: KeyboardEvent) =>
    Boolean(full) ||
    (event.target instanceof Element &&
      (Boolean(panelRef.current?.contains(event.target)) ||
        Boolean(event.target.closest("[data-browser-page]"))));
  useCommandHandlers({
    "tab.previous": (event) => inBrowser(event) && step(false),
    "tab.switchBack": (event) => inBrowser(event) && step(true),
  });
  useEffect(() => {
    const offs = [
      window.desktopBridge.on("browser:switchTabs", (params) =>
        step((params as { back?: boolean }).back === true),
      ),
      window.desktopBridge.on("browser:switchTabsDone", () => pick()),
    ];
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") pick();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && switchingRef.current) {
        event.preventDefault();
        setChoice(null);
      }
    };
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("keydown", escape, true);
    };
  });
  useEffect(() => {
    closeTabRef.current = () => {
      const shown = useBrowser.getState().activeId;
      if (shown) close(shown);
      return true;
    };
    return () => {
      closeTabRef.current = null;
    };
  });

  return (
    <div ref={panelRef} className="relative flex h-full min-w-0 flex-col">
      <BrowserTabStrip
        full={full}
        onClose={close}
        onFullView={onFullView}
        controlSlot={controlSlot}
        tabListRef={tabListRef}
        agentChat={agentChat}
      />
      {switching ? <TabSwitcher switching={switching} onPick={pick} home={full?.home} /> : null}
      {activeId ? (
        <PageSlot key={activeId} tabId={activeId} className="rounded-xl" />
      ) : (
        <div className="min-h-0 flex-1" />
      )}
    </div>
  );
}

/** How a page's tab closes (its × in full view's other strip): the panel's own way. */
export const closePageRef: { current: (id: string) => void } = { current: closeTab };
