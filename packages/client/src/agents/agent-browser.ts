import type { ChatTurn } from "@otter/contracts/chats";
import { host } from "../host.ts";
import { agentApi, type ProviderKind } from "./api.ts";

/** The agent's browser tab being watched: which tab, in which of the gateway's browser profiles. */
export type BrowserTab = { targetId: string; profile?: string };

/** Held tabs are let go a while after the last heartbeat, so a closed app never keeps one. */
const HEARTBEAT_MS = 10_000;
/** How long one request for what happens on the tab waits for something to. */
const EVENTS_WAIT_MS = 20_000;
/** Files travel to the gateway in one message. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * How much the agent has browsed in a chat: its browser steps, and how many of those are done.
 * Either changing means the agent may be on another tab.
 */
export function browserActivity(turns: ChatTurn[]): { steps: number; done: number } {
  let steps = 0;
  let done = 0;
  for (const turn of turns)
    for (const item of turn.items ?? [])
      if (item.kind === "step" && item.step.title === "Browser") {
        steps++;
        if (item.output !== undefined) done++;
      }
  return { steps, done };
}

const decoder = new TextDecoder();

/** A screencast frame (OpenClaw's): a 4-byte header length, the header's JSON, then the JPEG. Null when cut short. */
export function screencastFrame(buffer: ArrayBuffer): {
  /** The page's size in CSS pixels, which the agent's pointer and your clicks are in. */
  size: { cssWidth: number; cssHeight: number } | null;
  jpeg: Uint8Array<ArrayBuffer>;
} | null {
  if (buffer.byteLength < 4) return null;
  const header = new DataView(buffer).getUint32(0);
  if (buffer.byteLength < 4 + header) return null;
  let meta: { cssWidth?: number; cssHeight?: number };
  try {
    meta = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, header))) as typeof meta;
  } catch {
    return null;
  }
  return {
    size:
      meta.cssWidth && meta.cssHeight
        ? { cssWidth: meta.cssWidth, cssHeight: meta.cssHeight }
        : null,
    jpeg: new Uint8Array(buffer, 4 + header),
  };
}

/** The page a screencast's text message says the tab is on, when it says. */
export function screencastPage(message: string): string | null {
  const parsed = JSON.parse(message) as { type?: string; url?: string };
  return parsed.url && (parsed.type === "ready" || parsed.type === "meta") ? parsed.url : null;
}

/**
 * What a screencast closing means: the gateway won't show it (a message to show), or it went and
 * is asked for again after `retryMs` (`failures`: how many times in a row it failed).
 */
export function screencastClosed(
  code: number,
  failures: number,
): { failed: string } | { retryMs: number } {
  if (code === 4003) return { failed: "OpenClaw stopped the view: it doesn't allow that address." };
  if (code === 4005) return { failed: "This browser can't be watched live." };
  // The tab closed (4004) or the stream dropped: ask again, as often as it keeps working.
  return { retryMs: code === 4004 ? 300 : Math.min(1000 * 2 ** failures, 15000) };
}

/** When to ask for the live view again after asking failed `failures` times in a row. */
export const viewRetryMs = (failures: number) => Math.min(2000 * 2 ** failures, 30000);

/**
 * Takes control of the agent's tab and keeps it (a heartbeat), until `release`. `send` gives the
 * tab your input, in order; `onLost`: the gateway took it back, or never gave it.
 */
export function holdBrowser(
  provider: ProviderKind,
  tab: BrowserTab,
  onLost: (error: unknown) => void,
): {
  ready: Promise<unknown>;
  send: (seq: number, events: unknown[]) => Promise<unknown>;
  release: () => Promise<void>;
} {
  const input = (request: { take?: boolean; seq?: number; events?: unknown[] }) =>
    agentApi.browserInput(provider, { ...tab, ...request });
  let pending: Promise<unknown> | null = null;
  let released = false;
  const take = () => {
    const request = input({ take: true });
    pending = request;
    void request.then(
      () => {
        pending = null;
      },
      (error) => {
        pending = null;
        if (!released) onLost(error);
      },
    );
    return request;
  };
  const ready = take();
  const heartbeat = setInterval(() => {
    if (!pending) void take();
  }, HEARTBEAT_MS);
  return {
    ready,
    send: (seq, events) => input({ seq, events }),
    release: async () => {
      released = true;
      clearInterval(heartbeat);
      await pending?.catch(() => {});
      await input({ take: false }).catch(() => {});
    },
  };
}

export type PageDialog = { dialogType: string; message: string; defaultPrompt: string };

/**
 * What happens on the agent's tab: its pointer and typing, whether a field that takes typing has
 * the focus (a phone's keyboard), the page's dialogs and file pickers, copies.
 */
export type BrowserEvent =
  | { type: "pointer"; x: number; y: number; click: boolean }
  | { type: "typing"; x: number; y: number; width: number; height: number }
  | { type: "field"; editable: boolean }
  | { type: "dialog"; dialog: PageDialog }
  | { type: "dialogClosed" }
  | { type: "clipboard"; text: string }
  | { type: "fileChooser"; multiple: boolean };

