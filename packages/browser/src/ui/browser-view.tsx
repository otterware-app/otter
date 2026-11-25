import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  GlobeIcon,
  LockIcon,
  PuzzleIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { toast } from "@otter/ui/components/toast";
import { addressToUrl, hostOf } from "@otter/client/web-address";
import { ExtensionToolbar } from "./extension-toolbar";
import { PermissionPrompt } from "./permission-prompt";
import {
  DownloadsButton,
  HistoryDialog,
  PageMenu,
  useSuggestions,
  type PageView,
} from "./page-tools";
import {
  CHROME_WEB_STORE_URL,
  closeTab,
  openTab,
  selectTab,
  updateTab,
  useBrowser,
  type BrowserTab,
} from "./store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { Button, IconButton } from "@otter/ui/components/button";
import { Spinner } from "@otter/ui/components/spinner";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { cn } from "@otter/ui/lib/utils";
import { uiHost } from "./host";
import { desktopBridge } from "./bridge";

type Webview = HTMLElement & {
  getWebContentsId(): number;
  loadURL(url: string): Promise<void>;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  openDevTools(): void;
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number;
  stopFindInPage(action: "clearSelection" | "keepSelection" | "activateSelection"): void;
};

const PARTITION = "persist:browser";

const SUGGESTED = [
  { name: "Google", url: "https://www.google.com/" },
  { name: "YouTube", url: "https://www.youtube.com/" },
  { name: "Otter Drive", url: "https://drive.otterware.app/" },
  { name: "Chrome Web Store", url: CHROME_WEB_STORE_URL },
];

