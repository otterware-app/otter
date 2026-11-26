import { useEffect } from "react";
import { create } from "zustand";

import { hostOf } from "@otter/client/web-address";
import { uiHost } from "./host";
import { desktopBridge } from "./bridge";

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  /** The chat it's in, when it's a chat's (an agent opened or took it), and its tab there. */
  chatId?: string;
  chatTabId?: string;
  /** Kept running off screen: a page an agent works in while nobody looks at it. */
  keep?: boolean;
  /** Its page's WebContents id, once it has one (not kept across launches). */
  pageId?: number;
  /** An agent is acting in it now. */
  working?: boolean;
  /** Asked for by the main process (an extension, an agent), which waits to hear the page's id. */
  requestId?: string;
};

export type OpenLinksIn = "app" | "browser";

type BrowserState = {
  tabs: BrowserTab[];
  activeId: string | null;
  revealed: number;
  addressFocus: { tabId: string; seq: number } | null;
  openLinksIn: OpenLinksIn;
  pinned: string[];
  extensionsButton: boolean;
};

const TABS_KEY = "gmail:browser-tabs";
const LINKS_KEY = "gmail:browser-open-links";
const PINNED_KEY = "gmail:browser-pinned";
const EXTENSIONS_BUTTON_KEY = "gmail:browser-extensions-button";

function savedPinned(): string[] {
  try {
    const pinned: unknown = JSON.parse(localStorage.getItem(PINNED_KEY) ?? "[]");
    return Array.isArray(pinned) ? pinned.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/";

function savedTabs(): Pick<BrowserState, "tabs" | "activeId"> {
  try {
    const saved = JSON.parse(localStorage.getItem(TABS_KEY) ?? "") as {
      tabs?: {
        id?: unknown;
        url?: unknown;
        title?: unknown;
        favicon?: unknown;
        chatId?: unknown;
        chatTabId?: unknown;
      }[];
      activeId?: unknown;
    };
    const tabs = (saved.tabs ?? []).flatMap((tab) =>
      typeof tab.id === "string" && typeof tab.url === "string"
        ? [
            {
              id: tab.id,
              url: tab.url,
              title: typeof tab.title === "string" ? tab.title : "",
              favicon: typeof tab.favicon === "string" ? tab.favicon : null,
              loading: false,
              ...(typeof tab.chatId === "string" ? { chatId: tab.chatId } : {}),
              ...(typeof tab.chatTabId === "string" ? { chatTabId: tab.chatTabId } : {}),
            },
          ]
        : [],
    );
    const activeId = tabs.find((tab) => tab.id === saved.activeId)?.id ?? null;
    return { tabs, activeId };
  } catch {
    return { tabs: [], activeId: null };
  }
}

export const useBrowser = create<BrowserState>(() => ({
  ...savedTabs(),
  revealed: 0,
  addressFocus: null,
  openLinksIn: localStorage.getItem(LINKS_KEY) === "browser" ? "browser" : "app",
  pinned: savedPinned(),
  extensionsButton: localStorage.getItem(EXTENSIONS_BUTTON_KEY) !== "0",
}));

useBrowser.subscribe((state, prev) => {
  if (state.tabs === prev.tabs && state.activeId === prev.activeId) return;
  const tabs = state.tabs.map(({ id, url, title, favicon, chatId, chatTabId }) => ({
    id,
    url,
    title,
    favicon,
    chatId,
    chatTabId,
  }));
  localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeId: state.activeId }));
});

// Main asks whose a page is before an agent works in it: a page no chat owns is the user's.
let ownersSent = "[]";
useBrowser.subscribe((state) => {
  const owners = state.tabs.flatMap((t) =>
    t.chatId && t.pageId !== undefined ? [[t.pageId, t.chatId]] : [],
  );
  const sent = JSON.stringify(owners);
  if (sent === ownersSent) return;
  ownersSent = sent;
  void desktopBridge()
    .invoke("browser:owners", owners)
    .catch(() => {});
});

const { getState: get, setState: set } = useBrowser;

function blankTab(url: string): BrowserTab {
  return {
    id: crypto.randomUUID(),
    url,
    title: url ? hostOf(url) : "",
    favicon: null,
    loading: false,
  };
}

