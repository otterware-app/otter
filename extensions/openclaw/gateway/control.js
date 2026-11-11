import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** A held tab is released this long after Otter last sent input or a heartbeat (it quit, say). */
export const CONTROL_TTL_MS = 30_000;
/** How long a batch waits for one sent before it, before giving up on that one. */
const GAP_MS = 150;
/** A tab nobody watches or holds for this long loses its DevTools connection. */
const IDLE_MS = 60_000;
const EVENTS_KEPT = 200;
const CALL_TIMEOUT_MS = 5_000;
/** Files travel base64 in one gateway message (16 MB at most). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOADS_KEPT_MS = 10 * 60_000;

/** What the agent's browser tool may still do while you hold a tab: read pages, not act on them. */
export const READ_ACTIONS = new Set([
  "doctor",
  "status",
  "tabs",
  "snapshot",
  "screenshot",
  "requests",
  "errors",
  "text",
]);

const WORLD = "otter-watch";
const BINDING = "__otterSaw";
/**
 * Runs in a world of its own, where the page can't see or stop it: where clicks land, the field
 * being typed in, whether what has focus takes text (a phone shows its keyboard for it), and what
 * you copy (Chromium's clipboard isn't yours, so the copy is read here).
 */
const WATCH_SCRIPT = `(() => {
  if (globalThis.${BINDING}Ready || window !== top) return;
  globalThis.${BINDING}Ready = true;
  const say = (event) => { try { ${BINDING}(JSON.stringify(event)); } catch {} };
  let move = null;
  addEventListener("pointermove", (event) => {
    if (!event.isTrusted) return;
    if (!move) setTimeout(() => { say(move); move = null; }, 33);
    move = { type: "pointer", phase: "move", x: event.clientX, y: event.clientY };
  }, true);
  addEventListener("pointerdown", (event) => {
    if (event.isTrusted) say({ type: "pointer", phase: "click", x: event.clientX, y: event.clientY });
  }, true);
  const field = () => {
    let found = document.activeElement;
    while (found?.shadowRoot?.activeElement) found = found.shadowRoot.activeElement;
    return found;
  };
  const editable = () => {
    const found = field();
    return !!found && (found.isContentEditable || found instanceof HTMLTextAreaElement ||
      (found instanceof HTMLInputElement && /^(?:text|search|url|tel|email|password|number)$/.test(found.type)));
  };
  // After the event: moving between two fields is one field losing focus and the next gaining it.
  const sayField = () => setTimeout(() => say({ type: "field", editable: editable() }));
  // A new page starts with nothing focused, and the one before it never said it lost its field.
  sayField();
  addEventListener("focusin", sayField, true);
  addEventListener("focusout", sayField, true);
  let copying = false;
  addEventListener("keydown", (event) => {
    if (!event.isTrusted) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (key === "c" || key === "x")) {
      copying = true;
      setTimeout(() => { copying = false; });
    }
    const typed = field();
    if (!typed || typed === document.body || typed === document.documentElement) return;
    const box = typed.getBoundingClientRect();
    say({ type: "typing", x: box.x, y: box.y, width: box.width, height: box.height });
  }, true);
  const selection = () => {
    const typed = field();
    if ((typed instanceof HTMLInputElement || typed instanceof HTMLTextAreaElement) && typed.selectionStart !== null)
      return typed.value.slice(typed.selectionStart, typed.selectionEnd ?? typed.selectionStart);
    return String(document.getSelection() ?? "");
  };
  for (const type of ["copy", "cut"]) {
    addEventListener(type, (event) => {
      if (copying && event.isTrusted) say({ type: "clipboard", text: selection().slice(0, 1048576) });
    }, true);
    addEventListener(type, (event) => {
      if (!copying || !event.isTrusted || !event.defaultPrevented) return;
      const text = event.clipboardData?.getData("text/plain");
      if (text) say({ type: "clipboard", text: text.slice(0, 1048576) });
    });
  }
})();`;

