/**
 * The window's tabs (Linear's), across its top in the desktop app: each is a
 * place in the app (a mailbox's folder, a conversation, a chat, Settings),
 * kept as the route that brings it back and named as Recently viewed names
 * it. Moving around moves the tab showing; another tab is another place to
 * come back to. This device's own, like a browser's tabs: localStorage.
 */

import { PlusIcon } from "lucide-react";
import { create } from "zustand";

import { AgentIcon } from "./mail/agent-icon";
import { AgentAvatar, openClawAgentId } from "./mail/agent-providers";
import { isBlank, useChats } from "./mail/chat-store";
import { PanelTab } from "./mail/panel-tab";
import { HistoryControls, RECENT_ICONS } from "./mail/top-bar";
import { HintTooltip, IconBtn, cn } from "./mail/ui";
import { usePanelTabDrag } from "./mail/use-panel-tab-drag";
import type { RecentIcon } from "./recently-viewed";

export type WindowTab = {
  id: string;
  /** The router location it shows. */
  href: string;
  title: string;
  icon: RecentIcon;
};

type State = { tabs: WindowTab[]; activeId: string };

const KEY = "otter:window-tabs";

function load(): State {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as State | null;
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      const activeId = saved.tabs.some((t) => t.id === saved.activeId)
        ? saved.activeId
        : saved.tabs[0]!.id;
      return { tabs: saved.tabs, activeId };
    }
  } catch {
    // Broken tabs start over.
  }
  return { tabs: [], activeId: "" };
}

export const useWindowTabs = create<State>(() => load());

function set(update: (s: State) => State): void {
  const next = update(useWindowTabs.getState());
  useWindowTabs.setState(next, true);
  localStorage.setItem(KEY, JSON.stringify(next));
}

const newTabFor = (href: string): WindowTab => ({
  id: crypto.randomUUID(),
  href,
  title: "",
  icon: "inbox",
});

/** The tab showing goes where the window went (the first tab is made here). */
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

/** Names the tab showing `href`, once what it shows is known. */
export function nameTab(href: string, title: string, icon: RecentIcon): void {
  set((s) => {
    const tab = s.tabs.find((t) => t.href === href && t.id === s.activeId);
    if (!tab || (tab.title === title && tab.icon === icon)) return s;
    return { ...s, tabs: s.tabs.map((t) => (t === tab ? { ...t, title, icon } : t)) };
  });
}

/** A new tab at `href`, after the one showing; it shows. */
export function addTab(href: string): void {
  set((s) => {
    const tab = newTabFor(href);
    const at = s.tabs.findIndex((t) => t.id === s.activeId);
    const tabs = [...s.tabs];
    tabs.splice(at + 1, 0, tab);
    return { tabs, activeId: tab.id };
  });
}

/** Shows a tab; its place, to go to. */
export function selectTab(id: string): string | null {
  const tab = useWindowTabs.getState().tabs.find((t) => t.id === id);
  if (!tab) return null;
  set((s) => ({ ...s, activeId: id }));
  return tab.href;
}

/**
 * Closes a tab (never the last); closing the one showing shows the one after
 * it (or before, for the last), whose place is returned to go to.
 */
export function closeTab(id: string): string | null {
  const { tabs, activeId } = useWindowTabs.getState();
  const at = tabs.findIndex((t) => t.id === id);
  if (at < 0 || tabs.length < 2) return null;
  const rest = tabs.filter((t) => t.id !== id);
  const next = id === activeId ? (rest[Math.min(at, rest.length - 1)] ?? null) : null;
  set(() => ({ tabs: rest, activeId: next ? next.id : activeId }));
  return next?.href ?? null;
}

function reorderTabs(order: string[]): void {
  set((s) => ({
    ...s,
    tabs: order.flatMap((id) => s.tabs.find((t) => t.id === id) ?? []),
  }));
}

/**
 * The strip across the window's top (Linear's): the tabs start where the
 * columns do, past the sidebar, with history just before them; short of the
 * browser toggle (and Linux's window controls).
 */
export function WindowTabsBar({
  sidebarOpen,
  onSelect,
  onClose,
  onNew,
}: {
  /** The columns start at the sidebar's edge (home-view's --workspace-sidebar-width), or with it hidden after the controls. */
  sidebarOpen: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  const tabs = useWindowTabs((s) => s.tabs);
  const activeId = useWindowTabs((s) => s.activeId);
  const { ref, draggingId, handlers } = usePanelTabDrag(reorderTabs);
  return (
    <div className="drag-region flex h-(--workspace-topbar-height) shrink-0 items-center gap-1 pr-[calc(var(--workspace-controls-right)+var(--workspace-titlebar-control-size)+0.5rem)]">
      {/* Room for the traffic lights and the sidebar toggle, at least; history at its end. */}
      <div
        style={{
          width: `max(calc(var(--workspace-titlebar-content-left) + var(--workspace-history-controls-width) + 0.25rem), ${sidebarOpen ? "calc(var(--workspace-sidebar-width) + var(--workspace-frame-inset))" : "0px"})`,
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
        {tabs.map((tab) => {
          const Icon = RECENT_ICONS[tab.icon] ?? AgentIcon;
          const chatId = tab.icon === "chat" ? tab.href.match(/\/chats\/([^/?#]+)/)?.[1] : null;
          return (
            <PanelTab
              key={tab.id}
              id={tab.id}
              title={tab.title || "…"}
              selected={tab.id === activeId}
              dragging={draggingId === tab.id}
              closable={tabs.length > 1}
              onSelect={() => onSelect(tab.id)}
              onClose={() => onClose(tab.id)}
              icon={chatId ? <ChatTabIcon chatId={chatId} /> : <Icon className="size-3.5" />}
              // Each a pill, the others fainter (Linear's).
              className={cn("w-52 max-w-52", tab.id !== activeId && "bg-foreground/[0.04]")}
            />
          );
        })}
      </div>
      <HintTooltip label="New tab" side="bottom">
        <IconBtn label="New tab" className="no-drag" onClick={onNew}>
          <PlusIcon className="size-4" />
        </IconBtn>
      </HintTooltip>
    </div>
  );
}

/** A chat's tab shows who it talks to. */
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