export const panelTabs = (tabs: BrowserTab[]) => tabs.filter((tab) => !tab.chatId);

export const chatPageId = (chatId: string, tabId: string) => `${chatId}|${tabId}`;

/** The page showing a chat's tab: made for it, or one the chat took from the user's tabs. */
export const chatPage = (tabs: BrowserTab[], chatId: string, chatTabId: string) =>
  tabs.find(
    (tab) =>
      tab.chatId === chatId &&
      (tab.chatTabId === chatTabId || tab.id === chatPageId(chatId, chatTabId)),
  );

export function ensureChatPage(chatId: string, tabId: string, url: string, title: string): void {
  if (chatPage(get().tabs, chatId, tabId)) return;
  const id = chatPageId(chatId, tabId);
  set((s) => ({ tabs: [...s.tabs, { ...blankTab(url), id, title, chatId, chatTabId: tabId }] }));
}

export function closeChatPage(chatId: string, tabId: string): void {
  const page = chatPage(get().tabs, chatId, tabId);
  if (page) set((s) => ({ tabs: s.tabs.filter((tab) => tab !== page) }));
}

/** A page an agent opened for its chat: the chat's tab, the page waiting for main to hear its id. */
function openForChat(chatId: string, url: string, requestId: string): void {
  const chatTabId = uiHost().addChatPage?.(chatId, { url, title: hostOf(url) });
  // No such chat here: the user's tabs, rather than nowhere.
  if (!chatTabId) {
    openTab(url, { requestId });
    return;
  }
  set((s) => ({
    tabs: [
      ...s.tabs,
      {
        ...blankTab(url),
        id: chatPageId(chatId, chatTabId),
        chatId,
        chatTabId,
        keep: true,
        requestId,
      },
    ],
  }));
}

/** One of the user's tabs, given to a chat: the same page (signed in, filled in), the chat's now. */
export function giveToChat(id: string, chatId: string): void {
  const tab = get().tabs.find((t) => t.id === id);
  if (!tab || tab.chatId) return;
  const chatTabId = uiHost().addChatPage?.(chatId, { url: tab.url, title: tab.title });
  if (!chatTabId) return;
  updateTab(id, { chatId, chatTabId, keep: true });
}

/** A chat's page, made one of the user's tabs: the chat keeps no tab for it. */
export function giveBack(id: string): void {
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === id ? { ...t, chatId: undefined, chatTabId: undefined, keep: undefined } : t,
    ),
  }));
}

const idle = new Map<number, ReturnType<typeof setTimeout>>();

/** Held a moment after the agent's last command, so a run of them reads as one. */
function agentWorking(pageId: number, working: boolean): void {
  clearTimeout(idle.get(pageId));
  idle.delete(pageId);
  const mark = (on: boolean) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.pageId === pageId ? { ...t, working: on } : t)) }));
  if (working) mark(true);
  else
    idle.set(
      pageId,
      setTimeout(() => mark(false), 1500),
    );
}

export function closeChatPages(chatId: string): void {
  set((s) => ({ tabs: s.tabs.filter((tab) => tab.chatId !== chatId) }));
}

export function openTab(
  url: string,
  { background = false, requestId }: { background?: boolean; requestId?: string } = {},
): void {
  const tab = { ...blankTab(url), ...(requestId ? { requestId } : {}) };
  set((s) => {
    const at = s.tabs.findIndex((t) => t.id === s.activeId);
    const tabs = at < 0 ? [...s.tabs, tab] : s.tabs.toSpliced(at + 1, 0, tab);
    return background ? { tabs } : { tabs, activeId: tab.id, revealed: s.revealed + 1 };
  });
}

export function newTab(): void {
  const tab = blankTab("");
  set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id, revealed: s.revealed + 1 }));
}

export function focusAddress(): void {
  const tabId = get().activeId;
  if (!tabId) {
    newTab();
    return;
  }
  set((s) => ({
    revealed: s.revealed + 1,
    addressFocus: { tabId, seq: (s.addressFocus?.seq ?? 0) + 1 },
  }));
}