const MOUSE_TYPES = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" };
const BUTTONS = new Set(["none", "left", "middle", "right"]);
const num = (value) => (Number.isFinite(value) ? value : 0);

/** Headless Linux Chromium only copies, cuts (and with ⌘, selects all or undoes) when told to. */
export function editingCommand(key, modifiers) {
  const modifier = modifiers & 0b0111;
  if (modifier !== 2 && modifier !== 4) return null;
  const lower = key.toLowerCase();
  const command =
    lower === "c"
      ? "copy"
      : lower === "x"
        ? "cut"
        : modifier !== 4
          ? null
          : lower === "a"
            ? "selectAll"
            : lower === "z"
              ? modifiers & 8
                ? "redo"
                : "undo"
              : null;
  return command ? { commands: [command] } : null;
}

/** The DevTools call that replays one of Otter's input events, as a person's input. */
export function cdpInput(event) {
  const modifiers = num(event?.modifiers);
  switch (event?.type) {
    case "mouse":
      if (!MOUSE_TYPES[event.action]) return null;
      return [
        "Input.dispatchMouseEvent",
        {
          type: MOUSE_TYPES[event.action],
          x: num(event.x),
          y: num(event.y),
          button: BUTTONS.has(event.button) ? event.button : "none",
          buttons: num(event.buttons),
          clickCount: num(event.clickCount),
          modifiers,
        },
      ];
    case "wheel":
      return [
        "Input.dispatchMouseEvent",
        {
          type: "mouseWheel",
          x: num(event.x),
          y: num(event.y),
          deltaX: num(event.deltaX),
          deltaY: num(event.deltaY),
          modifiers,
        },
      ];
    case "key": {
      if (typeof event.key !== "string" || typeof event.code !== "string") return null;
      if (event.action === "up")
        return [
          "Input.dispatchKeyEvent",
          { type: "keyUp", key: event.key, code: event.code, modifiers },
        ];
      const text = typeof event.text === "string" ? event.text : undefined;
      return [
        "Input.dispatchKeyEvent",
        {
          type: text ? "keyDown" : "rawKeyDown",
          key: event.key,
          code: event.code,
          windowsVirtualKeyCode: num(event.keyCode),
          nativeVirtualKeyCode: num(event.keyCode),
          ...(text ? { text, unmodifiedText: text } : {}),
          ...editingCommand(event.key, modifiers),
          modifiers,
        },
      ];
    }
    case "text":
      return typeof event.text === "string"
        ? ["Input.insertText", { text: event.text.slice(0, 10_000) }]
        : null;
    case "dialog":
      return [
        "Page.handleJavaScriptDialog",
        {
          accept: event.accept === true,
          ...(typeof event.promptText === "string" ? { promptText: event.promptText } : {}),
        },
      ];
    case "navigate":
      return typeof event.url === "string" && /^https?:\/\//i.test(event.url)
        ? ["Page.navigate", { url: event.url }]
        : null;
    case "reload":
      return ["Page.reload", {}];
    default:
      return null;
  }
}

