import { PlusIcon } from "lucide-react";
import { createElement, useEffect, useRef, useState } from "react";
import { create } from "zustand";

import { mailApi } from "./mail/api";
import { AgentIcon } from "./mail/agent-icon";
import { AgentAvatar, openClawAgentId } from "./mail/agent-providers";
import { isBlank, useChats } from "./mail/chat-store";
import { PanelTab } from "./mail/panel-tab";
import { HistoryControls, recentIcon } from "./mail/top-bar";
import { HintTooltip, IconBtn, cn } from "./mail/ui";
import { usePanelTabDrag } from "./mail/use-panel-tab-drag";
import { features } from "./features";
import { useLatest } from "./use-latest";
import type { RecentIcon } from "./recently-viewed";

export type WindowTab = {
  id: string;
  href: string;
  title: string;
  icon: RecentIcon;
};

type State = { tabs: WindowTab[]; activeId: string };

const KEY = "otter:window-tabs";

/**
 * The main window keeps its tabs across launches; a window a tab was dragged
 * out into keeps its own, only while it's open (sessionStorage is per window).
 * What it opened on is `otter:tab-window` (the entry's, from its address).
 */
const tabWindow = (() => {
  try {
    return JSON.parse(sessionStorage.getItem("otter:tab-window") ?? "null") as {
      title: string;
      icon: string;
    } | null;
  } catch {
    return null;
  }
})();
const storage = tabWindow ? sessionStorage : localStorage;

const newTabFor = (href: string): WindowTab => ({
  id: crypto.randomUUID(),
  href,
  title: "",
  icon: "inbox",
});

function load(): State {
  try {
    const saved = JSON.parse(storage.getItem(KEY) ?? "null") as State | null;
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      const activeId = saved.tabs.some((t) => t.id === saved.activeId)
        ? saved.activeId
        : saved.tabs[0]!.id;
      return { tabs: saved.tabs, activeId };
    }
  } catch {
    // Broken tabs start over.
  }
  if (tabWindow && location.hash.length > 1) {
    const tab = {
      ...newTabFor(location.hash.slice(1)),
      title: tabWindow.title,
      icon: (tabWindow.icon || "inbox") as RecentIcon,
    };
    return { tabs: [tab], activeId: tab.id };
  }
  return { tabs: [], activeId: "" };
}

export const useWindowTabs = create<State>(() => load());

function set(update: (s: State) => State): void {
  const next = update(useWindowTabs.getState());
  useWindowTabs.setState(next, true);
  storage.setItem(KEY, JSON.stringify(next));
}

export function followLocation(href: string): void {
  set((s) => {
    const active = s.tabs.find((t) => t.id === s.activeId);
    if (!active) {
      const tab = newTabFor(href);
      return { tabs: [tab], activeId: tab.id };
    }
    if (active.href === href) return s;
    return { ...s, tabs: s.tabs.map((t) => (t === active ? { ...t, href } : t)) };
  });
}

export function nameTab(href: string, title: string, icon: RecentIcon): void {
  set((s) => {
    const tab = s.tabs.find((t) => t.href === href && t.id === s.activeId);
    if (!tab || (tab.title === title && tab.icon === icon)) return s;
    return { ...s, tabs: s.tabs.map((t) => (t === tab ? { ...t, title, icon } : t)) };
  });
}

export function addTab(
  href: string,
  {
    background = false,
    title = "",
    icon,
  }: { background?: boolean; title?: string; icon?: RecentIcon } = {},
): void {
  set((s) => {
    const tab = { ...newTabFor(href), title, ...(icon ? { icon } : {}) };
    const at = s.tabs.findIndex((t) => t.id === s.activeId);
    const tabs = [...s.tabs];
    tabs.splice(at + 1, 0, tab);
    return { tabs, activeId: background ? s.activeId : tab.id };
  });
}

export function selectTab(id: string): string | null {
  const tab = useWindowTabs.getState().tabs.find((t) => t.id === id);
  if (!tab) return null;
  set((s) => ({ ...s, activeId: id }));
  return tab.href;
}

export function closeTab(id: string): string | null {
  const { tabs, activeId } = useWindowTabs.getState();
  const at = tabs.findIndex((t) => t.id === id);
  if (at < 0 || tabs.length < 2) return null;
  const rest = tabs.filter((t) => t.id !== id);
  const next = id === activeId ? (rest[Math.min(at, rest.length - 1)] ?? null) : null;
  set(() => ({ tabs: rest, activeId: next ? next.id : activeId }));
  return next?.href ?? null;
}

function restoreTab(tab: WindowTab, at: number): string {
  set((s) => {
    const tabs = s.tabs.filter((t) => t.id !== tab.id);
    tabs.splice(Math.min(at, tabs.length), 0, tab);
    return { tabs, activeId: tab.id };
  });
  return tab.href;
}

function reorderTabs(order: string[]): void {
  set((s) => ({
    ...s,
    tabs: order.flatMap((id) => s.tabs.find((t) => t.id === id) ?? []),
  }));
}

