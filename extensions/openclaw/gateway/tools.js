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
  /** callId → { answered } */
  const calls = new Map();

  const alive = (d) => Boolean(d.waiter) || now() - d.seen < POLL_MS + GRACE_MS;

  /** Who runs a call: the device in that chat, else the one with the most of Otter (the Mac's browser). */
  function deviceFor(name, sessionKey, skip) {
    const able = [...devices.entries()].filter(
      ([id, d]) => id !== skip && alive(d) && d.tools.some((t) => t.name === name),
    );
    able.sort(
      ([, a], [, b]) =>
        Number(b.sessions.includes(sessionKey)) - Number(a.sessions.includes(sessionKey)) ||
        b.tools.length - a.tools.length ||
        b.seen - a.seen,
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

    /** A device's answer to a call it was given. */
    result({ callId, text, image, isError }) {
      const call = calls.get(callId);
      if (!call) return false;
      call.answered({
        text: typeof text === "string" ? text : "",
        ...(image && typeof image.image === "string" && typeof image.mimeType === "string"
          ? { image: { image: image.image, mimeType: image.mimeType } }
          : {}),
        isError: isError === true,
      });
      return true;
    },

    /** Runs a tool on a device: what it answers, or why it couldn't. */
    call(name, args, sessionKey, signal) {
      return new Promise((resolve) => {
        const callId = randomUUID();
        let device = deviceFor(name, sessionKey);
        if (!device) {
          resolve({ text: "Otter isn't open on any of the user's devices.", isError: true });
          return;
        }
        const call = { callId, name, args: args ?? {}, sessionKey };
        let timer;
        const done = (answer) => {
          if (!calls.has(callId)) return;
          calls.delete(callId);
          clearTimeout(timer);
          resolve(answer);
        };
        const picked = () => {
          clearTimeout(timer);
          timer = setTimer(
            () => done({ text: "Otter didn't answer in time.", isError: true }),
            ANSWER_MS,
          );
        };
        // Not picked up (the device went to sleep with its poll open): another device, or none.
        const unclaimed = () => {
          const d = devices.get(device);
          if (!d?.queue.includes(call)) return;
          d.queue.splice(d.queue.indexOf(call), 1);
          const other = deviceFor(name, sessionKey, device);
          if (!other) return done({ text: "Otter didn't pick this up.", isError: true });
          device = other;
          hand(device, call);
          timer = setTimer(unclaimed, PICKUP_MS);
        };
        calls.set(callId, { answered: done });
        signal?.addEventListener(
          "abort",
          () => done({ text: "The call was cancelled.", isError: true }),
          { once: true },
        );
        hand(device, call);
        timer = setTimer(() => {
          const d = devices.get(device);
          if (d?.queue.includes(call)) unclaimed();
          else picked();
        }, PICKUP_MS);
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
