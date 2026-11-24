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

/** A screencast frame (OpenClaw's): a 4-byte header length, the header's JSON, then the JPEG. */
export function screencastFrame(buffer: ArrayBuffer): {
  /** The page's size in CSS pixels, which the agent's pointer and your clicks are in. */
  size: { cssWidth: number; cssHeight: number } | null;
  jpeg: Uint8Array<ArrayBuffer>;
} {
  const header = new DataView(buffer).getUint32(0);
  const meta = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, header))) as {
    cssWidth?: number;
    cssHeight?: number;
  };
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
): { send: (seq: number, events: unknown[]) => Promise<unknown>; release: () => void } {
  const input = (request: { take?: boolean; seq?: number; events?: unknown[] }) =>
    agentApi.browserInput(provider, { ...tab, ...request });
  input({ take: true }).catch(onLost);
  const heartbeat = setInterval(() => input({ take: true }).catch(onLost), HEARTBEAT_MS);
  return {
    send: (seq, events) => input({ seq, events }),
    release: () => {
      clearInterval(heartbeat);
      void input({ take: false }).catch(() => {});
    },
  };
}

export type PageDialog = { dialogType: string; message: string; defaultPrompt: string };

/** What happens on the agent's tab: its pointer and typing, the page's dialogs and file pickers, copies. */
export type BrowserEvent =
  | { type: "pointer"; x: number; y: number; click: boolean }
  | { type: "typing"; x: number; y: number; width: number; height: number }
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
        if (since === undefined || result.run !== run) onDialog(result.dialog);
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
