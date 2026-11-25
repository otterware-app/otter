import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRightIcon,
  CameraIcon,
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FolderIcon,
  HistoryIcon,
  ImportIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PrinterIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { hostOf } from "@otter/client/web-address";
import { Button, IconButton } from "@otter/ui/components/button";
import { Dialog } from "@otter/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import { Popover, PopoverPopup, PopoverTrigger } from "@otter/ui/components/popover";
import { Text } from "@otter/ui/components/text";
import { toast } from "@otter/ui/components/toast";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { cn } from "@otter/ui/lib/utils";
import { desktopBridge } from "./bridge";
import { uiHost } from "./host";
import { openTab } from "./store";

export type PageView = HTMLElement & {
  getWebContentsId(): number;
  print(): Promise<void>;
  getZoomFactor(): number;
  setZoomFactor(factor: number): void;
  openDevTools(): void;
};

/** Chrome's zoom steps. */
const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function ZoomRow({ view }: { view: PageView }) {
  const [zoom, setZoom] = useState(() => view.getZoomFactor());
  const step = (by: 1 | -1) => {
    const at = ZOOMS.findIndex((z) => z >= zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? 7 : at) + by))]!;
    view.setZoomFactor(next);
    setZoom(next);
  };
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-sm text-foreground">
      <span className="flex-1">Zoom</span>
      <div className="flex items-center rounded-pill border border-border">
        <IconButton label="Zoom out" size="icon-xs" onClick={() => step(-1)}>
          <MinusIcon className="size-3.5" />
        </IconButton>
        <button
          type="button"
          className="w-12 text-center text-xs tabular-nums"
          title="Reset zoom"
          onClick={() => {
            view.setZoomFactor(1);
            setZoom(1);
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
        <IconButton label="Zoom in" size="icon-xs" onClick={() => step(1)}>
          <PlusIcon className="size-3.5" />
        </IconButton>
      </div>
    </div>
  );
}

