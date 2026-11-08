import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  CodeIcon,
  CopyIcon,
  GlobeIcon,
  LoaderCircleIcon,
  LockIcon,
  MoreHorizontalIcon,
  PuzzleIcon,
  RotateCwIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import { ProviderIcon, isProviderUsable, useAgentProviders } from "../agent/agent-providers";
import { mailApi } from "../mail/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../mail/menu";
import { toast } from "../mail/toast";
import { Btn, HintTooltip, IconBtn, cn } from "../mail/ui";
import { ExtensionToolbar } from "./extension-toolbar";
import {
  CHROME_WEB_STORE_URL,
  addressToUrl,
  closeTab,
  hostOf,
  openTab,
  selectTab,
  updateTab,
  useBrowser,
  type BrowserTab,
} from "./store";
import { shortcutText } from "../keybindings/keys";

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
  if (tab.loading) return <LoaderCircleIcon className="size-3.5 animate-spin" />;
  if (tab.favicon && failed !== tab.favicon) {
    return (
      <img
        src={tab.favicon}
        alt=""
        draggable={false}
        className="size-3.5 rounded-[3px]"
        onError={() => setFailed(tab.favicon)}
      />
    );
  }
  return <GlobeIcon className="size-3.5" />;
}

export function BrowserPage({ tab, active }: { tab: BrowserTab; active: boolean }) {
  const [view, setView] = useState<Webview | null>(null);
  const [pageId, setPageId] = useState<number | null>(null);
  // The address the page opens at; later ones go through loadURL (a new src
  // attribute would load the page over again).
  const [src, setSrc] = useState(tab.url);
  const [history, setHistory] = useState({ back: false, forward: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [crashed, setCrashed] = useState(false);
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
    if (active && pageId !== null) void window.desktopBridge.invoke("browser:activeTab", pageId);
  }, [active, pageId]);
  useEffect(() => {
    if (pageId === null) return;
    const mine = (params: unknown) =>
      (params as { webContentsId?: number }).webContentsId === pageId;
    const offs = [
      window.desktopBridge.on("browser:selectTab", (params) => {
        if (mine(params)) selectTab(tab.id);
      }),
      window.desktopBridge.on("browser:closeTab", (params) => {
        if (mine(params)) closeTab(tab.id);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [pageId, tab.id]);

  useEffect(() => {
    if (pageId === null || !tab.shared) return;
    const share = (on: boolean) =>
      window.desktopBridge.invoke("browser:share", { webContentsId: pageId, share: on });
    let current = true;
    share(true).catch((error: unknown) => {
      if (!current) return;
      updateTab(tab.id, { shared: false });
      const message = String(error).replace(
        /^Error invoking remote method '[^']*':\s*(Error:\s*)?/,
        "",
      );
      toast.error(`Couldn't share this tab with OpenClaw: ${message}`);
    });
    return () => {
      current = false;
      void share(false).catch(() => {});
    };
  }, [pageId, tab.shared, tab.id]);

  const navigate = (url: string) => {
    updateTab(tab.id, { url });
    if (view) void view.loadURL(url).catch(() => {});
    else setSrc(url);
  };

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <div className="flex shrink-0 items-center rounded-full bg-foreground/[0.06] p-0.5">
          <HintTooltip label="Back" hint={shortcutText("mod+[")} side="bottom">
            <IconBtn
              label="Back"
              className="rounded-full"
              disabled={!history.back}
              onClick={() => view?.goBack()}
            >
              <ArrowLeftIcon className="size-4" />
            </IconBtn>
          </HintTooltip>
          <HintTooltip label="Forward" hint={shortcutText("mod+]")} side="bottom">
            <IconBtn
              label="Forward"
              className="rounded-full"
              disabled={!history.forward}
              onClick={() => view?.goForward()}
            >
              <ArrowRightIcon className="size-4" />
            </IconBtn>
          </HintTooltip>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
          {tab.loading ? (
            <HintTooltip label="Stop" side="bottom">
              <IconBtn label="Stop" className="rounded-full" onClick={() => view?.stop()}>
                <XIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          ) : (
            <HintTooltip label="Reload" hint={shortcutText("mod+r")} side="bottom">
              <IconBtn
                label="Reload"
                className="rounded-full"
                disabled={!view}
                onClick={() => view?.reload()}
              >
                <RotateCwIcon className="size-4" />
              </IconBtn>
            </HintTooltip>
          )}
        </div>
        <AddressBar
          url={tab.url}
          focusRequest={active ? addressRequest : 0}
          onNavigate={navigate}
          onSiteDataCleared={() => view?.reload()}
        />
        {src && pageId !== null ? <ShareButton tab={tab} /> : null}
        {src ? <ExtensionToolbar /> : null}
        <PageMenu url={tab.url} onDevTools={view ? () => view.openDevTools() : undefined} />
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
        {failure || crashed ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-canvas p-6 text-center">
            <TriangleAlertIcon className="mb-1 size-6 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground">
              {crashed ? "This page crashed" : "This page couldn't load"}
            </p>
            {failure && !crashed ? (
              <p className="max-w-80 text-[13px] text-muted-foreground">{failure}</p>
            ) : null}
            <Btn size="sm" className="mt-2" onClick={() => view?.reload()}>
              {crashed ? "Reload" : "Try again"}
            </Btn>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** Shares the tab with OpenClaw's agents, who then see and work in it as you watch. */
function ShareButton({ tab }: { tab: BrowserTab }) {
  const openClaw = useAgentProviders().data?.providers.find((p) => p.kind === "openclaw");
  const sharing = useBrowser((s) => s.sharing);
  if (!tab.shared && (!openClaw?.enabled || !isProviderUsable(openClaw))) return null;
  if (!tab.shared)
    return (
      <HintTooltip label="Share with OpenClaw" side="bottom">
        <IconBtn
          label="Share with OpenClaw"
          className="size-8 shrink-0 rounded-full"
          onClick={() => updateTab(tab.id, { shared: true })}
        >
          <ProviderIcon kind="openclaw" className="grayscale" />
        </IconBtn>
      </HintTooltip>
    );
  const label =
    sharing.status === "on"
      ? "OpenClaw can see and use this tab. Click to stop sharing."
      : sharing.status === "offline"
        ? `Reconnecting to OpenClaw… ${sharing.error ?? ""}`.trim()
        : "Connecting to OpenClaw…";
  return (
    <HintTooltip label={label} side="bottom">
      <Btn
        size="sm"
        variant="ghost"
        aria-label="Stop sharing with OpenClaw"
        className="shrink-0 gap-1.5 rounded-full bg-[#ff4d4d]/12 text-foreground hover:bg-[#ff4d4d]/20"
        onClick={() => updateTab(tab.id, { shared: false })}
      >
        {sharing.status === "on" ? (
          <ProviderIcon kind="openclaw" className="size-3.5" />
        ) : (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        )}
        Shared
      </Btn>
    </HintTooltip>
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
  return (
    <div className="group/address relative mx-auto flex h-8 min-w-0 max-w-[56rem] flex-1 items-center rounded-full bg-foreground/[0.06] focus-within:bg-foreground/[0.09] hover:bg-foreground/[0.09]">
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
        onBlur={() => setDraft(null)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Enter") {
            const next = addressToUrl(draft ?? "");
            if (!next) return;
            onNavigate(next);
            e.currentTarget.blur();
          }
        }}
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent px-9 text-sm text-foreground outline-none placeholder:text-muted-foreground",
          editing ? "text-left" : "text-center",
        )}
      />
      {origin && origin !== "null" && !editing ? (
        <>
          <SiteInfo url={url} origin={origin} onCleared={onSiteDataCleared} />
          <HintTooltip label="Open in default browser" side="bottom">
            <IconBtn
              label="Open in default browser"
              className="absolute right-0.5 rounded-full opacity-0 group-hover/address:opacity-100 focus-visible:opacity-100"
              onClick={() => void window.desktopBridge.openExternal(url).catch(() => {})}
            >
              <ArrowUpRightIcon className="size-4" />
            </IconBtn>
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
      await window.desktopBridge.invoke("browser:clearData", { origin });
      toast.success(`Cleared ${hostOf(url)}'s cookies and data`);
      onCleared();
    } catch (error) {
      toast.error(`Couldn't clear the site's data: ${error}`);
    }
  };
  return (
    <DropdownMenu>
      <HintTooltip label="View site information" side="bottom">
        <DropdownMenuTrigger asChild>
          <IconBtn
            label="View site information"
            className="absolute left-0.5 rounded-full opacity-0 group-hover/address:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <SlidersHorizontalIcon className="size-4" />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="truncate">{hostOf(url)}</DropdownMenuLabel>
        <p className="flex items-center gap-2 px-2.5 pb-2 text-[13px] text-muted-foreground">
          {secure ? (
            <LockIcon className="size-3.5 shrink-0" />
          ) : (
            <TriangleAlertIcon className="size-3.5 shrink-0" />
          )}
          {secure ? "Connection is secure" : "Not secure: what you send here can be read"}
        </p>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void clear()}>
          Clear cookies and site data
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PageMenu({ url, onDevTools }: { url: string; onDevTools?: () => void }) {
  return (
    <DropdownMenu>
      <HintTooltip label="More" side="bottom">
        <DropdownMenuTrigger asChild>
          <IconBtn label="More" className="size-8 shrink-0 rounded-full">
            <MoreHorizontalIcon className="size-4" />
          </IconBtn>
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="end" className="w-56">
        {url ? (
          <>
            <DropdownMenuItem
              icon={<ArrowUpRightIcon className="size-4" />}
              onSelect={() => void window.desktopBridge.openExternal(url).catch(() => {})}
            >
              Open in Default Browser
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<CopyIcon className="size-4" />}
              onSelect={() => void navigator.clipboard.writeText(url)}
            >
              Copy Link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          icon={<PuzzleIcon className="size-4" />}
          onSelect={() => void mailApi.openSettings({ pane: "browser" })}
        >
          Extensions
        </DropdownMenuItem>
        {onDevTools ? (
          <DropdownMenuItem icon={<CodeIcon className="size-4" />} onSelect={onDevTools}>
            Developer Tools
          </DropdownMenuItem>
        ) : null}
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
          <button
            type="button"
            className={tile}
            onClick={() => void mailApi.openSettings({ pane: "browser" })}
          >
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