export function WindowTabsBar({
  sidebarOpen,
  onSelect,
  onClose,
  onShow,
  onNew,
}: {
  sidebarOpen: boolean;
  onSelect: (id: string) => void;
  onShow: (href: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const tabs = useWindowTabs((s) => s.tabs);
  const activeId = useWindowTabs((s) => s.activeId);
  const torn = useRef<{ tab: WindowTab; at: number } | null>(null);
  // Dragged off the strip, a tab carries a window, following the pointer
  // until it's let go: a new one of its own (brought back over the strip
  // first, it rejoins it), or this one, when it's the only tab. Let go over
  // another window's tabs, it joins them there. Each reads the store as it is
  // then, not this render's copy: a drag outlives renders.
  const { ref, draggingId, handlers } = usePanelTabDrag(
    reorderTabs,
    features.tabWindows
      ? {
          whole: () => useWindowTabs.getState().tabs.length === 1,
          start: (id, grab) => {
            const all = useWindowTabs.getState().tabs;
            const tab = all.find((t) => t.id === id);
            if (!tab) return;
            const drag = {
              tab: { href: tab.href, title: tab.title, icon: tab.icon },
              grabX: grab.x,
              grabY: grab.y,
            };
            if (all.length === 1) {
              void mailApi.carryWindow(drag);
              return;
            }
            torn.current = { tab, at: all.indexOf(tab) };
            void mailApi.openTabWindow(drag);
            onClose(id);
          },
          move: () => void mailApi.carryTabWindow(),
          drop: () => {
            torn.current = null;
            void mailApi.dropTabWindow();
          },
          back: () => {
            const away = torn.current;
            torn.current = null;
            if (!away) return;
            void mailApi.returnTabWindow();
            onShow(restoreTab(away.tab, away.at));
          },
        }
      : undefined,
  );

  const [incoming, setIncoming] = useState<{ tab: WindowTab; at: number } | null>(null);
  const onShowRef = useLatest(onShow);
  useEffect(() => {
    const slot = (x: number) =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-panel-tab-id]") ?? []).filter(
        (el) => {
          const box = el.getBoundingClientRect();
          return box.left + box.width / 2 < x;
        },
      ).length;
    const read = (params: unknown) => {
      const p = params as { tab?: Partial<WindowTab>; x?: number } | null;
      if (typeof p?.tab?.href !== "string" || typeof p.x !== "number") return null;
      const tab = {
        ...newTabFor(p.tab.href),
        title: p.tab.title ?? "",
        icon: (p.tab.icon || "inbox") as RecentIcon,
      };
      return { tab, at: slot(p.x) };
    };
    const offHover = window.desktopBridge.on("window:tabHover", (params) => {
      const next = read(params);
      setIncoming((current) =>
        next && current?.at === next.at && current.tab.href === next.tab.href ? current : next,
      );
    });
    const offReceive = window.desktopBridge.on("window:receiveTab", (params) => {
      setIncoming(null);
      const next = read(params);
      if (next) onShowRef.current(restoreTab(next.tab, next.at));
    });
    return () => {
      offHover();
      offReceive();
    };
  }, [ref, onShowRef]);

  return (
    <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 pr-[calc(var(--workspace-controls-right)+var(--workspace-titlebar-control-size)+0.5rem)]">
      {/* Room for the traffic lights and the sidebar toggle, at least; history
          at its end. With the sidebar open, the first tab lines up with the
          cards' left edge (less the bar's gap). */}
      <div
        style={{
          width: `max(calc(var(--workspace-titlebar-content-left) + var(--workspace-history-controls-width) + 0.25rem), ${sidebarOpen ? "calc(var(--workspace-sidebar-width) + var(--workspace-frame-inset) - 0.25rem)" : "0px"})`,
        }}
        className="flex shrink-0 justify-end pr-1.5"
      >
        <HistoryControls />
      </div>
      <div
        role="tablist"
        ref={ref}
        aria-label="Tabs"
        className="no-drag scroll-fade-x relative flex min-w-0 shrink items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        {...handlers}
      >
        {tabs.flatMap((tab, i) => {
          const shown = (
            <PanelTab
              key={tab.id}
              id={tab.id}
              title={tab.title || "…"}
              selected={tab.id === activeId}
              dragging={draggingId === tab.id}
              closable={tabs.length > 1}
              onSelect={() => onSelect(tab.id)}
              onClose={() => onClose(tab.id)}
              icon={<WindowTabIcon tab={tab} />}
              className={cn("h-6.5 w-52 max-w-52", tab.id !== activeId && "bg-foreground/[0.04]")}
            />
          );
          return incoming?.at === i
            ? [<IncomingTab key="incoming" tab={incoming.tab} />, shown]
            : [shown];
        })}
        {incoming && incoming.at >= tabs.length ? (
          <IncomingTab key="incoming" tab={incoming.tab} />
        ) : null}
      </div>
      <HintTooltip label="New tab" side="bottom">
        <IconBtn label="New tab" className="no-drag" onClick={onNew}>
          <PlusIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

function WindowTabIcon({ tab }: { tab: WindowTab }) {
  const chatId = tab.icon === "chat" ? tab.href.match(/\/chats\/([^/?#]+)/)?.[1] : null;
  if (chatId) return <ChatTabIcon chatId={chatId} />;
  return createElement(recentIcon(tab.icon) ?? AgentIcon, { className: "size-3.5" });
}

function IncomingTab({ tab }: { tab: WindowTab }) {
  return (
    <div
      aria-hidden
      className="flex h-6.5 w-52 max-w-52 min-w-32 shrink items-center gap-1.5 rounded-lg bg-foreground/10 pr-1 pl-2.5 text-sm text-foreground shadow-sm ring-1 ring-border"
    >
      <span className="relative flex size-3.5 shrink-0 items-center justify-center">
        <WindowTabIcon tab={tab} />
      </span>
      <span className="min-w-0 flex-1 truncate">{tab.title || "…"}</span>
    </div>
  );
}

function ChatTabIcon({ chatId }: { chatId: string }) {
  const chat = useChats((s) => s.conversations.find((c) => c.id === chatId));
  return chat && !isBlank(chat) ? (
    <AgentAvatar
      kind={chat.provider}
      agent={openClawAgentId(chat.sessionId)}
      className="size-3.5"
    />
  ) : (
    <AgentAvatar className="size-3.5" />
  );
}
