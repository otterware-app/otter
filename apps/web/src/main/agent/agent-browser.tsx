import { useEffect, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloudIcon,
  GlobeIcon,
  MonitorOffIcon,
  MousePointer2Icon,
  RotateCwIcon,
} from "lucide-react";
import { controlBrowser } from "./agent-browser-input";
import {
  AgentCursor,
  DialogBanner,
  type PageField,
  type PagePointer,
  type Placer,
} from "./agent-browser-overlay";
import { faviconFor } from "../browser/browser-view";
import { addressToUrl, hostOf } from "@otter/client/web-address";
import {
  chooseBrowserFiles,
  followBrowser,
  holdBrowser,
  screencastClosed,
  screencastFrame,
  screencastPage,
  viewRetryMs,
  type BrowserTab,
  type PageDialog,
} from "@otter/client/agents/agent-browser";
import { useLatest } from "@otter/client/use-latest";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { IconButton } from "@otter/ui/components/button";
import { Spinner } from "@otter/ui/components/spinner";
import { cn } from "@otter/ui/lib/utils";
import { type ProviderKind, agentApi } from "@otter/client/agents/api";

const toBase64 = async (file: File) => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

type ViewState =
  | { status: "connecting"; page?: string }
  | { status: "live"; page?: string }
  | { status: "closed" }
  | { status: "failed"; message: string };

