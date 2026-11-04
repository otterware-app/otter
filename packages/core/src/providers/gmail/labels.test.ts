import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../../platform.ts";
import { listLabels } from "./api.ts";

let replies: Map<string, { status: number; body: unknown }>;

beforeEach(() => {
  replies = new Map();
  let current: unknown;
  setPlatform({
    google: { getAccessToken: async () => "token" },
    log: () => {},
    asyncContext: () => ({
      run: (value: unknown, fn: () => unknown) => {
        current = value;
        return fn();
      },
      get: () => current,
    }),
  } as unknown as Platform);
  vi.stubGlobal("fetch", async (url: string) => {
    const reply = replies.get(new URL(url).pathname.replace("/gmail/v1/users/me", ""));
    return new Response(JSON.stringify(reply?.body ?? {}), { status: reply?.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gmail labels", () => {
  it("keeps a label whose detail Gmail refuses, without its counts", async () => {
    replies.set("/labels", {
      status: 200,
      body: {
        labels: [
          { id: "INBOX", name: "INBOX", type: "system" },
          { id: "Label_1", name: "Odd", type: "user" },
          { id: "Label_2", name: "Gone", type: "user" },
        ],
      },
    });
    replies.set("/labels/INBOX", {
      status: 200,
      body: { id: "INBOX", messagesUnread: 3, messagesTotal: 10 },
    });
    replies.set("/labels/Label_1", {
      status: 400,
      body: {
        error: { code: 400, message: "Precondition check failed.", status: "FAILED_PRECONDITION" },
      },
    });
    replies.set("/labels/Label_2", { status: 404, body: { error: { code: 404 } } });

    expect(await listLabels("me@example.com")).toEqual([
      { id: "INBOX", name: "INBOX", type: "system", unread: 3, total: 10, color: undefined },
      {
        id: "Label_1",
        name: "Odd",
        type: "user",
        unread: undefined,
        total: undefined,
        color: undefined,
      },
      {
        id: "Label_2",
        name: "Gone",
        type: "user",
        unread: undefined,
        total: undefined,
        color: undefined,
      },
    ]);
  });

  it("still fails on other errors", async () => {
    replies.set("/labels", {
      status: 200,
      body: { labels: [{ id: "Label_1", name: "A", type: "user" }] },
    });
    replies.set("/labels/Label_1", { status: 403, body: { error: { message: "Forbidden" } } });
    await expect(listLabels("me@example.com")).rejects.toThrow("403");
  });
});