function browserEvent(event: { type: string } & Record<string, unknown>): BrowserEvent | null {
  switch (event.type) {
    case "pointer":
      return {
        type: "pointer",
        x: event.x as number,
        y: event.y as number,
        click: event.phase === "click",
      };
    case "typing":
      return {
        type: "typing",
        x: event.x as number,
        y: event.y as number,
        width: event.width as number,
        height: event.height as number,
      };
    case "field":
      return { type: "field", editable: event.editable === true };
    case "dialog":
      return {
        type: "dialog",
        dialog: {
          dialogType: String(event.dialogType),
          message: String(event.message),
          defaultPrompt: String(event.defaultPrompt ?? ""),
        },
      };
    case "dialogClosed":
      return { type: "dialogClosed" };
    case "clipboard":
      return { type: "clipboard", text: String(event.text) };
    case "fileChooser":
      return { type: "fileChooser", multiple: event.multiple === true };
    default:
      return null;
  }
}

/**
 * Follows what happens on the agent's tab (a long poll), from the moment the tab is known: a page
 * held up by a dialog sends no frames until it's answered. `onDialog` hears the dialog open when
 * the plugin starts over (or on the first answer); returns a way to stop.
 */
export function followBrowser(
  provider: ProviderKind,
  tab: BrowserTab,
  {
    onEvent,
    onDialog,
  }: { onEvent: (event: BrowserEvent) => void; onDialog: (dialog: PageDialog | null) => void },
): () => void {
  let stopped = false;
  let since: number | undefined;
  let run: string | undefined;
  let failures = 0;
  void (async () => {
    for (;;) {
      if (stopped) return;
      try {
        const result = await agentApi.browserEvents(provider, {
          ...tab,
          since,
          run,
          waitMs: since === undefined ? 0 : EVENTS_WAIT_MS,
        });
        if (stopped || !result) return;
        // A first answer, or the plugin started over: take its state as it is.
        if (since === undefined || result.run !== run) {
          onDialog(result.dialog);
          onEvent({ type: "field", editable: result.field === true });
        }
        run = result.run;
        for (const raw of result.events) {
          const event = browserEvent(raw);
          if (event) onEvent(event);
        }
        since = result.seq;
        failures = 0;
      } catch (error) {
        // A gateway being updated, or without the plugin's events yet: ask again, less often.
        if (stopped) return;
        failures += 1;
        const later = /update the Otter plugin/.test(String(error)) ? 60_000 : 15_000;
        await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** failures, later)));
      }
    }
  })();
  return () => {
    stopped = true;
  };
}

/**
 * Answers the page's file picker with these files (none cancels it), saying so when they're too
 * large or don't go. `data`: a file's bytes as base64.
 */
export async function chooseBrowserFiles(
  provider: ProviderKind,
  tab: BrowserTab,
  files: { name: string; size: number; data: () => Promise<string> }[],
): Promise<void> {
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_UPLOAD_BYTES) {
    host().notice({
      tone: "error",
      title: "Those files are too large to send to the agent's browser (10 MB at most).",
    });
    files = [];
  }
  try {
    const encoded = await Promise.all(
      files.map(async (file) => ({ name: file.name, data: await file.data() })),
    );
    await agentApi.browserUpload(provider, { ...tab, files: encoded });
  } catch (error) {
    host().notice({
      tone: "error",
      title: error instanceof Error ? error.message : "Couldn't send the files.",
    });
  }
}

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/**
 * A frame fitted into a view of `view`'s size, against its top and centered across: where it
 * sits (`rect`), view points per page CSS px (`scale`), and the page's point under a point of the
 * view (none outside the frame, unless `clamped`) and back. Null while any size is unknown.
 */
export function browserFit(view: Size, image: Size, css: Size) {
  if (![view, image, css].every((s) => s.width > 0 && s.height > 0)) return null;
  const fit = Math.min(view.width / image.width, view.height / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  const rect = { x: (view.width - width) / 2, y: 0, width, height };
  const scale = width / css.width;
  return {
    rect,
    scale,
    page(point: Point, clamped = false): Point | null {
      const x = ((point.x - rect.x) / width) * css.width;
      const y = ((point.y - rect.y) / height) * css.height;
      if (!clamped && (x < 0 || y < 0 || x > css.width || y > css.height)) return null;
      return {
        x: Math.min(Math.max(x, 0), css.width),
        y: Math.min(Math.max(y, 0), css.height),
      };
    },
    view: (point: Point): Point => ({ x: rect.x + point.x * scale, y: rect.y + point.y * scale }),
  };
}

/** A tap on the page, as the gateway replays input: the pointer goes there, presses and lets go. */
export function tapInput(at: Point, clickCount = 1) {
  const mouse = (action: string, button: string, buttons: number, count: number) => ({
    type: "mouse",
    action,
    ...at,
    button,
    buttons,
    clickCount: count,
    modifiers: 0,
  });
  return [
    mouse("move", "none", 0, 0),
    mouse("down", "left", 1, clickCount),
    mouse("up", "left", 0, clickCount),
  ];
}

/** A key typed on a phone's keyboard, down and up: Return, Backspace, or a character with its key where known. */
export function keyInput(char: string) {
  const [key, code, keyCode, text]: [string, string, number, string | undefined] =
    char === "\n" || char === "\r"
      ? ["Enter", "Enter", 13, "\r"]
      : char === "\b"
        ? ["Backspace", "Backspace", 8, undefined]
        : char === " "
          ? [" ", "Space", 32, " "]
          : /^[a-z]$/i.test(char)
            ? [char, `Key${char.toUpperCase()}`, char.toUpperCase().charCodeAt(0), char]
            : /^\d$/.test(char)
              ? [char, `Digit${char}`, char.charCodeAt(0), char]
              : [char, "", 0, char];
  const event = (action: string, withText: boolean) => ({
    type: "key",
    action,
    key,
    code,
    keyCode,
    ...(withText && text !== undefined && { text }),
    modifiers: 0,
  });
  return [event("down", true), event("up", false)];
}
