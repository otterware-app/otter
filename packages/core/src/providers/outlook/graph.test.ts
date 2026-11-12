import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../../platform.ts";
import { errorKind, forgetGraph, graph, GraphError, tier } from "./graph.ts";

const ME = "me@contoso.test";
let lane: unknown;
let pending: { path: string; answer: () => void }[];

beforeEach(() => {
  pending = [];
  setPlatform({
    microsoft: { getAccessToken: async () => "token" },
    // Graph reads the lane before its first await, so a synchronous one will do.
    asyncContext: () => ({
      run: (value: unknown, fn: () => unknown) => {
        const before = lane;
        lane = value;
        try {
          return fn();
        } finally {
          lane = before;
        }
      },
      get: () => lane,
    }),
  } as unknown as Platform);
  vi.stubGlobal(
    "fetch",
    (url: string) =>
      new Promise<Response>((resolve) =>
        pending.push({ path: new URL(url).pathname, answer: () => resolve(new Response("{}")) }),
      ),
  );
});

afterEach(() => {
  forgetGraph(ME);
  vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Graph's requests in flight", () => {
  it("keeps a slot for the user while sync fills the rest", async () => {
    const sync = Array.from({ length: 5 }, (_, i) =>
      tier().run("sync", () => graph(ME, `/sync/${i}`)),
    );
    await settle();
    expect(pending.map((p) => p.path)).toEqual(["/v1.0/sync/0", "/v1.0/sync/1", "/v1.0/sync/2"]);

    const opened = graph(ME, "/me/calendarView");
    await settle();
    expect(pending.at(-1)?.path).toBe("/v1.0/me/calendarView");
    pending.at(-1)!.answer();
    await opened;

    while (pending.length) {
      pending.shift()!.answer();
      await settle();
    }
    await Promise.all(sync);
  });

  it("lets the user's requests use every slot", async () => {
    void Promise.all(Array.from({ length: 4 }, (_, i) => graph(ME, `/me/events/${i}`)));
    await settle();
    expect(pending).toHaveLength(4);
    for (const p of pending) p.answer();
  });
});

describe("errorKind", () => {
  it("retries a gateway's failure later, as it does a throttle", () => {
    expect(errorKind(new GraphError(504, "UnknownError", ""))).toBe("network");
    expect(errorKind(new GraphError(502, "", ""))).toBe("network");
    expect(errorKind(new GraphError(503, "", ""))).toBe("rateLimit");
  });

  it("leaves Outlook's own errors to be reported", () => {
    expect(errorKind(new GraphError(500, "ErrorInternalServerError", ""))).toBeNull();
    expect(errorKind(new GraphError(400, "ErrorInvalidRequest", ""))).toBeNull();
  });
});
