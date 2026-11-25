import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { BrowserPage } from "./browser-view";
import { useBrowser, type BrowserTab } from "./store";
import { cn } from "@otter/ui/lib/utils";

type Rect = { top: number; left: number; width: number; height: number };
type Surface = { rect: Rect; clip: string | undefined; visible: boolean; className?: string };

const useSurfaces = create<Record<string, Surface>>(() => ({}));

useBrowser.subscribe((state, prev) => {
  if (state.tabs === prev.tabs) return;
  const open = new Set(state.tabs.map((tab) => tab.id));
  const surfaces = Object.entries(useSurfaces.getState());
  if (surfaces.every(([id]) => open.has(id))) return;
  useSurfaces.setState(Object.fromEntries(surfaces.filter(([id]) => open.has(id))), true);
});

const sameRect = (a: Rect, b: Rect) =>
  a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;

function present(tabId: string, surface: Surface) {
  const current = useSurfaces.getState()[tabId];
  if (
    current?.visible === surface.visible &&
    current.className === surface.className &&
    current.clip === surface.clip &&
    sameRect(current.rect, surface.rect)
  )
    return;
  useSurfaces.setState({ [tabId]: surface });
}

/**
 * Where a panel shows a page. The page itself is drawn by PageHost, laid over this; a webview
 * taken out of the document (a panel closing, a chat or mode left) loads its page over again.
 */
export function PageSlot({ tabId, className }: { tabId: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The page is laid over the slot, outside the frame a sliding panel clips its card with.
    const frame = el.closest("[data-page-clip]");
    const measure = () => {
      const { top, left, width, height, right, bottom } = el.getBoundingClientRect();
      const box = frame?.getBoundingClientRect();
      const clip =
        box && (box.left > left || box.right < right || box.top > top || box.bottom < bottom)
          ? `inset(${Math.max(0, box.top - top)}px ${Math.max(0, right - box.right)}px ${Math.max(0, bottom - box.bottom)}px ${Math.max(0, box.left - left)}px)`
          : undefined;
      present(tabId, {
        rect: { top, left, width, height },
        clip,
        visible: width > 0 && height > 0,
        className,
      });
    };
    measure();
    // Before the next paint, so the page never trails its panel by a frame.
    const update = () => flushSync(measure);
    // Panes move and resize around the slot (sidebar, list, the calendar panel, animations)
    // without resizing it: a sibling's resize is what moves it.
    const observer = new ResizeObserver(update);
    const observeAround = () => {
      for (let node: Element | null = el; node; node = node.parentElement) {
        observer.observe(node);
        for (const sibling of node.parentElement?.children ?? []) observer.observe(sibling);
      }
    };
    observeAround();
    // A pane mounted later (a panel opening) moves it too.
    const added = new MutationObserver(() => {
      observeAround();
      update();
    });
    for (let node = el.parentElement; node; node = node.parentElement)
      added.observe(node, { childList: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      added.disconnect();
      window.removeEventListener("resize", update);
      const current = useSurfaces.getState()[tabId];
      if (current) useSurfaces.setState({ [tabId]: { ...current, visible: false } });
    };
  }, [tabId, className]);
  return <div ref={ref} aria-hidden className="pointer-events-none min-h-0 flex-1" />;
}

/**
 * Every page that's been shown, mounted once for the app's life (T3 Code's
 * ElectronBrowserHost). Their order is the tabs' ids, never the strip's: Electron reloads a
 * webview moved in the document.
 */
export function PageHost() {
  const tabs = useBrowser(
    useShallow((s) => s.tabs.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))),
  );
  const presented = useSurfaces(useShallow((s) => Object.keys(s)));
  return tabs.map((tab) =>
    presented.includes(tab.id) || tab.keep ? <HostedPage key={tab.id} tab={tab} /> : null,
  );
}

function HostedPage({ tab }: { tab: BrowserTab }) {
  const surface = useSurfaces((s) => s[tab.id]) ?? (tab.keep ? UNSEEN : undefined);
  if (!surface) return null;
  return (
    <div
      data-browser-page=""
      inert={!surface.visible}
      className={cn("fixed z-10 flex flex-col overflow-hidden bg-canvas", surface.className)}
      style={
        surface.visible
          ? { ...surface.rect, clipPath: surface.clip }
          : { ...surface.rect, ...OFFSCREEN }
      }
    >
      <BrowserPage tab={tab} active={surface.visible} />
    </div>
  );
}

/**
 * Where a page that isn't showing waits: off to the side at its last size, so nothing reflows,
 * and Electron stops drawing it. A macOS webview hidden outright can come back blank.
 */
/** A page an agent works in that no panel has shown yet: a laptop's window, off to the side. */
const UNSEEN: Surface = {
  rect: { top: 0, left: 0, width: 1280, height: 800 },
  clip: undefined,
  visible: false,
};

const OFFSCREEN: CSSProperties = { top: -100_000, left: -100_000, pointerEvents: "none" };
