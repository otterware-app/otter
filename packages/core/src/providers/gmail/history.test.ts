import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../../platform.ts";
import { isHistoryExpiredError, listHistory } from "./api.ts";
import { inTier } from "./quota.ts";

const PRECONDITION = {
  status: 400,
  body: {
    error: {
      code: 400,
      message: "Precondition check failed.",
      errors: [{ message: "Precondition check failed.", reason: "failedPrecondition" }],
      status: "FAILED_PRECONDITION",
    },
  },
};

let replies: { status: number; body: unknown }[];
let calls: string[];

beforeEach(() => {
  vi.useFakeTimers();
  replies = [];
  calls = [];
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
    calls.push(new URL(url).pathname.replace("/gmail/v1/users/me", ""));
    const reply = replies.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function syncHistory() {
  return inTier("sync", () => listHistory("me@example.com", "1000"));
}

describe("Gmail history feed", () => {
  it("retries the feed when Gmail answers failedPrecondition for a moment", async () => {
    replies.push(PRECONDITION, { status: 200, body: { historyId: "1042", history: [] } });

    const page = syncHistory();
    await vi.runAllTimersAsync();

    expect(await page).toEqual({ historyId: "1042", history: [] });
    expect(calls).toEqual(["/history", "/history"]);
  });

  it("still fails, as itself, when Gmail keeps refusing the feed", async () => {
    replies.push(PRECONDITION, PRECONDITION, PRECONDITION, PRECONDITION);

    const page = syncHistory().catch((err: unknown) => err);
    await vi.runAllTimersAsync();

    const err = await page;
    expect(String(err)).toContain("Gmail API error: 400");
    expect(isHistoryExpiredError(err)).toBe(false);
    expect(calls).toHaveLength(4);
  });

  it("leaves other 400s and an expired feed to their callers", async () => {
    replies.push({
      status: 400,
      body: { error: { code: 400, message: "Invalid startHistoryId" } },
    });
    await expect(syncHistory()).rejects.toThrow("400");

    replies.push({ status: 404, body: { error: { code: 404 } } });
    const expired = await syncHistory().catch((err: unknown) => err);
    expect(isHistoryExpiredError(expired)).toBe(true);
    expect(calls).toEqual(["/history", "/history"]);
  });
});