/** A page's own DevTools connection. Input goes without waiting for Chromium's replies. */
export async function connectTarget(cdpUrl, targetId) {
  const list = await fetch(new URL("/json/list", cdpUrl), { signal: AbortSignal.timeout(5000) })
    .then((response) => response.json())
    .catch(() => {
      throw new Error("Couldn't reach the agent's browser.");
    });
  const target = Array.isArray(list) ? list.find((t) => t?.id === targetId) : undefined;
  if (typeof target?.webSocketDebuggerUrl !== "string") throw new Error("That tab has closed.");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("Couldn't reach the agent's browser.")),
      {
        once: true,
      },
    );
  });
  let id = 0;
  const replies = new Map();
  const listeners = new Set();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id === undefined) {
      for (const listener of listeners) listener(message.method, message.params ?? {});
      return;
    }
    const reply = replies.get(message.id);
    if (!reply) return;
    replies.delete(message.id);
    if (message.error) reply.reject(new Error(message.error.message));
    else reply.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () => {
    for (const reply of replies.values()) reply.reject(new Error("That tab has closed."));
    replies.clear();
  });
  return {
    open: () => socket.readyState === WebSocket.OPEN,
    send: (method, params) => socket.send(JSON.stringify({ id: ++id, method, params })),
    // Bounded: a page showing a pop-up holds back what runs script in it, and a request left
    // waiting keeps the plugin from being updated.
    call: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => {
          replies.delete(n);
          reject(new Error("The agent's browser didn't answer."));
        }, CALL_TIMEOUT_MS);
        replies.set(n, {
          resolve: (value) => (clearTimeout(timer), resolve(value)),
          reject: (error) => (clearTimeout(timer), reject(error)),
        });
        socket.send(JSON.stringify({ id: n, method, params }));
      }),
    on: (listener) => listeners.add(listener),
    close: () => socket.close(),
  };
}

/**
 * The agent's tabs as Otter sees them: who holds which (and their input, replayed in the order
 * Otter numbered it however the gateway runs requests), and what happens on them (where the
 * pointer lands, what's typed in, pop-ups, file pickers, copies) for whoever watches.
 */
