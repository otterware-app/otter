import { randomUUID } from "node:crypto";

/**
 * Otter's own tools (mail, calendar, its browser), run in the Otter app on the user's devices:
 * each device asks for calls with `otter.tools.next`, a long poll that also says which tools it
 * has, and answers each with `otter.tools.result`. A device that stopped asking is gone.
 */

/** Otter's tools, as core names them (`packages/core/src/services/agent/tools`). */
export const OTTER_TOOLS = [
  "list_accounts",
  "list_labels",
  "list_threads",
  "search_mail",
  "get_thread",
  "get_attachment",
  "update_threads",
  "trash_threads",
  "restore_threads",
  "create_label",
  "save_draft",
  "delete_draft",
  "send_email",
  "list_events",
  "get_event",
  "create_event",
  "update_event",
  "delete_event",
  "respond_to_event",
  "list_themes",
  "get_theme",
  "save_theme",
  "use_theme",
  "list_views",
  "save_view",
  "delete_view",
  "browser_tabs",
  "browser_snapshot",
  "browser_open",
  "browser_take",
  "browser_navigate",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_screenshot",
  "browser_scroll",
];

/** How long a device's poll stays open; it's alive until a little after it ends. */
export const POLL_MS = 25_000;
const GRACE_MS = 10_000;
/** A call no device picked up by then goes to another, or fails. */
const PICKUP_MS = 15_000;
/** Long enough for the user to answer the approval a change asks for. */
const ANSWER_MS = 10 * 60_000;

const isTool = (tool) =>
  typeof tool?.name === "string" &&
  OTTER_TOOLS.includes(tool.name) &&
  typeof tool.description === "string" &&
  typeof tool.input === "object" &&
  tool.input !== null;

