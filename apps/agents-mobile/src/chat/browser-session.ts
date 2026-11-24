import {
  chooseBrowserFiles,
  followBrowser,
  holdBrowser,
  screencastClosed,
  screencastFrame,
  screencastPage,
  viewRetryMs,
  type BrowserEvent,
  type BrowserTab,
  type PageDialog,
} from "@otter/client/agents/agent-browser";
import { agentApi, type ProviderKind } from "@otter/client/agents/api";
import { showNotice } from "@otter/mobile/notices";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState, type RefObject } from "react";

import type {
  BrowserPageHandle,
  BrowserPointer,
  BrowserTyping,
  BrowserWheel,
} from "./browser-page.tsx";

type Status = "connecting" | "live" | "closed" | "failed";
const DEMO_TAB = { targetId: "demo" };
const DEMO_PAGE = "https://otterware.app/mail/changelog";
const detail = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

function controlInput(hold: ReturnType<typeof holdBrowser>, lost: (error: unknown) => void) {
  let pending: BrowserWheel | null = null;
  let batch: unknown[] = [];
  let frame: number | null = null;
  let sending = false;
  let stopped = false;
  let seq = 0;

  function collectWheel() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (pending) batch.push({ ...pending, modifiers: 0 });
    pending = null;
  }

  function flush() {
    if (stopped || sending || batch.length === 0) return;
    const next = batch;
    batch = [];
    sending = true;
    void hold.send(++seq, next).then(() => {
      sending = false;
      flush();
    }, lost);
  }

  return {
    send(events: unknown[]) {
      collectWheel();
      batch.push(...events);
      flush();
    },
    wheel(event: BrowserWheel) {
      pending = {
        ...event,
        deltaX: event.deltaX + (pending?.deltaX ?? 0),
        deltaY: event.deltaY + (pending?.deltaY ?? 0),
      };
      frame ??= requestAnimationFrame(() => {
        collectWheel();
        flush();
      });
    },
    release() {
      stopped = true;
      if (frame !== null) cancelAnimationFrame(frame);
      return hold.release();
    },
  };
}

