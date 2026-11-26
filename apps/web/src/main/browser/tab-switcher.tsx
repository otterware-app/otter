import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BrowserTabIcon } from "@otter/browser/ui/browser-view";
import { useBrowser, type BrowserTab } from "@otter/browser/ui/store";
import { hostOf } from "@otter/client/web-address";
import { cn } from "@otter/ui/lib/utils";

export type Switching = { order: string[]; index: number };

/** Full view's home tab (Mail…), in the order with the pages. */
export const HOME = "home";

/** ⌃Tab's strip of the tabs, most recently used first (Aside's): the one picked is ringed. */
export function TabSwitcher({
  switching,
  onPick,
  home,
}: {
  switching: Switching;
  onPick: (index: number) => void;
  home?: { title: string; icon: ReactNode };
}) {
  const all = useBrowser((s) => s.tabs);
  const tabs = switching.order.flatMap((id): (BrowserTab | typeof HOME)[] => {
    if (id === HOME) return home ? [HOME] : [];
    const tab = all.find((t) => t.id === id);
    return tab ? [tab] : [];
  });
  const [thumbnails, setThumbnails] = useState<Record<number, string | null>>({});
  const ids = tabs.flatMap((tab) => (tab === HOME || tab.pageId === undefined ? [] : [tab.pageId]));
  const key = ids.join(",");
  useEffect(() => {
    void window.desktopBridge
      .invoke<Record<number, string | null>>(
        "browser:thumbnails",
        key ? key.split(",").map(Number) : [],
      )
      .then(setThumbnails);
  }, [key]);

  // Focus leaves the page, so ⌃'s release is the app's to hear (macOS keeps it from a page's).
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => strip.current?.focus(), []);

  // Over the window, not the panel: in full view the home tab may be the one shown.
  return createPortal(
    <div
      ref={strip}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-6 outline-none"
    >
      <div className="flex max-h-full max-w-[min(100%,60rem)] flex-wrap justify-center gap-1 overflow-y-auto rounded-2xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur [scrollbar-width:none]">
        {tabs.map((tab, i) => {
          const thumbnail =
            tab === HOME || tab.pageId === undefined ? null : thumbnails[tab.pageId];
          const icon = tab === HOME ? home!.icon : <BrowserTabIcon tab={tab} />;
          const title =
            tab === HOME ? home!.title : tab.title || (tab.url ? hostOf(tab.url) : "New tab");
          return (
            <div
              key={tab === HOME ? HOME : tab.id}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(i);
              }}
              className={cn(
                "flex w-36 shrink-0 cursor-default flex-col gap-1.5 rounded-xl p-1.5 hover:bg-foreground/[0.05]",
                i === switching.index && "bg-foreground/[0.08]",
              )}
            >
              <div className="flex aspect-[16/10] items-center justify-center overflow-hidden rounded-lg bg-foreground/[0.05]">
                {thumbnail ? (
                  <img
                    src={thumbnail}
                    alt=""
                    className="size-full bg-white object-cover object-top"
                  />
                ) : (
                  <span className="scale-150">{icon}</span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
                {icon}
                <span className="truncate">{title}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
