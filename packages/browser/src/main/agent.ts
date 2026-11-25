/**
 * The agents' hands on the browser: Chrome's DevTools protocol on each tab, as Aside's agent and
 * Playwright drive Chromium. Pages are read frame by frame, cross-site ones (an extension's
 * menu in the page, 1Password's) through their own sessions, and clicks and keys go in as the
 * user's own input would (trusted), which extensions such as 1Password require.
 */
import { webContents, type WebContents } from "electron";

import { getBrowserSession } from "./browser.ts";
import { createTab, currentTabId, openTabIds } from "./extensions.ts";

type Session = string | undefined;

type Frame = {
  frameId: string;
  /** The DevTools session the frame's process answers on; undefined: the tab's own. */
  session: Session;
  url: string;
  contextId: number;
};

type Attached = {
  /** Cross-site frames' sessions, by the frame (target) id they show. */
  frameSessions: Map<string, { session: string; parent: Session }>;
  /** The frames of the last snapshot, by their index in its refs. */
  frames: Frame[];
  /** Which snapshot the refs are from: refs of an older one (another agent's) are refused. */
  snapshot: number;
};

const attached = new Map<number, Attached>();

const WORLD = "otter-agent";
const MAX_SNAPSHOT = 40_000;

function tab(tabId: unknown): WebContents {
  const contents = typeof tabId === "number" ? webContents.fromId(tabId) : undefined;
  if (!contents || contents.isDestroyed() || contents.session !== getBrowserSession()) {
    throw new Error("No such tab: list them with browser_tabs.");
  }
  return contents;
}

const send = (contents: WebContents, method: string, params: object = {}, session?: Session) =>
  contents.debugger.sendCommand(method, params, session) as Promise<any>;

