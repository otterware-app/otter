import { useEffect, useRef, useState } from "react";

import { BrowserTabIcon } from "@otter/browser/ui/browser-view";
import { useBrowser, type BrowserTab } from "@otter/browser/ui/store";
import { hostOf } from "@otter/client/web-address";
import { cn } from "@otter/ui/lib/utils";

export type Switching = { order: string[]; index: number };

/** ⌃Tab's strip of the tabs, most recently used first (Aside's): the one picked is ringed. */
export function TabSwitcher({
  switching,
  onPick,
}: {
  switching: Switching;
  onPick: (index: number) => void;
}) {
  const all = useBrowser((s) => s.tabs);
  const tabs = switching.order
    .map((id) => all.find((tab) => tab.id === id))
    .filter((tab): tab is BrowserTab => Boolean(tab));
  const [thumbnails, setThumbnails] = useState<Record<number, string | null>>({});
  const ids = tabs.flatMap((tab) => (tab.pageId === undefined ? [] : [tab.pageId]));
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

  return (
    <div
      ref={strip}
      tabIndex={-1}
      className="absolute inset-0 z-30 flex items-center justify-center p-6 outline-none"
    >
      <div className="flex max-h-full max-w-full flex-wrap justify-center gap-1 overflow-y-auto rounded-2xl border border-border bg-popover/95 p-2 shadow-xl backdrop-blur [scrollbar-width:none]">
        {tabs.map((tab, i) => {
          const thumbnail = tab.pageId === undefined ? null : thumbnails[tab.pageId];
          return (
            <div
              key={tab.id}
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
                  <span className="scale-150">
                    <BrowserTabIcon tab={tab} />
                  </span>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-foreground">
                <BrowserTabIcon tab={tab} />
                <span className="truncate">
                  {tab.title || (tab.url ? hostOf(tab.url) : "New tab")}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