export function faviconFor(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostOf(url))}&sz=64`;
}

export function BrowserTabIcon({ tab }: { tab: BrowserTab }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (tab.loading) return <Spinner className="size-3.5 text-current" />;
  if (tab.favicon && failed !== tab.favicon) {
    return (
      <img
        src={tab.favicon}
        alt=""
        draggable={false}
        className="size-3.5 rounded-sm"
        onError={() => setFailed(tab.favicon)}
      />
    );
  }
  return <GlobeIcon className="size-3.5" />;
}

export function BrowserPage({ tab, active }: { tab: BrowserTab; active: boolean }) {
  const [view, setView] = useState<Webview | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The address the page opens at; later ones go through loadURL (a new src
  // attribute would load the page over again).
  const [src, setSrc] = useState(tab.url);
  const [history, setHistory] = useState({ back: false, forward: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [crashed, setCrashed] = useState(false);
  const [find, setFind] = useState<number | null>(null);
  const addressRequest = useBrowser((s) =>
    s.addressFocus?.tabId === tab.id ? s.addressFocus.seq : 0,
  );

  useEffect(() => {
    if (!view) return;
    let ready = false;
    // The page last shown: Chromium only reports a favicon that changed, so
    // the tab drops its icon only for another site's page.
    let shown = "";
    const sync = () => {
      if (ready) setHistory({ back: view.canGoBack(), forward: view.canGoForward() });
    };
    const on: Record<string, (event: Event & Record<string, unknown>) => void> = {
      "dom-ready": () => {
        ready = true;
        setPageId(view.getWebContentsId());
        sync();
      },
      "did-start-loading": () => {
        setFailure(null);
        setCrashed(false);
        updateTab(tab.id, { loading: true });
      },
      "did-stop-loading": () => {
        updateTab(tab.id, { loading: false });
        sync();
      },
      "did-navigate": (e) => {
        const url = e.url as string;
        const otherSite = hostOf(shown) !== hostOf(url);
        shown = url;
        updateTab(tab.id, otherSite ? { url, title: hostOf(url), favicon: null } : { url });
        sync();
      },
      "did-navigate-in-page": (e) => {
        if (!e.isMainFrame) return;
        updateTab(tab.id, { url: e.url as string });
        sync();
      },
      "page-title-updated": (e) => updateTab(tab.id, { title: e.title as string }),
      "page-favicon-updated": (e) =>
        updateTab(tab.id, { favicon: (e.favicons as string[])[0] ?? null }),
      "did-fail-load": (e) => {
        // -3 is a load given up for another (a click before the page finished).
        if (!e.isMainFrame || e.errorCode === -3) return;
        setFailure((e.errorDescription as string) || "The page couldn't load.");
      },
      "render-process-gone": () => {
        setCrashed(true);
        updateTab(tab.id, { loading: false });
      },
    };
    for (const [name, listener] of Object.entries(on)) {
      view.addEventListener(name, listener as EventListener);
    }
    return () => {
      for (const [name, listener] of Object.entries(on)) {
        view.removeEventListener(name, listener as EventListener);
      }
      updateTab(tab.id, { loading: false });
    };
  }, [view, tab.id]);

  useEffect(() => {
    if (active && pageId !== null) void desktopBridge().invoke("browser:activeTab", pageId);
  }, [active, pageId]);
  useEffect(() => {
    if (pageId !== null) updateTab(tab.id, { pageId });
  }, [pageId, tab.id]);
  useEffect(() => {
    if (pageId === null || !tab.requestId) return;
    void desktopBridge().invoke("browser:tabCreated", {
      requestId: tab.requestId,
      webContentsId: pageId,
    });
    updateTab(tab.id, { requestId: undefined });
  }, [pageId, tab.id, tab.requestId]);
  useEffect(() => {
    if (pageId === null) return;
    const mine = (params: unknown) =>
      (params as { webContentsId?: number }).webContentsId === pageId;
    const offs = [
      desktopBridge().on("browser:selectTab", (params) => {
        if (mine(params)) selectTab(tab.id);
      }),
      desktopBridge().on("browser:closeTab", (params) => {
        if (mine(params)) closeTab(tab.id);
      }),
      desktopBridge().on("browser:find", (params) => {
        if (mine(params)) setFind((key) => (key ?? 0) + 1);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [pageId, tab.id]);

  const navigate = (url: string) => {
    updateTab(tab.id, { url });
    if (view) void view.loadURL(url).catch(() => {});
    else setSrc(url);
  };

  return (
    <>
      <div
        className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3"
        onKeyDown={(e) => {
          if (!view || !uiHost().isFindKey(e.nativeEvent)) return;
          e.preventDefault();
          e.stopPropagation();
          setFind((key) => (key ?? 0) + 1);
        }}
      >
        <div className="flex shrink-0 items-center rounded-pill bg-foreground/[0.06] p-0.5">
          <HintTooltip label="Back" hint={uiHost().shortcutText("mod+[")} side="bottom">
            <IconButton
              label="Back"
              className="rounded-pill"
              disabled={!history.back}
              onClick={() => view?.goBack()}
            >
              <ArrowLeftIcon className="size-4" />
            </IconButton>
          </HintTooltip>
          <HintTooltip label="Forward" hint={uiHost().shortcutText("mod+]")} side="bottom">
            <IconButton
              label="Forward"
              className="rounded-pill"
              disabled={!history.forward}
              onClick={() => view?.goForward()}
            >
              <ArrowRightIcon className="size-4" />
            </IconButton>
          </HintTooltip>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          {tab.loading ? (
            <HintTooltip label="Stop" side="bottom">
              <IconButton label="Stop" className="rounded-pill" onClick={() => view?.stop()}>
                <XIcon className="size-4" />
              </IconButton>
            </HintTooltip>
          ) : (
            <HintTooltip label="Reload" hint={uiHost().shortcutText("mod+r")} side="bottom">
              <IconButton
                label="Reload"
                className="rounded-pill"
                disabled={!view}
                onClick={() => view?.reload()}
              >
                <RotateCwIcon className="size-4" />
              </IconButton>
            </HintTooltip>
          )}
        </div>
        <AddressBar
          url={tab.url}
          focusRequest={active ? addressRequest : 0}
          onNavigate={navigate}
          onSiteDataCleared={() => view?.reload()}
        />
        {src ? <ExtensionToolbar /> : null}
        <DownloadsButton />
        <PageMenu
          url={tab.url}
          view={src ? (view as unknown as PageView | null) : null}
          onFind={() => setFind((key) => (key ?? 0) + 1)}
          onHistory={() => setHistoryOpen(true)}
        />
        {historyOpen ? <HistoryDialog onClose={() => setHistoryOpen(false)} /> : null}
      </div>
      <div className="relative flex min-h-0 flex-1 flex-col">
        {src ? (
          <webview
            ref={(node) => setView(node as Webview | null)}
            src={src}
            partition={PARTITION}
            // An attribute Electron reads as the page attaches; React drops a
            // boolean for it, so it's the string.
            {...({ allowpopups: "true" } as unknown as { allowpopups?: boolean })}
            className="flex min-h-0 flex-1 bg-white"
          />
        ) : (
          <StartPage onNavigate={navigate} />
        )}
        {src ? <PermissionPrompt pageId={pageId} /> : null}
        {view && find !== null ? (
          <div className="absolute top-3 right-3 z-10 w-72 max-w-[calc(100%-1.5rem)]">
            <PageFind
              view={view}
              focusKey={find}
              onClose={() => {
                setFind(null);
                view.focus();
              }}
            />
          </div>
        ) : null}
        {failure || crashed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas p-6 text-center">
            <TriangleAlertIcon className="mb-1 size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {crashed ? "This page crashed" : "This page couldn't load"}
            </p>
            {failure && !crashed ? (
              <p className="max-w-80 text-body text-muted-foreground">{failure}</p>
            ) : null}
            <Button size="sm" className="mt-2" onClick={() => view?.reload()}>
              {crashed ? "Reload" : "Try again"}
            </Button>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Find in the page, by Chromium (⌘F / Ctrl+F in a tab). */
function PageFind({
  view,
  focusKey,
  onClose,
}: {
  view: Webview;
  focusKey: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState({ at: -1, total: 0 });
  useEffect(() => {
    const listener = (event: Event) => {
      const { activeMatchOrdinal, matches } = (
        event as Event & { result: { activeMatchOrdinal: number; matches: number } }
      ).result;
      setFound({ at: activeMatchOrdinal - 1, total: matches });
    };
    view.addEventListener("found-in-page", listener);
    return () => {
      view.removeEventListener("found-in-page", listener);
      view.stopFindInPage("keepSelection");
    };
  }, [view]);
  const { FindBar } = uiHost();
  return (
    <FindBar
      label="Find in page"
      focusKey={focusKey}
      query={query}
      onQuery={(value) => {
        setQuery(value);
        if (value) view.findInPage(value, { findNext: true });
        else {
          view.stopFindInPage("clearSelection");
          setFound({ at: -1, total: 0 });
        }
      }}
      at={found.at}
      total={found.total}
      onStep={(by) => {
        if (query) view.findInPage(query, { forward: by > 0, findNext: false });
      }}
      onClose={onClose}
    />
  );
}

function AddressBar({
  url,
  focusRequest,
  onNavigate,
  onSiteDataCleared,
}: {
  url: string;
  focusRequest: number;
  onNavigate: (url: string) => void;
  onSiteDataCleared: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // A request made while the page was hidden waits until it shows, and is answered once.
  const answered = useRef(0);
  useEffect(() => {
    if (!focusRequest || focusRequest === answered.current) return;
    answered.current = focusRequest;
    inputRef.current?.focus();
  }, [focusRequest]);
  const editing = draft !== null;
  const origin = URL.parse(url)?.origin;
  // What history suggests for what's typed (not for the address as it was).
  const suggestions = useSuggestions(editing && draft !== url ? draft : null);
  const [highlight, setHighlight] = useState(-1);
  const go = (next: string) => {
    onNavigate(next);
    inputRef.current?.blur();
  };
  return (
    <div className="group/address relative mx-auto flex h-8 min-w-0 max-w-[56rem] flex-1 items-center rounded-pill bg-foreground/[0.06] focus-within:bg-foreground/[0.09] hover:bg-foreground/[0.09]">
      <input
        ref={inputRef}
        aria-label="Address"
        placeholder="Search or enter a URL"
        autoFocus={!url}
        spellCheck={false}
        autoComplete="off"
        value={editing ? draft : url ? hostOf(url) : ""}
        onFocus={(e) => {
          setDraft(url);
          const input = e.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onBlur={() => {
          setDraft(null);
          setHighlight(-1);
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          setHighlight(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && suggestions.length > 0) {
            e.preventDefault();
            const n = suggestions.length;
            setHighlight((at) => (e.key === "ArrowDown" ? (at + 1) % n : (at - 1 + n) % n));
          } else if (e.key === "Enter") {
            const picked = suggestions[highlight];
            const next = picked ? picked.url : addressToUrl(draft ?? "");
            if (next) go(next);
          }
        }}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent px-9 text-sm text-foreground outline-none placeholder:text-muted-foreground",
          editing ? "text-left" : "text-center",
        )}
      />
      {suggestions.length > 0 ? (
        <div
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-1 flex flex-col rounded-xl border border-border bg-popover p-1 shadow-lg"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.url}
              type="button"
              role="option"
              aria-selected={i === highlight}
              // Before the input's blur drops the list.
              onMouseDown={(e) => {
                e.preventDefault();
                go(s.url);
              }}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent-surface",
                i === highlight && "bg-accent-surface",
              )}
            >
              <GlobeIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate text-sm text-foreground">
                {s.title || hostOf(s.url)}
              </span>
              <span className="min-w-0 shrink truncate text-xs text-muted-foreground">
                {s.url.replace(/^https?:\/\/(www\.)?/, "")}
              </span>
            </button>
          ))}
        </div>
      ) : null}
      {origin && origin !== "null" && !editing ? (
        <>
          <SiteInfo url={url} origin={origin} onCleared={onSiteDataCleared} />
          <HintTooltip label="Open in default browser" side="bottom">
            <IconButton
              label="Open in default browser"
              className="absolute right-0.5 rounded-pill opacity-0 group-hover/address:opacity-100 focus-visible:opacity-100"
              onClick={() =>
                void desktopBridge()
                  .openExternal(url)
                  .catch(() => {})
              }
            >
              <ArrowUpRightIcon className="size-4" />
            </IconButton>
          </HintTooltip>
        </>
      ) : null}
    </div>
  );
}

function SiteInfo({
  url,
  origin,
  onCleared,
}: {
  url: string;
  origin: string;
  onCleared: () => void;
}) {
  const secure = url.startsWith("https:");
  const clear = async () => {
    try {
      await desktopBridge().invoke("browser:clearData", { origin });
      toast.success(`Cleared ${hostOf(url)}'s cookies and data`);
      onCleared();
    } catch (error) {
      toast.error(`Couldn't clear the site's data: ${error}`);
    }
  };
  return (
    <DropdownMenu>
      <HintTooltip label="View site information" side="bottom">
        <DropdownMenuTrigger
          render={
            <IconButton
              label="View site information"
              className="absolute left-0.5 rounded-pill opacity-0 group-hover/address:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
            />
          }
        >
          <SlidersHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="truncate">{hostOf(url)}</DropdownMenuLabel>
        <p className="flex items-center gap-2 px-2.5 pb-2 text-body text-muted-foreground">
          {secure ? (
            <LockIcon className="size-3.5 shrink-0" />
          ) : (
            <TriangleAlertIcon className="size-3.5 shrink-0" />
          )}
          {secure ? "Connection is secure" : "Not secure: what you send here can be read"}
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void clear()}>
          Clear cookies and site data
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StartPage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const tile =
    "flex cursor-pointer items-center gap-2.5 rounded-xl bg-foreground/[0.04] px-4 py-3 text-left text-sm text-foreground outline-none hover:bg-foreground/[0.07] focus-visible:ring-2 focus-visible:ring-focus-ring [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground";
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-8">
        <h2 className="text-sm font-medium text-foreground">Tools</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-3">
          <button type="button" className={tile} onClick={() => uiHost().openSettings()}>
            <PuzzleIcon />
            Extensions
          </button>
        </div>
        <h2 className="mt-5 text-sm font-medium text-foreground">Suggested</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
          {SUGGESTED.map((site) => (
            <button
              key={site.url}
              type="button"
              onClick={() => onNavigate(site.url)}
              onAuxClick={(e) => {
                if (e.button === 1) openTab(site.url, { background: true });
              }}
              className="flex cursor-pointer flex-col items-center gap-3 rounded-xl px-2 py-4 text-sm text-foreground outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <img src={faviconFor(site.url)} alt="" className="size-8 rounded-md" />
              <span className="truncate">{site.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