export function useBrowserSession(
  provider: ProviderKind | null,
  sessionId: string | null | undefined,
  activity: number,
  active: boolean,
  demo: boolean,
  canvas: RefObject<BrowserPageHandle | null>,
) {
  const [tab, setTab] = useState<BrowserTab | null>(null);
  const current = useRef<BrowserTab | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [problem, setProblem] = useState("");
  const [page, setPage] = useState<string>();
  const [pointer, setPointer] = useState<BrowserPointer | null>(null);
  const [typing, setTyping] = useState<BrowserTyping | null>(null);
  const [field, setField] = useState(false);
  const [dialog, setDialog] = useState<PageDialog | null>(null);
  const [chooser, setChooser] = useState<boolean | null>(null);
  const [control, setControl] = useState<"taking" | "held" | null>(null);
  const held = useRef<ReturnType<typeof controlInput> | null>(null);
  const releasing = useRef<Promise<void> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const previousActivity = useRef(activity);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let unfollow: (() => void) | undefined;

    const show = (next: BrowserTab | null) => {
      unfollow?.();
      unfollow = undefined;
      current.current = next;
      setTab(next);
      setPointer(null);
      setTyping(null);
      setDialog(null);
      setField(false);
      setChooser(null);
      setControl(null);
      if (held.current) releasing.current = held.current.release();
      held.current = null;
    };

    const onEvent = (event: BrowserEvent) => {
      const seen = Date.now();
      switch (event.type) {
        case "pointer":
          setPointer((p) => ({
            x: event.x,
            y: event.y,
            clicks: (p?.clicks ?? 0) + Number(event.click),
            seen,
          }));
          break;
        case "typing":
          setTyping({ x: event.x, y: event.y, width: event.width, height: event.height, seen });
          break;
        case "field":
          setField(event.editable);
          break;
        case "dialog":
          setDialog(event.dialog);
          break;
        case "dialogClosed":
          setDialog(null);
          break;
        case "clipboard":
          if (held.current) void Clipboard.setStringAsync(event.text).catch(() => {});
          break;
        case "fileChooser":
          if (held.current) setChooser(event.multiple);
          break;
      }
    };

    const connect = async () => {
      show(null);
      setPage(undefined);
      setProblem("");
      if (!active) return;
      if (demo) {
        show(DEMO_TAB);
        setPage(DEMO_PAGE);
        setStatus("live");
        return;
      }
      if (!provider || !sessionId) {
        setStatus("closed");
        return;
      }
      setStatus("connecting");
      try {
        const view = await agentApi.browserView(provider, sessionId, { width: 2000, height: 2000 });
        if (stopped) return;
        if (!view?.url) {
          setStatus("closed");
          return;
        }
        const opened = new WebSocket(view.url.replace(/^http/i, "ws"));
        opened.binaryType = "arraybuffer";
        socket = opened;
        const target = { targetId: view.targetId, profile: view.profile };
        show(target);
        setPage(view.page);
        unfollow = followBrowser(provider, target, { onEvent, onDialog: setDialog });

        let size: { cssWidth: number; cssHeight: number } | null = null;
        let decoding = false;
        let shown = false;
        let waiting: Uint8Array<ArrayBuffer> | null = null;
        const draw = async () => {
          decoding = true;
          try {
            while (waiting) {
              if (stopped || socket !== opened) return;
              const jpeg = waiting;
              waiting = null;
              const rendered = await canvas.current?.drawFrame(
                jpeg,
                size?.cssWidth ?? 0,
                size?.cssHeight ?? 0,
              );
              if (rendered && socket === opened && !stopped && !shown) {
                shown = true;
                failures = 0;
                setStatus("live");
              }
            }
          } catch (error) {
            if (stopped || socket !== opened || !canvas.current) return;
            socket = null;
            opened.close();
            show(null);
            setProblem(detail(error, "Couldn't display the browser page."));
            setStatus("failed");
          } finally {
            decoding = false;
          }
        };

        opened.addEventListener("message", ({ data }) => {
          if (stopped || socket !== opened) return;
          if (typeof data === "string") {
            try {
              const url = screencastPage(data);
              if (url) setPage(url);
            } catch {
              // The next valid message can still be shown.
            }
          } else if (data instanceof ArrayBuffer) {
            const frame = screencastFrame(data);
            if (!frame) return;
            size = frame.size ?? size;
            waiting = frame.jpeg;
            if (!decoding) void draw();
          }
        });
        opened.addEventListener("close", ({ code }) => {
          if (stopped || socket !== opened) return;
          socket = null;
          show(null);
          const closed = screencastClosed(code, ++failures);
          if ("failed" in closed) {
            setProblem(closed.failed);
            setStatus("failed");
          } else {
            setStatus("connecting");
            retry = setTimeout(() => void connect(), closed.retryMs);
          }
        });
      } catch (error) {
        if (stopped) return;
        setProblem(detail(error, "Couldn't open the live view."));
        setStatus("failed");
        retry = setTimeout(() => void connect(), viewRetryMs(++failures));
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
      unfollow?.();
      current.current = null;
      if (held.current) releasing.current = held.current.release();
      held.current = null;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- An explicit reconnect starts a fresh stream.
  }, [active, attempt, canvas, demo, provider, sessionId]);

  useEffect(() => {
    const changed = previousActivity.current !== activity;
    previousActivity.current = activity;
    if (!changed || !active || demo || !provider || !sessionId) return;
    const tab = current.current;
    if (!tab) {
      setAttempt((n) => n + 1);
      return;
    }
    let cancelled = false;
    void agentApi
      .browserView(provider, sessionId, {
        width: 320,
        height: 320,
        except: tab.targetId,
      })
      .then(
        (view) => {
          if (!cancelled && current.current === tab && view?.targetId !== tab.targetId)
            setAttempt((n) => n + 1);
        },
        () => {},
      );
    return () => {
      cancelled = true;
    };
  }, [active, activity, demo, provider, sessionId]);

  function release() {
    if (held.current) releasing.current = held.current.release();
    held.current = null;
    setControl(null);
    setChooser(null);
  }

  async function take() {
    const target = current.current;
    if (!target || control) return;
    if (demo) {
      setControl("held");
      return;
    }
    if (!provider) return;
    setControl("taking");
    await releasing.current;
    if (current.current !== target || held.current) return;
    const lost = (error: unknown) => {
      if (held.current !== input) return;
      release();
      showNotice({
        tone: "error",
        title: "Lost control of the browser",
        body: detail(error, "The browser is no longer under your control."),
      });
    };
    const hold = holdBrowser(provider, target, lost);
    const input = controlInput(hold, lost);
    held.current = input;
    await hold.ready.catch(() => {});
    if (held.current === input) setControl("held");
  }

  return {
    tab,
    status,
    problem,
    page,
    pointer,
    typing,
    field,
    dialog,
    chooser,
    control,
    take,
    release,
    reconnect: () => setAttempt((n) => n + 1),
    send: (events: unknown[]) => held.current?.send(events),
    wheel: (event: BrowserWheel) => held.current?.wheel(event),
    go(event: unknown) {
      setField(false);
      held.current?.send([event]);
    },
    answer(accept: boolean, promptText?: string) {
      held.current?.send([{ type: "dialog", accept, promptText }]);
      setDialog(null);
    },
    async choose(pick: () => Promise<Parameters<typeof chooseBrowserFiles>[2]>) {
      const target = current.current;
      const input = held.current;
      setChooser(null);
      if (!provider || !target || !input) return;
      const files = await pick().catch((error: unknown) => {
        showNotice({ tone: "error", title: detail(error, "Couldn't open the file picker.") });
        return [];
      });
      if (current.current === target && held.current === input)
        await chooseBrowserFiles(provider, target, files);
    },
  };
}
