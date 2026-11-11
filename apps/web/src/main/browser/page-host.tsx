import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { flushSync } from "react-dom";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { cn } from "../mail/ui";
import { BrowserPage } from "./browser-view";
import { useBrowser, type BrowserTab } from "./store";

type Rect = { top: number; left: number; width: number; height: number };
type Surface = { rect: Rect; visible: boolean; className?: string };

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
    const measure = () => {
      const { top, left, width, height } = el.getBoundingClientRect();
      present(tabId, {
        rect: { top, left, width, height },
        visible: width > 0 && height > 0,
        className,
      });
    };
    measure();
    // Before the next paint, so the page never trails its panel by a frame.
    const update = () => flushSync(measure);
    // Panes move and resize around the slot (sidebar, list, animations) without resizing it.
    const observed: Element[] = [];
    for (let node: Element | null = el; node; node = node.parentElement) observed.push(node);
    const observer = new ResizeObserver(update);
    for (const node of observed) observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
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
    presented.includes(tab.id) ? <HostedPage key={tab.id} tab={tab} /> : null,
  );
}

function HostedPage({ tab }: { tab: BrowserTab }) {
  const surface = useSurfaces((s) => s[tab.id]);
  if (!surface) return null;
  return (
    <div
      data-browser-page=""
      inert={!surface.visible}
      className={cn("fixed z-10 flex flex-col overflow-hidden bg-canvas", surface.className)}
      style={surface.visible ? surface.rect : { ...surface.rect, ...OFFSCREEN }}
    >
      <BrowserPage tab={tab} active={surface.visible} />
    </div>
  );
}

/**
 * Where a page that isn't showing waits: off to the side at its last size, so nothing reflows,
 * and Electron stops drawing it. A macOS webview hidden outright can come back blank.
 */
const OFFSCREEN: CSSProperties = { top: -100_000, left: -100_000, pointerEvents: "none" };