async function attach(contents: WebContents): Promise<Attached> {
  const existing = attached.get(contents.id);
  if (existing && contents.debugger.isAttached()) return existing;
  if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
  const state: Attached = { frameSessions: new Map(), frames: [], snapshot: 0 };
  attached.set(contents.id, state);
  contents.debugger.on("detach", () => attached.delete(contents.id));
  contents.once("destroyed", () => attached.delete(contents.id));
  const autoAttach = (session?: string) =>
    send(
      contents,
      "Target.setAutoAttach",
      { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
      session,
    ).catch(() => {});
  contents.debugger.on("message", (_event, method, params, sessionId) => {
    if (method === "Target.attachedToTarget" && params.targetInfo.type === "iframe") {
      state.frameSessions.set(params.targetInfo.targetId, {
        session: params.sessionId,
        parent: sessionId || undefined,
      });
      void autoAttach(params.sessionId);
    } else if (method === "Target.detachedFromTarget") {
      for (const [frameId, frame] of state.frameSessions) {
        if (frame.session === params.sessionId) state.frameSessions.delete(frameId);
      }
    }
  });
  await autoAttach();
  // A page in a tab the user isn't looking at still behaves as focused: 1Password's menu opens on focus.
  await send(contents, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  return state;
}

type FrameNode = { frame: { id: string; url: string }; childFrames?: FrameNode[] };

/** Every frame of the tab, each in the session its process answers on, with an isolated world to read it. */
async function frames(contents: WebContents, state: Attached): Promise<Frame[]> {
  const found: Frame[] = [];
  const visit = async (session: Session) => {
    const { frameTree } = (await send(contents, "Page.getFrameTree", {}, session)) as {
      frameTree: FrameNode;
    };
    const walk = async (node: FrameNode, root: boolean) => {
      const own = state.frameSessions.get(node.frame.id);
      if (own && !root) return; // a cross-site frame: read in its own session
      try {
        const { executionContextId } = await send(
          contents,
          "Page.createIsolatedWorld",
          { frameId: node.frame.id, worldName: WORLD, grantUniveralAccess: false },
          session,
        );
        found.push({
          frameId: node.frame.id,
          session,
          url: node.frame.url,
          contextId: executionContextId,
        });
      } catch {
        // A frame gone or not yet loaded.
      }
      for (const child of node.childFrames ?? []) await walk(child, false);
    };
    await walk(frameTree, true);
  };
  await visit(undefined);
  for (const { session } of state.frameSessions.values()) await visit(session).catch(() => {});
  return found;
}

/** Runs in each frame's isolated world: the page as a tree of what can be read and used, with refs. */
function readFrame(prefix: string): string {
  const refs = new Map<string, Element>();
  (globalThis as unknown as { __otterRefs: Map<string, Element> }).__otterRefs = refs;
  const lines: string[] = [];
  let count = 0;
  const clip = (text: string, max = 80) => {
    const one = text.replace(/\s+/g, " ").trim();
    return one.length > max ? `${one.slice(0, max)}…` : one;
  };
  const hidden = (el: Element) => {
    if (el.getAttribute("aria-hidden") === "true") return true;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return true;
    const rect = el.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 && style.display !== "contents";
  };
  const roleOf = (el: Element): string | null => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a" && el.hasAttribute("href")) return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "iframe") return "iframe";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img" && el.getAttribute("alt")) return "img";
    if (tag === "input") {
      const type = (el as HTMLInputElement).type;
      if (type === "hidden") return null;
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox" || type === "radio") return type;
      return "textbox";
    }
    if ((el as HTMLElement).isContentEditable && !el.parentElement?.isContentEditable) {
      return "textbox";
    }
    // Something made focusable to be clicked (a CAPTCHA's image tiles).
    if ((el as HTMLElement).tabIndex >= 0 && el.hasAttribute("tabindex")) return "button";
    return null;
  };
  const nameOf = (el: Element): string => {
    const labelledBy = el.getAttribute("aria-labelledby");
    const byIds = labelledBy
      ?.split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    const input = el as HTMLInputElement;
    const label = input.labels?.[0]?.textContent;
    return clip(
      el.getAttribute("aria-label") ||
        byIds ||
        label ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        (["button", "submit"].includes(input.type) ? input.value : "") ||
        (el as HTMLElement).innerText ||
        "",
    );
  };
  const interactive = new Set([
    "link",
    "button",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "menuitemcheckbox",
    "option",
    "slider",
    "spinbutton",
    "treeitem",
    "listbox",
  ]);
  const walk = (node: Node, depth: number) => {
    if (lines.length > 1500) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const text = clip(node.textContent ?? "", 160);
      if (text) lines.push(`${"  ".repeat(depth)}- text: ${text}`);
      return;
    }
    if (!(node instanceof Element)) return;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG"].includes(node.tagName.toUpperCase())) {
      return;
    }
    if (hidden(node)) return;
    const role = roleOf(node);
    let next = depth;
    if (role && (interactive.has(role) || role === "iframe")) {
      const ref = `${prefix}e${++count}`;
      refs.set(ref, node);
      const input = node as HTMLInputElement;
      const state = [
        node === node.ownerDocument.activeElement ? "focused" : "",
        input.disabled ? "disabled" : "",
        role === "checkbox" || role === "radio" ? (input.checked ? "checked" : "unchecked") : "",
        node.getAttribute("aria-expanded") === "true" ? "expanded" : "",
        node.getAttribute("aria-selected") === "true" ? "selected" : "",
      ].filter(Boolean);
      const value =
        role === "textbox" || role === "combobox" || role === "searchbox"
          ? input.type === "password" || /password/.test(input.autocomplete)
            ? input.value
              ? ' value="••••"'
              : ""
            : input.value
              ? ` value="${clip(input.value, 60)}"`
              : ""
          : "";
      const type = node.tagName === "INPUT" && input.type !== "text" ? ` type=${input.type}` : "";
      lines.push(
        `${"  ".repeat(depth)}- ${role} "${nameOf(node)}"${type}${value}${state.length ? ` [${state.join(", ")}]` : ""} [ref=${ref}]`,
      );
      if (role !== "iframe" && role !== "textbox") next = depth + 1;
      if (node.tagName === "SELECT") {
        for (const option of (node as HTMLSelectElement).options) {
          lines.push(
            `${"  ".repeat(depth + 1)}- option "${clip(option.text)}"${option.selected ? " [selected]" : ""}`,
          );
        }
        return;
      }
      if (role === "link" || role === "button") {
        // Their text is their name.
        return;
      }
    } else if (role === "heading" || role === "img") {
      lines.push(`${"  ".repeat(depth)}- ${role} "${nameOf(node)}"`);
      return;
    }
    const root = (node as HTMLElement).shadowRoot;
    for (const child of root ? root.childNodes : node.childNodes) walk(child, next);
  };
  walk(document.body ?? document.documentElement, 0);
  return lines.join("\n");
}