export function createBrowserControl({
  cdpUrlFor,
  answerDialog,
  openDialog,
  connect = connectTarget,
  now = Date.now,
  uploads = path.join(tmpdir(), "otter-uploads"),
}) {
  const tabs = new Map();
  // Event numbers start over when the plugin does (an update, a gateway restart): say which run.
  const run = randomUUID();

  let sweeper;
  const tabOf = (targetId) => {
    let tab = tabs.get(targetId);
    if (!tab) {
      tab = {
        targetId,
        lock: null,
        events: [],
        seq: 0,
        waiters: new Set(),
        seen: now(),
        chain: Promise.resolve(),
      };
      tabs.set(targetId, tab);
      sweeper ??= setInterval(() => sweep(), IDLE_MS);
      sweeper.unref?.();
    }
    return tab;
  };
  const holding = (targetId) => {
    const tab = tabs.get(targetId);
    if (tab?.lock && tab.lock.until > now()) return tab;
    if (tab?.lock) unlock(tab);
    return undefined;
  };
  const unlock = (tab) => {
    clearTimeout(tab.lock?.gap);
    for (const batch of tab.lock?.waiting.values() ?? []) batch.done();
    tab.lock = null;
    tab.chooser = null;
    void tab.page
      ?.then(
        (page) =>
          page.open() && page.call("Page.setInterceptFileChooserDialog", { enabled: false }),
      )
      .catch(() => {});
  };
  /** Lets go of tabs nobody has held or watched for a while, and their DevTools connections. */
  const sweep = (all = false) => {
    for (const [targetId, tab] of tabs) {
      if (!all && (holding(targetId) || now() - tab.seen < IDLE_MS)) continue;
      if (tab.lock) unlock(tab);
      for (const wake of tab.waiters) wake();
      tabs.delete(targetId);
      void tab.page?.then((page) => page.close()).catch(() => {});
    }
    if (tabs.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = undefined;
    }
  };
  const tell = (tab, event) => {
    tab.seq += 1;
    tab.events.push({ ...event, seq: tab.seq });
    if (tab.events.length > EVENTS_KEPT) tab.events.shift();
    for (const wake of tab.waiters) wake();
  };
  const watch = (tab, page) => {
    page.on((method, params) => {
      if (method === "Runtime.bindingCalled" && params.name === BINDING) {
        try {
          tell(tab, JSON.parse(params.payload));
        } catch {}
      } else if (method === "Page.javascriptDialogOpening") {
        tab.dialog = {
          dialogType: params.type,
          message: String(params.message ?? "").slice(0, 4000),
          defaultPrompt: String(params.defaultPrompt ?? "").slice(0, 4000),
        };
        tell(tab, { type: "dialog", ...tab.dialog });
      } else if (method === "Page.javascriptDialogClosed") {
        tab.dialog = null;
        tell(tab, { type: "dialogClosed" });
      } else if (method === "Page.fileChooserOpened" && tab.lock) {
        tab.chooser = { backendNodeId: params.backendNodeId };
        tell(tab, { type: "fileChooser", multiple: params.mode === "selectMultiple" });
      }
    });
    // Not waited for: a page showing a pop-up holds every command until it closes, and runs them
    // in order then. Binding calls only arrive with Runtime on (its other events are ignored).
    for (const [method, params] of [
      ["Runtime.enable", {}],
      ["Runtime.addBinding", { name: BINDING, executionContextName: WORLD }],
      ["Page.enable", {}],
      [
        "Page.addScriptToEvaluateOnNewDocument",
        { source: WATCH_SCRIPT, worldName: WORLD, runImmediately: true },
      ],
    ])
      void page.call(method, params).catch(() => {});
  };
  const open = async (tab, targetId, profile) => {
    const page = await connect(await cdpUrlFor(profile), targetId);
    watch(tab, page);
    // A pop-up already open before we connected isn't announced again.
    const already = await openDialog?.(targetId, profile).catch(() => null);
    if (already && !tab.dialog) {
      tab.dialog = already;
      tell(tab, { type: "dialog", ...already });
    }
    return page;
  };
  const pageOf = async (tab, targetId, profile) => {
    tab.profile = profile;
    tab.page ??= open(tab, targetId, profile);
    const page = await tab.page.catch(() => null);
    if (page?.open()) return page;
    tab.page = open(tab, targetId, profile);
    return tab.page;
  };

  const replay = async (tab, page, event) => {
    // Answered through OpenClaw when it can, so it knows the pop-up is gone and the agent can go on.
    if (event?.type === "dialog" && answerDialog) {
      const answer = { accept: event.accept === true, promptText: event.promptText };
      if (
        await answerDialog(tab.targetId, tab.profile, answer).then(
          () => true,
          () => false,
        )
      )
        return;
    }
    if (event?.type === "history") {
      const { currentIndex, entries } = await page.call("Page.getNavigationHistory");
      const entry = entries?.[currentIndex + (event.delta === -1 ? -1 : 1)];
      if (entry) page.send("Page.navigateToHistoryEntry", { entryId: entry.id });
      return;
    }
    const call = cdpInput(event);
    if (call) page.send(...call);
  };
  /**
   * Replays the batches now in order, one after another for the tab: a pop-up's answer or a
   * history move waits on a reply, and what follows must not overtake it.
   */
  const flush = (tab, page) => {
    const lock = tab.lock;
    const missing = lock.next;
    while (lock.waiting.has(lock.next)) {
      const batch = lock.waiting.get(lock.next);
      lock.waiting.delete(lock.next);
      lock.next += 1;
      tab.chain = tab.chain
        .then(async () => {
          // Handed back meanwhile: what's still queued is dropped, not sent over the agent.
          for (const event of batch.events) {
            if (tab.lock !== lock) return;
            await replay(tab, page, event).catch(() => {});
          }
        })
        .finally(batch.done);
    }
    // A batch is missing: let it arrive, then go on without it. Batches arriving behind it
    // don't push that back.
    if (lock.gap && lock.next === missing && lock.waiting.size > 0) return;
    clearTimeout(lock.gap);
    lock.gap = undefined;
    if (lock.waiting.size === 0) return;
    lock.gap = setTimeout(() => {
      lock.gap = undefined;
      if (tab.lock !== lock) return;
      lock.next = Math.min(...lock.waiting.keys());
      flush(tab, page);
    }, GAP_MS);
  };

  return {
    /** The plugin is being replaced: let go of everything. */
    dispose: () => sweep(true),
    /** Whether the agent's browser tool may run this call now: reads always, actions unless held. */
    allows: (params) =>
      READ_ACTIONS.has(params?.action) || ![...tabs.keys()].some((id) => holding(id)),
    async take(targetId, profile) {
      sweep();
      const held = holding(targetId);
      if (held) {
        held.lock.until = now() + CONTROL_TTL_MS;
        held.seen = now();
        return;
      }
      const tab = tabOf(targetId);
      tab.seen = now();
      const lock = { until: now() + CONTROL_TTL_MS, next: 1, waiting: new Map() };
      tab.lock = lock;
      // The page's own file picker is offered to you while you hold it.
      const page = await pageOf(tab, targetId, profile).catch((error) => {
        if (tab.lock === lock) unlock(tab);
        throw error;
      });
      void page.call("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {});
    },
    release(targetId) {
      const tab = tabs.get(targetId);
      if (tab?.lock) unlock(tab);
    },
    async input(targetId, profile, seq, events) {
      const tab = holding(targetId);
      if (!tab) throw new Error("Take control of this tab first.");
      tab.lock.until = now() + CONTROL_TTL_MS;
      tab.seen = now();
      if (!Number.isInteger(seq) || seq < tab.lock.next || !Array.isArray(events)) return;
      const lock = tab.lock;
      // The request stays open until its batch is replayed: answering a pop-up goes through
      // OpenClaw, which drops the call once the request that made it returns.
      const replayed = new Promise((done) =>
        lock.waiting.set(seq, { events: events.slice(0, 200), done }),
      );
      const page = await pageOf(tab, targetId, profile);
      if (tab.lock === lock) flush(tab, page);
      await replayed;
    },
    /**
     * What happened on the tab since `since`, waiting up to `waitMs` for something to. Without
     * `since`: no events, just where they're up to and any open pop-up.
     */
    async events(targetId, profile, since, waitMs, from) {
      if (from !== run) since = undefined;
      sweep();
      const tab = tabOf(targetId);
      tab.seen = now();
      await pageOf(tab, targetId, profile);
      const state = () => ({
        run,
        seq: tab.seq,
        dialog: tab.dialog ?? null,
        events: Number.isInteger(since) ? tab.events.filter((e) => e.seq > since) : [],
      });
      if (!Number.isInteger(since) || since < tab.seq || !(waitMs > 0)) return state();
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          tab.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, Math.min(waitMs, 25_000));
        tab.waiters.add(done);
      });
      tab.seen = now();
      return state();
    },
    /** The files you picked for the page's own picker (none cancels it). */
    async upload(targetId, profile, files) {
      const tab = holding(targetId);
      if (!tab) throw new Error("Take control of this tab first.");
      const chooser = tab.chooser;
      if (!chooser) throw new Error("The page isn't asking for a file.");
      const picked = Array.isArray(files) ? files : [];
      const total = picked.reduce((sum, f) => sum + String(f?.data ?? "").length * 0.75, 0);
      if (total > MAX_UPLOAD_BYTES) throw new Error("Those files are too large (10 MB at most).");
      const dir = path.join(uploads, randomUUID());
      const paths = [];
      if (picked.length > 0) {
        setTimeout(() => void rm(dir, { recursive: true, force: true }), UPLOADS_KEPT_MS).unref?.();
        for (const [i, file] of picked.entries()) {
          // A folder each, so two files of the same name both reach the page as named.
          const at = path.join(dir, String(i));
          await mkdir(at, { recursive: true });
          const name = path.basename(String(file?.name ?? "")) || `file-${i + 1}`;
          await writeFile(path.join(at, name), Buffer.from(String(file?.data ?? ""), "base64"));
          paths.push(path.join(at, name));
        }
      }
      const page = await pageOf(tab, targetId, profile);
      await page.call("DOM.setFileInputFiles", {
        files: paths,
        backendNodeId: chooser.backendNodeId,
      });
      if (tab.chooser === chooser) tab.chooser = null;
    },
  };
}
