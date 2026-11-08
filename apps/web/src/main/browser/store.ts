import { useEffect } from "react";
import { create } from "zustand";

import { features } from "../features";

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  loading: boolean;
  chatId?: string;
  /** Shared with OpenClaw: its agent sees and works in it. Not kept past a relaunch. */
  shared?: boolean;
  /** Its page's webContents, once it has one. */
  pageId?: number;
  /** A tab OpenClaw's agent opened: the request its page answers once shared. */
  shareRequest?: string;
};

/** Where sharing tabs with OpenClaw stands (`apps/desktop/src/services/tab-sharing.ts`). */
export type Sharing = { status: "off" | "connecting" | "on" | "offline"; error?: string };

export type OpenLinksIn = "app" | "browser";

type BrowserState = {
  tabs: BrowserTab[];
  activeId: string | null;
  revealed: number;
  addressFocus: { tabId: string; seq: number } | null;
  openLinksIn: OpenLinksIn;
  pinned: string[];
  extensionsButton: boolean;
  sharing: Sharing;
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
  sharing: { status: "off" },
}));

useBrowser.subscribe((state, prev) => {
  if (state.tabs === prev.tabs && state.activeId === prev.activeId) return;
  const tabs = state.tabs.map(({ id, url, title, favicon, chatId }) => ({
    id,
    url,
    title,
    favicon,
    chatId,
  }));
  localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeId: state.activeId }));
});

const { getState: get, setState: set } = useBrowser;

export function hostOf(url: string): string {
  return URL.parse(url)?.host.replace(/^www\./, "") ?? url;
}

export function addressToUrl(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  if (/^(https?|chrome-extension):\/\//i.test(text)) return text;
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?$/i.test(text)) return `http://${text}`;
  if (/^[^\s/:]+\.[a-z]{2,}(:\d+)?(\/\S*)?$/i.test(text)) return `https://${text}`;
  return `https://www.google.com/search?q=${encodeURIComponent(text)}`;
}

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

export function ensureChatPage(
  chatId: string,
  tabId: string,
  url: string,
  title: string,
  shareRequest?: string,
): void {
  const id = chatPageId(chatId, tabId);
  if (get().tabs.some((tab) => tab.id === id)) return;
  const shared = shareRequest ? { shared: true, shareRequest } : {};
  set((s) => ({ tabs: [...s.tabs, { ...blankTab(url), id, title, chatId, ...shared }] }));
}

export function closeChatPage(chatId: string, tabId: string): void {
  const id = chatPageId(chatId, tabId);
  set((s) => ({ tabs: s.tabs.filter((tab) => tab.id !== id) }));
}

export function closeChatPages(chatId: string): void {
  set((s) => ({ tabs: s.tabs.filter((tab) => tab.chatId !== chatId) }));
}

export function openTab(
  url: string,
  { background = false, shareRequest }: { background?: boolean; shareRequest?: string } = {},
): void {
  const tab = { ...blankTab(url), ...(shareRequest && { shared: true, shareRequest }) };
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
  if (id && get().tabs.find((tab) => tab.id === id)?.chatId) return;
  set({ activeId: id });
}

export function closeTab(id: string): void {
  set((s) => {
    const closing = s.tabs.find((tab) => tab.id === id);
    if (!closing) return s;
    const tabs = s.tabs.filter((tab) => tab !== closing);
    if (closing.chatId || s.activeId !== id) return { tabs };
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

/** Shares a tab with OpenClaw now, as its page shows it; false when that didn't work. */
export async function shareBrowserTab(id: string): Promise<boolean> {
  const tab = get().tabs.find((t) => t.id === id);
  if (!tab) return false;
  updateTab(id, { shared: true });
  if (tab.pageId === undefined) return false;
  return window.desktopBridge
    .invoke("browser:share", { webContentsId: tab.pageId, share: true })
    .then(
      () => true,
      () => false,
    );
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
/** `shareRequest`: a tab OpenClaw's agent opened, shared with it once it loads. */
type LinkHandler = (url: string, shareRequest?: string) => void;
let linkHandler: LinkHandler | null = null;

export function routeLinks(handler: LinkHandler | null): void {
  linkHandler = handler;
}

/** Shows a tab a chat was sent: your tab itself while it's open, else its page. */
export function showBrowserPage(target: { url: string; tab?: string }): void {
  const tab = target.tab ? get().tabs.find((t) => t.id === target.tab && !t.chatId) : undefined;
  if (tab && !linkHandler) set((s) => ({ activeId: tab.id, revealed: s.revealed + 1 }));
  else openLink(target.url);
}

/** Whether links go to the AI workspace's chat instead of the browser panel. */
export const linksRouted = () => linkHandler !== null;

/**
 * A link from mail or chat: a tab in the browser panel (Mac), or in the AI
 * workspace the chat's own, unless Settings › Browser says otherwise.
 * ⌘-click (`flip`) opens it the other way.
 */
export function openLink(url: string, { flip = false } = {}): void {
  const inApp = (get().openLinksIn === "app") !== flip;
  if (features.browser && /^https?:/i.test(url) && inApp) {
    if (linkHandler) linkHandler(url);
    else openTab(url);
    return;
  }
  void window.desktopBridge.openExternal(url).catch(() => {});
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
    if (!features.browser) return;
    window.addEventListener("error", quietDetachError, true);
    const offs = [
      window.desktopBridge.on("browser:openTab", (params) => {
        const { url, background, share } = params as {
          url: string;
          background?: boolean;
          share?: string;
        };
        if (linkHandler) linkHandler(url, share);
        else openTab(url, { background: background && !share, shareRequest: share });
      }),
      window.desktopBridge.on("browser:newTab", newTab),
      window.desktopBridge.on("browser:focusAddress", focusAddress),
      window.desktopBridge.on("browser:sharing", (params) => {
        const { status, error } = params as Sharing;
        set({ sharing: { status, error } });
      }),
    ];
    return () => {
      window.removeEventListener("error", quietDetachError, true);
      offs.forEach((off) => off());
    };
  }, []);
}