/** The site's icon, as a browser tab shows it, marked as the agent's remote browser. */
export function AgentBrowserTabIcon({ page }: { page?: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const icon = page ? faviconFor(page) : null;
  return (
    <span className="relative flex size-3.5 shrink-0">
      {icon && failed !== icon ? (
        <img
          src={icon}
          alt=""
          draggable={false}
          className="size-3.5 rounded-sm"
          onError={() => setFailed(icon)}
        />
      ) : (
        <GlobeIcon className="size-3.5" />
      )}
      <CloudIcon className="absolute -right-1.5 -bottom-1 size-2.5 rounded-full bg-canvas p-px text-muted-foreground" />
    </span>
  );
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * The agent's browser tab, live: OpenClaw's screencast (a WebSocket of JPEG frames, about 20 a
 * second) straight from the gateway, decoded off the main thread and handed to the canvas
 * without a copy. A frame that arrives while one decodes replaces the one waiting, so a slow
 * machine skips frames rather than falling behind; nothing streams while the page is hidden.
 * `activity` changes when the agent browses again, and when that step's result has named its tab:
 * it may have moved to another one. Taking control sends your mouse and keys to the tab (the
 * Otter plugin on the gateway replays them), and the agent's browser waits until you hand it back.
 */
export function AgentBrowser({
  provider,
  sessionId,
  agentName,
  activity,
  onPage,
}: {
  provider: ProviderKind;
  sessionId: string;
  agentName: string;
  activity: number;
  onPage: (url: string | undefined) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef<string | null>(null);
  const frameRef = useRef<{ cssWidth: number; cssHeight: number } | null>(null);
  const [tab, setTab] = useState<BrowserTab | null>(null);
  const [controlling, setControlling] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [pointer, setPointer] = useState<PagePointer | null>(null);
  const [field, setField] = useState<PageField | null>(null);
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const controlRef = useRef<{
    send: (event: { type: string; [key: string]: unknown }) => void;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ViewState>({ status: "connecting" });
  const [connection, setConnection] = useState(0);
  const visible = usePageVisible();

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("bitmaprenderer");
    if (!visible || !canvas || !context) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let decoding = false;
    let waiting: Blob | null = null;
    let shown = false;

    const draw = (frame: Blob) => {
      if (decoding) {
        waiting = frame;
        return;
      }
      decoding = true;
      createImageBitmap(frame)
        .then(
          (bitmap) => {
            if (stopped) return bitmap.close();
            if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
            if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
            context.transferFromImageBitmap(bitmap);
            if (!shown) {
              shown = true;
              failures = 0;
              setState((s) => ({ status: "live", page: "page" in s ? s.page : undefined }));
            }
          },
          () => {},
        )
        .finally(() => {
          decoding = false;
          const next = waiting;
          waiting = null;
          if (next && !stopped) draw(next);
        });
    };

    const connect = () => {
      const box = canvas.parentElement?.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      agentApi
        .browserView(provider, sessionId, {
          width: Math.round((box?.width ?? 1280) * scale),
          height: Math.round((box?.height ?? 800) * scale),
        })
        .then(
          (view) => {
            if (stopped) return;
            if (!view?.url) {
              targetRef.current = null;
              setTab(null);
              setState({ status: "closed" });
              return;
            }
            targetRef.current = view.targetId;
            setTab((t) =>
              t?.targetId === view.targetId
                ? t
                : { targetId: view.targetId, profile: view.profile },
            );
            shown = false;
            setState({ status: "connecting", page: view.page });
            const opened = new WebSocket(view.url);
            socket = opened;
            opened.binaryType = "arraybuffer";
            opened.addEventListener("message", ({ data }) => {
              if (typeof data === "string") {
                const page = screencastPage(data);
                if (page) setState((s) => (s.status === "live" ? { status: "live", page } : s));
                return;
              }
              const frame = screencastFrame(data as ArrayBuffer);
              if (frame.size) frameRef.current = frame.size;
              draw(new Blob([frame.jpeg], { type: "image/jpeg" }));
            });
            opened.addEventListener("close", ({ code }) => {
              socket = null;
              if (stopped) return;
              const closed = screencastClosed(code, failures + 1);
              if ("failed" in closed) {
                setState({ status: "failed", message: closed.failed });
                return;
              }
              failures += 1;
              retry = setTimeout(connect, closed.retryMs);
            });
          },
          (error: unknown) => {
            if (stopped) return;
            failures += 1;
            setState({
              status: "failed",
              message: error instanceof Error ? error.message : "Couldn't open the live view.",
            });
            retry = setTimeout(connect, viewRetryMs(failures));
          },
        );
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- `connection` asks for a new stream.
  }, [visible, provider, sessionId, connection]);

  // The agent browsed again: reconnect only when it's on another tab, or the view had closed.
  useEffect(() => {
    if (activity === 0) return;
    const current = targetRef.current;
    if (!current) {
      setConnection((n) => n + 1);
      return;
    }
    let cancelled = false;
    agentApi.browserView(provider, sessionId, { width: 320, height: 320, except: current }).then(
      (view) => {
        if (!cancelled && view?.targetId !== current) setConnection((n) => n + 1);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [activity, provider, sessionId]);

  const live = state.status === "live";
  const page = "page" in state ? state.page : undefined;
  useEffect(() => onPage(page), [page, onPage]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!controlling || !tab || !canvas) return;
    const lost = (error: unknown) => {
      setControlling(false);
      setControlError(error instanceof Error ? error.message : "Lost control of the tab.");
    };
    let held = true;
    const hold = holdBrowser(provider, tab, lost);
    const control = controlBrowser(canvas, {
      frameSize: () => frameRef.current,
      send: hold.send,
      onLost: (error) => held && lost(error),
    });
    controlRef.current = control;
    return () => {
      held = false;
      controlRef.current = null;
      control.detach();
      hold.release();
    };
  }, [controlling, tab, provider]);

  // What happens on the tab: the agent's pointer and typing, pop-ups, file pickers, copies.
  const controllingRef = useLatest(controlling);
  useEffect(() => {
    if (!tab) return;
    return followBrowser(provider, tab, {
      onDialog: setDialog,
      onEvent: (event) => {
        const at = Date.now();
        if (event.type === "pointer")
          setPointer((p) => ({
            x: event.x,
            y: event.y,
            clicks: (p?.clicks ?? 0) + (event.click ? 1 : 0),
            at,
          }));
        else if (event.type === "typing")
          setField({ x: event.x, y: event.y, width: event.width, height: event.height, at });
        else if (event.type === "dialog") setDialog(event.dialog);
        else if (event.type === "dialogClosed") setDialog(null);
        else if (!controllingRef.current) return;
        else if (event.type === "clipboard")
          void navigator.clipboard.writeText(event.text).catch(() => {});
        else if (event.type === "fileChooser" && fileRef.current) {
          fileRef.current.multiple = event.multiple;
          fileRef.current.click();
        }
      },
    });
  }, [tab, provider, controllingRef]);

  const choose = async (files: File[]) => {
    if (!tab) return;
    await chooseBrowserFiles(
      provider,
      tab,
      files.map((file) => ({ name: file.name, size: file.size, data: () => toBase64(file) })),
    );
  };

  // Closing the picker without a file cancels the page's.
  const chooseRef = useLatest(choose);
  useEffect(() => {
    const input = fileRef.current;
    const cancel = () => void chooseRef.current([]);
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, [chooseRef]);

  const place: Placer = (x, y) => {
    const canvas = canvasRef.current;
    const size = frameRef.current;
    if (!canvas || !size || !canvas.width || !canvas.height) return null;
    const fit = Math.min(canvas.clientWidth / canvas.width, canvas.clientHeight / canvas.height);
    const left = (canvas.clientWidth - canvas.width * fit) / 2;
    const scale = (canvas.width * fit) / size.cssWidth;
    return { left: left + x * scale, top: y * scale, scale };
  };
  const send = (event: { type: string; [key: string]: unknown }) => controlRef.current?.send(event);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <HintTooltip
          label={`${agentName}'s browser, running on the OpenClaw gateway`}
          side="bottom"
        >
          <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-pill bg-foreground/[0.06] px-3 text-xs font-medium text-foreground">
            <CloudIcon className="size-3.5 text-muted-foreground" />
            {agentName}
            {live ? (
              <span className="size-1.5 rounded-full bg-destructive" aria-label="Live" />
            ) : null}
          </span>
        </HintTooltip>
        {controlling ? (
          <div className="flex shrink-0 items-center rounded-pill bg-foreground/[0.06] p-0.5">
            <HintTooltip label="Back" side="bottom">
              <IconButton
                label="Back"
                className="rounded-pill"
                onClick={() => send({ type: "history", delta: -1 })}
              >
                <ArrowLeftIcon className="size-4" />
              </IconButton>
            </HintTooltip>
            <HintTooltip label="Forward" side="bottom">
              <IconButton
                label="Forward"
                className="rounded-pill"
                onClick={() => send({ type: "history", delta: 1 })}
              >
                <ArrowRightIcon className="size-4" />
              </IconButton>
            </HintTooltip>
            <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
            <HintTooltip label="Reload" side="bottom">
              <IconButton
                label="Reload"
                className="rounded-pill"
                onClick={() => send({ type: "reload" })}
              >
                <RotateCwIcon className="size-4" />
              </IconButton>
            </HintTooltip>
          </div>
        ) : null}
        {controlling ? (
          <input
            aria-label="Address"
            placeholder="Enter a URL"
            spellCheck={false}
            autoComplete="off"
            value={address ?? (page ? hostOf(page) : "")}
            onFocus={(e) => {
              setAddress(page ?? "");
              const input = e.currentTarget;
              requestAnimationFrame(() => input.select());
            }}
            onBlur={() => setAddress(null)}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") e.currentTarget.blur();
              if (e.key !== "Enter") return;
              const url = addressToUrl(address ?? "");
              if (url) send({ type: "navigate", url });
              e.currentTarget.blur();
            }}
            className={cn(
              "mx-auto h-8 min-w-0 max-w-[56rem] flex-1 rounded-pill bg-foreground/[0.06] px-4 text-sm text-foreground outline-none hover:bg-foreground/[0.09] focus:bg-foreground/[0.09]",
              address === null ? "text-center" : "text-left",
            )}
          />
        ) : (
          <div
            title={page}
            className="mx-auto flex h-8 min-w-0 max-w-[56rem] flex-1 items-center justify-center rounded-pill bg-foreground/[0.06] px-4 text-sm text-foreground"
          >
            <span className="truncate">{page ? hostOf(page) : `${agentName}'s browser`}</span>
          </div>
        )}
        {tab ? (
          <button
            type="button"
            onClick={() => {
              setControlError(null);
              setControlling((on) => !on);
            }}
            className={cn(
              "flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-pill px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              controlling
                ? "bg-foreground text-background hover:bg-foreground/85"
                : "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.09]",
            )}
          >
            <MousePointer2Icon className="size-3.5" />
            {controlling ? "Release control" : "Take control"}
          </button>
        ) : null}
      </div>
      {controlError && !controlling ? (
        <p className="shrink-0 border-b border-border/70 px-3 py-1.5 text-xs text-destructive">
          {controlError}
        </p>
      ) : null}
      <div className="relative min-h-0 flex-1 bg-muted/40">
        <canvas
          ref={canvasRef}
          tabIndex={controlling ? 0 : -1}
          aria-label={controlling ? `${agentName}'s browser, under your control` : undefined}
          className={cn(
            live ? "size-full object-contain object-top" : "invisible size-full",
            controlling && "cursor-default outline-none ring-2 ring-focus-ring ring-inset",
          )}
        />
        {live && !controlling ? (
          <AgentCursor pointer={pointer} field={field} place={place} />
        ) : null}
        {dialog ? (
          <DialogBanner
            key={dialog.message}
            dialog={dialog}
            agentName={agentName}
            controlling={controlling}
            onAnswer={(accept, promptText) => {
              send({ type: "dialog", accept, ...(promptText === undefined ? {} : { promptText }) });
              setDialog(null);
            }}
          />
        ) : null}
        <input
          ref={fileRef}
          type="file"
          hidden
          onChange={(e) => {
            const files = [...(e.currentTarget.files ?? [])];
            e.currentTarget.value = "";
            void choose(files);
          }}
        />
        {state.status === "live" ? null : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
            {state.status === "connecting" ? (
              <Spinner className="size-5" />
            ) : (
              <>
                <MonitorOffIcon className="size-5" />
                <p>
                  {state.status === "closed"
                    ? `${agentName}'s browser is closed. It shows here when ${agentName} browses again.`
                    : state.message}
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