export function selectTab(id: string | null): void {
  set({ activeId: id });
}

export function closeTab(id: string): void {
  set((s) => {
    const closing = s.tabs.find((tab) => tab.id === id);
    if (!closing) return s;
    const tabs = s.tabs.filter((tab) => tab !== closing);
    if (s.activeId !== id) return { tabs };
    const panel = panelTabs(s.tabs);
    const at = panel.indexOf(closing);
    return { tabs, activeId: (panel[at - 1] ?? panel[at + 1])?.id ?? null };
  });
}

export function reorderTabs(order: string[]): void {
  set((s) => ({
    tabs: [
      ...order.flatMap((id) => s.tabs.filter((tab) => tab.id === id && !tab.chatId)),
      ...s.tabs.filter((tab) => tab.chatId || !order.includes(tab.id)),
    ],
  }));
}

export function updateTab(id: string, patch: Partial<Omit<BrowserTab, "id">>): void {
  set((s) => ({ tabs: s.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)) }));
}

export function setPinned(id: string, pinned: boolean): void {
  set((s) => {
    const next = pinned
      ? [...s.pinned.filter((each) => each !== id), id]
      : s.pinned.filter((each) => each !== id);
    localStorage.setItem(PINNED_KEY, JSON.stringify(next));
    return { pinned: next };
  });
}

export function setExtensionsButton(shown: boolean): void {
  localStorage.setItem(EXTENSIONS_BUTTON_KEY, shown ? "1" : "0");
  set({ extensionsButton: shown });
}

export function setOpenLinksIn(value: OpenLinksIn): void {
  localStorage.setItem(LINKS_KEY, value);
  set({ openLinksIn: value });
}

/** Where in-app links go instead of the panel while the AI workspace shows: the chat's tabs. */
let linkHandler: ((url: string) => void) | null = null;

export function routeLinks(handler: ((url: string) => void) | null): void {
  linkHandler = handler;
}

/**
 * A link from mail or chat: a tab in the browser panel (Mac), or in the AI
 * workspace the chat's own, unless Settings › Browser says otherwise.
 * ⌘-click (`flip`) opens it the other way.
 */
export function openLink(url: string, { flip = false } = {}): void {
  const inApp = (get().openLinksIn === "app") !== flip;
  if (uiHost().enabled && /^https?:/i.test(url) && inApp) {
    if (linkHandler) linkHandler(url);
    else openTab(url);
    return;
  }
  void desktopBridge()
    .openExternal(url)
    .catch(() => {});
}

/**
 * Electron's `<webview>` reports this when its element goes after its page did
 * (a tab or the panel closing): nothing's wrong, and it mustn't crowd the
 * support report's renderer errors out.
 */
function quietDetachError(event: ErrorEvent): void {
  if (!/Invalid guestInstanceId/.test(event.message)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

export function useBrowserEvents(): void {
  useEffect(() => {
    if (!uiHost().enabled) return;
    window.addEventListener("error", quietDetachError, true);
    const offs = [
      desktopBridge().on("browser:openTab", (params) => {
        const { url, background, requestId, chatId } = params as {
          url: string;
          background?: boolean;
          requestId?: string;
          chatId?: string;
        };
        if (chatId && requestId) openForChat(chatId, url, requestId);
        else if (linkHandler && !requestId) linkHandler(url);
        else openTab(url, { background, requestId });
      }),
      desktopBridge().on("browser:takeTab", (params) => {
        const { webContentsId, chatId } = params as { webContentsId: number; chatId: string };
        const tab = get().tabs.find((t) => t.pageId === webContentsId);
        if (tab) giveToChat(tab.id, chatId);
      }),
      desktopBridge().on("browser:agentWorking", (params) => {
        const { webContentsId, working } = params as { webContentsId: number; working: boolean };
        agentWorking(webContentsId, working);
      }),
      desktopBridge().on("browser:newTab", newTab),
      desktopBridge().on("browser:focusAddress", focusAddress),
    ];
    return () => {
      window.removeEventListener("error", quietDetachError, true);
      offs.forEach((off) => off());
    };
  }, []);
}