/** The page's ⋯ menu, ChatGPT's browser's: the page, then the browser's own places. */
export function PageMenu({
  url,
  view,
  onFind,
  onHistory,
}: {
  url: string;
  view: PageView | null;
  onFind: () => void;
  onHistory: () => void;
}) {
  return (
    <DropdownMenu>
      <HintTooltip label="More" side="bottom">
        <DropdownMenuTrigger
          render={<IconButton label="More" size="icon" className="shrink-0 rounded-pill" />}
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
      </HintTooltip>
      <DropdownMenuContent align="end" className="w-64">
        {view ? (
          <>
            <DropdownMenuItem
              icon={<SearchIcon className="size-4" />}
              accelerator={uiHost().shortcutText("mod+f")}
              onClick={onFind}
            >
              Find in Page
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<PrinterIcon className="size-4" />}
              onClick={() => void view.print().catch(() => {})}
            >
              Print…
            </DropdownMenuItem>
            <ZoomRow view={view} />
            <DropdownMenuItem
              icon={<CameraIcon className="size-4" />}
              onClick={async () => {
                const copied = await desktopBridge().invoke<boolean>(
                  "browser:screenshot",
                  view.getWebContentsId(),
                );
                if (copied) toast.success("Screenshot copied");
              }}
            >
              Take a Screenshot
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        {url ? (
          <>
            <DropdownMenuItem
              icon={<ArrowUpRightIcon className="size-4" />}
              onClick={() =>
                void desktopBridge()
                  .openExternal(url)
                  .catch(() => {})
              }
            >
              Open in Default Browser
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={<CopyIcon className="size-4" />}
              onClick={() => void navigator.clipboard.writeText(url)}
            >
              Copy Link
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem icon={<HistoryIcon className="size-4" />} onClick={onHistory}>
          History
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<ImportIcon className="size-4" />}
          onClick={() => uiHost().openSettings()}
        >
          Import from Another Browser…
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Trash2Icon className="size-4" />}
          onClick={() => uiHost().openSettings()}
        >
          Clear Browsing Data…
        </DropdownMenuItem>
        {view ? (
          <DropdownMenuItem
            icon={<CodeIcon className="size-4" />}
            onClick={() => view.openDevTools()}
          >
            Developer Tools
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<SettingsIcon className="size-4" />}
          onClick={() => uiHost().openSettings()}
        >
          Browser Settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Download = {
  id: number;
  filename: string;
  path: string;
  state: "progressing" | "completed" | "cancelled" | "interrupted";
  received: number;
  total: number;
  paused: boolean;
};

const DOWNLOADS_KEY = ["browser-downloads"];

const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const act = (id: number, action: string) =>
  void desktopBridge().invoke("browser:downloadAction", { id, action });

/** The toolbar's downloads, Chrome's bubble: there once something's downloaded, open as one starts. */
export function DownloadsButton() {
  const queryClient = useQueryClient();
  const downloads = useQuery({
    queryKey: DOWNLOADS_KEY,
    queryFn: () => desktopBridge().invoke<Download[]>("browser:downloads"),
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const offs = [
      desktopBridge().on("browser:downloadsChanged", () => {
        void queryClient.invalidateQueries({ queryKey: DOWNLOADS_KEY });
      }),
      desktopBridge().on("browser:downloadStarted", () => setOpen(true)),
    ];
    return () => offs.forEach((off) => off());
  }, [queryClient]);
  const list = downloads.data ?? [];
  if (list.length === 0) return null;
  const busy = list.some((d) => d.state === "progressing");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <HintTooltip label="Downloads" side="bottom">
        <PopoverTrigger
          render={
            <IconButton
              label="Downloads"
              size="icon"
              className={cn("shrink-0 rounded-pill", busy && "text-primary")}
            />
          }
        >
          <DownloadIcon className="size-4" />
        </PopoverTrigger>
      </HintTooltip>
      <PopoverPopup align="end" width="md" padding="compact">
        <div className="flex items-center justify-between px-1 pb-1">
          <Text variant="strong">Downloads</Text>
          <Button
            size="xs"
            variant="ghost-muted"
            onClick={() => void desktopBridge().invoke("browser:clearDownloads")}
          >
            Clear
          </Button>
        </div>
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {list.map((d) => (
            <div
              key={d.id}
              className="group flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-accent-surface"
            >
              <FileIcon className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col text-left"
                disabled={d.state !== "completed"}
                onClick={() => act(d.id, "open")}
              >
                <span className={cn("truncate text-sm", d.state === "cancelled" && "line-through")}>
                  {d.filename}
                </span>
                <span className="text-xs text-muted-foreground">
                  {d.state === "progressing"
                    ? `${size(d.received)}${d.total ? ` of ${size(d.total)}` : ""}${d.paused ? " · Paused" : ""}`
                    : d.state === "completed"
                      ? size(d.received)
                      : d.state === "cancelled"
                        ? "Cancelled"
                        : "Failed"}
                </span>
                {d.state === "progressing" && d.total > 0 ? (
                  <span className="mt-1 h-1 overflow-hidden rounded-full bg-foreground/10">
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${(d.received / d.total) * 100}%` }}
                    />
                  </span>
                ) : null}
              </button>
              {d.state === "completed" ? (
                <IconButton label="Show in Folder" size="icon-xs" onClick={() => act(d.id, "show")}>
                  <FolderIcon className="size-3.5" />
                </IconButton>
              ) : d.state === "progressing" ? (
                <IconButton label="Cancel" size="icon-xs" onClick={() => act(d.id, "cancel")}>
                  <XIcon className="size-3.5" />
                </IconButton>
              ) : null}
            </div>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

type Visit = { url: string; title: string; time: number };

const day = (time: number) =>
  new Date(time).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/** History: the pages visited, newest first, by day; searchable, each opening in a new tab. */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const history = useQuery({
    queryKey: ["browser-history", query],
    queryFn: () => desktopBridge().invoke<Visit[]>("browser:history", { query }),
  });
  const visits = history.data ?? [];
  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title="History"
      size="xl"
      destructiveAction={{
        label: "Clear History",
        onClick: async () => {
          await desktopBridge().invoke("browser:clearHistory");
          void history.refetch();
        },
      }}
    >
      <div className="flex flex-col gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search history"
          className="h-8 rounded-pill bg-foreground/[0.06] px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex max-h-[60vh] flex-col overflow-y-auto">
          {visits.length === 0 ? (
            <Text variant="small" color="secondary" className="py-6 text-center">
              {query ? "Nothing matches." : "Pages you visit show here."}
            </Text>
          ) : null}
          {visits.map((visit, i) => (
            <div key={`${visit.time}-${visit.url}`}>
              {i === 0 || day(visits[i - 1]!.time) !== day(visit.time) ? (
                <Text variant="small-strong" color="secondary" as="div" className="pt-3 pb-1">
                  {day(visit.time)}
                </Text>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  openTab(visit.url);
                  onClose();
                }}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-accent-surface"
              >
                <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {new Date(visit.time).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{visit.title || visit.url}</span>
                <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground">
                  {hostOf(visit.url)}
                </span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/** What the address bar suggests from history for what's typed. */
export function useSuggestions(typed: string | null): Visit[] {
  const [suggestions, setSuggestions] = useState<Visit[]>([]);
  useEffect(() => {
    if (!typed?.trim()) return;
    let current = true;
    const timer = setTimeout(() => {
      void desktopBridge()
        .invoke<Visit[]>("browser:suggest", typed)
        .then((found) => {
          if (current) setSuggestions(found);
        });
    }, 80);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed]);
  return typed?.trim() ? suggestions : [];
}