export function createToolBroker({ now = Date.now, setTimer = setTimeout } = {}) {
  /** device → { tools, sessions, instructions, seen, waiter, queue } */
  const devices = new Map();
  /** callId → the call, with the device it's for and whether that device took it */
  const calls = new Map();
  /** runId → the device whose message started the run */
  const senders = new Map();

  const alive = (d) => Boolean(d.waiter) || now() - d.seen < POLL_MS + GRACE_MS;

  /** Who runs a call: the device the chat's message came from, else the one with the most of Otter (the Mac's browser). */
  function deviceFor(name, sessionKey, runId, skip) {
    const able = [...devices.entries()].filter(
      ([id, d]) => !skip.has(id) && alive(d) && d.tools.some((t) => t.name === name),
    );
    const rank = ([id, d]) =>
      (senders.get(runId) === id ? 2 : 0) + (d.sessions.includes(sessionKey) ? 1 : 0);
    able.sort(
      (a, b) => rank(b) - rank(a) || b[1].tools.length - a[1].tools.length || b[1].seen - a[1].seen,
    );
    return able[0]?.[0];
  }

  function hand(id, call) {
    const d = devices.get(id);
    if (d.waiter) {
      const waiter = d.waiter;
      d.waiter = null;
      waiter([call]);
    } else d.queue.push(call);
  }

  function unqueue(call) {
    const queue = devices.get(call.device)?.queue;
    const at = queue?.indexOf(call.payload) ?? -1;
    if (at >= 0) queue.splice(at, 1);
  }

  return {
    /** The tool as a device describes it, while one that has it is there. */
    describe(name) {
      for (const d of devices.values())
        if (alive(d)) {
          const tool = d.tools.find((t) => t.name === name);
          if (tool) return tool;
        }
      return undefined;
    },

    instructions() {
      for (const d of devices.values()) if (alive(d) && d.instructions) return d.instructions;
      return undefined;
    },

    /** The run a message started came from this device: its calls go there first. */
    sentFrom(runId, device) {
      if (typeof runId !== "string" || typeof device !== "string") return;
      senders.set(runId, device);
      // Only recent runs matter: the oldest go.
      if (senders.size > 500) senders.delete(senders.keys().next().value);
    },

    /** A device asking for calls: what's waiting for it, or what comes within `waitMs`. */
    next({ device, tools, sessions, instructions, waitMs }) {
      if (typeof device !== "string" || !device) throw new Error("device is required");
      const d = devices.get(device) ?? { queue: [], waiter: null };
      d.tools = Array.isArray(tools) ? tools.filter(isTool) : [];
      d.sessions = Array.isArray(sessions) ? sessions.filter((s) => typeof s === "string") : [];
      d.instructions = typeof instructions === "string" ? instructions : undefined;
      d.seen = now();
      // A device asks again only once its last poll ended: one left waiting is a dropped connection's.
      d.waiter?.([]);
      d.waiter = null;
      devices.set(device, d);
      if (d.queue.length > 0) return Promise.resolve(d.queue.splice(0));
      const wait = typeof waitMs === "number" ? Math.min(Math.max(waitMs, 0), POLL_MS) : POLL_MS;
      return new Promise((resolve) => {
        d.waiter = resolve;
        setTimer(() => {
          if (d.waiter !== resolve) return;
          d.waiter = null;
          d.seen = now();
          resolve([]);
        }, wait);
      });
    },

    /**
     * A device taking a call before it runs it (false: it went elsewhere, don't run it), or
     * answering one it took.
     */
    result({ callId, device, taken, text, image, isError }) {
      const call = calls.get(callId);
      if (!call || call.device !== device) return false;
      if (taken === true) {
        // Asked again (the first answer was lost): still the same device's.
        if (call.taken) return true;
        call.taken = true;
        call.wait(ANSWER_MS);
        return true;
      }
      if (!call.taken) return false;
      call.done({
        text: typeof text === "string" ? text : "",
        ...(image && typeof image.image === "string" && typeof image.mimeType === "string"
          ? { image: { image: image.image, mimeType: image.mimeType } }
          : {}),
        isError: isError === true,
      });
      return true;
    },

    /** Runs a tool on a device: what it answers, or why it couldn't. */
    call(name, args, sessionKey, runId, signal) {
      return new Promise((resolve) => {
        if (signal?.aborted) return resolve({ text: "The call was cancelled.", isError: true });
        const callId = randomUUID();
        const tried = new Set();
        const call = {
          payload: { callId, name, args: args ?? {}, sessionKey, runId },
          taken: false,
        };
        let timer;
        call.done = (answer) => {
          if (!calls.has(callId)) return;
          calls.delete(callId);
          clearTimeout(timer);
          unqueue(call);
          resolve(answer);
        };
        call.wait = (ms) => {
          clearTimeout(timer);
          timer = setTimer(() => {
            if (call.taken) call.done({ text: "Otter didn't answer in time.", isError: true });
            else give();
          }, ms);
        };
        // To a device that's there; one that doesn't take it in time (asleep with its poll
        // open, a dropped connection) passes it to the next.
        const give = () => {
          unqueue(call);
          const device = deviceFor(name, sessionKey, runId, tried);
          if (!device)
            return call.done({
              text:
                tried.size === 0
                  ? "Otter isn't open on any of the user's devices."
                  : "Otter didn't pick this up.",
              isError: true,
            });
          tried.add(device);
          call.device = device;
          hand(device, call.payload);
          call.wait(PICKUP_MS);
        };
        calls.set(callId, call);
        signal?.addEventListener(
          "abort",
          () => call.done({ text: "The call was cancelled.", isError: true }),
          { once: true },
        );
        give();
      });
    },
  };
}

/** A device's answer, as an OpenClaw tool result: text, or the picture it took. What failed throws. */
export function toolResult({ text, image, isError }) {
  if (isError) throw new Error(text || "Otter couldn't do that.");
  return {
    content: image
      ? [{ type: "image", data: image.image, mimeType: image.mimeType }]
      : [{ type: "text", text: text || "Done." }],
  };
}