const extensionName = (url: string) => {
  const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1];
  return id ? getBrowserSession().extensions.getExtension(id)?.name : undefined;
};

export async function snapshot(tabId: unknown): Promise<string> {
  const contents = tab(tabId);
  const state = await attach(contents);
  state.frames = await frames(contents, state);
  const taken = ++state.snapshot;
  const parts: string[] = [`Tab ${contents.id}: ${contents.getTitle()} (${contents.getURL()})`];
  for (const [index, frame] of state.frames.entries()) {
    const { result, exceptionDetails } = await send(
      contents,
      "Runtime.evaluate",
      {
        expression: `(${readFrame.toString()})(${JSON.stringify(`s${taken}f${index}`)})`,
        contextId: frame.contextId,
        returnByValue: true,
      },
      frame.session,
    ).catch(() => ({ result: { value: "" } }));
    if (exceptionDetails || !result.value) continue;
    const name = extensionName(frame.url);
    const heading =
      index === 0
        ? ""
        : name
          ? `\nframe [extension="${name}"] (${frame.url})`
          : `\nframe (${frame.url})`;
    parts.push(`${heading}${heading ? "\n" : ""}${result.value}`);
  }
  const text = parts.join("\n");
  return text.length > MAX_SNAPSHOT
    ? `${text.slice(0, MAX_SNAPSHOT)}\n… (cut: the page is long; scroll and snapshot again)`
    : text;
}

/** A ref's element as a remote object in its frame. */
async function element(contents: WebContents, ref: unknown) {
  const state = attached.get(contents.id);
  const match = typeof ref === "string" ? /^s(\d+)f(\d+)e\d+$/.exec(ref) : null;
  if (match && Number(match[1]) !== state?.snapshot) {
    throw new Error(`Element ${String(ref)} is from an older snapshot: take a new one.`);
  }
  const frame = match ? state?.frames[Number(match[2])] : undefined;
  if (!frame) throw new Error(`No element ${String(ref)}: take a new snapshot.`);
  const { result } = await send(
    contents,
    "Runtime.evaluate",
    {
      expression: `globalThis.__otterRefs?.get(${JSON.stringify(ref)}) ?? null`,
      contextId: frame.contextId,
    },
    frame.session,
  ).catch(() => ({ result: {} }));
  if (!result?.objectId) throw new Error(`Element ${String(ref)} is gone: take a new snapshot.`);
  return { frame, objectId: result.objectId as string };
}

const centerOf = (quad: number[]) => ({
  x: (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4,
  y: (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4,
});

/** Where a frame's own viewport starts in the tab's, through the iframes it sits in across processes. */
async function offsetOf(
  contents: WebContents,
  session: Session,
): Promise<{ x: number; y: number }> {
  if (!session) return { x: 0, y: 0 };
  const state = attached.get(contents.id)!;
  const entry = [...state.frameSessions].find(([, s]) => s.session === session);
  if (!entry) return { x: 0, y: 0 };
  const [frameId, { parent }] = entry;
  await send(contents, "DOM.getDocument", { depth: 0 }, parent);
  const { backendNodeId } = await send(contents, "DOM.getFrameOwner", { frameId }, parent);
  const { model } = await send(contents, "DOM.getBoxModel", { backendNodeId }, parent);
  const above = await offsetOf(contents, parent);
  return { x: above.x + model.content[0], y: above.y + model.content[1] };
}

async function pointAt(contents: WebContents, ref: unknown) {
  const { frame, objectId } = await element(contents, ref);
  await send(contents, "DOM.getDocument", { depth: 0 }, frame.session);
  await send(contents, "DOM.scrollIntoViewIfNeeded", { objectId }, frame.session).catch(() => {});
  const { quads } = await send(contents, "DOM.getContentQuads", { objectId }, frame.session);
  if (!quads?.length) throw new Error(`Element ${String(ref)} isn't on screen.`);
  const local = centerOf(quads[0]);
  const offset = await offsetOf(contents, frame.session);
  return { x: local.x + offset.x, y: local.y + offset.y };
}

async function settle(contents: WebContents): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400));
  if (!contents.isLoading()) return;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    contents.once("did-stop-loading", done);
    setTimeout(done, 10_000);
  });
}

async function click(contents: WebContents, args: Record<string, unknown>): Promise<void> {
  const { x, y } =
    typeof args.x === "number" && typeof args.y === "number"
      ? { x: args.x, y: args.y }
      : await pointAt(contents, args.ref);
  await send(contents, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (const type of ["mousePressed", "mouseReleased"]) {
    await send(contents, "Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
}

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Backspace: { code: "Backspace", keyCode: 8 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  PageDown: { code: "PageDown", keyCode: 34 },
  PageUp: { code: "PageUp", keyCode: 33 },
  Home: { code: "Home", keyCode: 36 },
  End: { code: "End", keyCode: 35 },
  Space: { code: "Space", keyCode: 32, text: " " },
};

async function press(contents: WebContents, key: unknown): Promise<void> {
  const spec = typeof key === "string" ? KEYS[key] : undefined;
  if (!spec) throw new Error(`Unknown key: use one of ${Object.keys(KEYS).join(", ")}.`);
  const name = key === "Space" ? " " : (key as string);
  const base = { key: name, code: spec.code, windowsVirtualKeyCode: spec.keyCode };
  await send(contents, "Input.dispatchKeyEvent", {
    type: spec.text ? "keyDown" : "rawKeyDown",
    ...base,
    ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}),
  });
  await send(contents, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function type(contents: WebContents, args: Record<string, unknown>): Promise<void> {
  if (args.ref !== undefined) {
    await click(contents, { ref: args.ref });
    const { frame, objectId } = await element(contents, args.ref);
    if (args.replace !== false) {
      await send(
        contents,
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration:
            "function () { if ('select' in this) this.select(); else document.getSelection()?.selectAllChildren(this); }",
        },
        frame.session,
      );
    }
  }
  if (typeof args.text !== "string") throw new Error('"text" is required.');
  await send(contents, "Input.insertText", { text: args.text });
  if (args.submit === true) await press(contents, "Enter");
}

async function scroll(contents: WebContents, args: Record<string, unknown>): Promise<void> {
  const [width, height] = (await contents.executeJavaScript(
    "[innerWidth, innerHeight]",
  )) as number[];
  const down = args.direction !== "up";
  await send(contents, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: width! / 2,
    y: height! / 2,
    deltaX: 0,
    deltaY: (down ? 1 : -1) * height! * 0.8,
  });
}

function tabs() {
  const active = currentTabId();
  return openTabIds().map((id) => {
    const contents = webContents.fromId(id)!;
    return { tabId: id, url: contents.getURL(), title: contents.getTitle(), active: id === active };
  });
}

/** What the agents' browser tools ask for, by name (core's tools/browser.ts). */
export async function runAgentBrowser(
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (command) {
    case "tabs":
      return tabs();
    case "open": {
      const url = String(args.url ?? "");
      const tabId = await createTab(/^[a-z-]+:/i.test(url) ? url : `https://${url}`, true);
      if (tabId === null) throw new Error("Couldn't open that page.");
      const contents = tab(tabId);
      await settle(contents);
      return snapshot(tabId);
    }
    case "navigate": {
      const contents = tab(args.tabId);
      const url = String(args.url ?? "");
      if (url === "back") contents.navigationHistory.goBack();
      else if (url === "forward") contents.navigationHistory.goForward();
      else await contents.loadURL(/^[a-z-]+:/i.test(url) ? url : `https://${url}`).catch(() => {});
      await settle(contents);
      return snapshot(args.tabId);
    }
    case "snapshot":
      return snapshot(args.tabId);
    case "click": {
      const contents = tab(args.tabId);
      await click(contents, args);
      await settle(contents);
      return snapshot(args.tabId);
    }
    case "type": {
      const contents = tab(args.tabId);
      await type(contents, args);
      await settle(contents);
      return snapshot(args.tabId);
    }
    case "press": {
      const contents = tab(args.tabId);
      await press(contents, args.key);
      await settle(contents);
      return snapshot(args.tabId);
    }
    case "scroll": {
      const contents = tab(args.tabId);
      await scroll(contents, args);
      await settle(contents);
      return snapshot(args.tabId);
    }
    case "screenshot": {
      const contents = tab(args.tabId);
      const [width] = (await contents.executeJavaScript("[innerWidth]")) as number[];
      // In the page's own pixels, so a point in it is one browser_click takes.
      const image = (await contents.capturePage()).resize({ width: width! });
      return { image: image.toPNG().toString("base64"), mimeType: "image/png" };
    }
  }
  throw new Error(`No browser command "${command}".`);
}
