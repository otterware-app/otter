/**
 * Gmail's quota as the app paces it: the cost of each call (full-format
 * fetches as measured), and a minute's budget that comes down when Gmail
 * refuses and climbs back while it's quiet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../../platform.ts";
import {
  acquireQuota,
  budgetOf,
  quotaCost,
  reportQuotaExceeded,
  spentLastMinute,
} from "./quota.ts";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-29T12:00:00Z") });
  let current: unknown;
  setPlatform({
    asyncContext: () => ({
      run: (value: unknown, fn: () => unknown) => {
        current = value;
        return fn();
      },
      get: () => current,
    }),
  } as unknown as Platform);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Gmail quota", () => {
  it("prices calls as Gmail charges them", () => {
    expect(quotaCost("GET", "/messages/abc?format=full")).toBe(50);
    expect(quotaCost("GET", "/messages/abc?format=metadata&metadataHeaders=From")).toBe(20);
    expect(quotaCost("GET", "/threads/abc?format=full")).toBe(100);
    expect(quotaCost("GET", "/messages?maxResults=500")).toBe(5);
    expect(quotaCost("GET", "/messages/abc/attachments/def")).toBe(20);
    expect(quotaCost("POST", "/messages/abc/modify")).toBe(5);
    expect(quotaCost("POST", "/threads/abc/trash")).toBe(20);
    expect(quotaCost("GET", "/drafts/d1?format=minimal")).toBe(20);
    expect(quotaCost("PUT", "/drafts/d1")).toBe(15);
    expect(quotaCost("POST", "/messages/send")).toBe(100);
    expect(quotaCost("GET", "/history?startHistoryId=1")).toBe(2);
    expect(quotaCost("GET", "/labels/Label_1")).toBe(1);
    expect(quotaCost("GET", "/profile")).toBe(1);
  });

  it("brings a minute's budget down when Gmail refuses, then climbs back slowly", async () => {
    const account = "a@gmail.test";
    expect(budgetOf(account)).toBe(4800);
    for (let i = 0; i < 12; i++) await acquireQuota(account, 50);
    expect(spentLastMinute(account)).toBe(600);

    expect(reportQuotaExceeded(account, 0)).toBe(true);
    expect(budgetOf(account)).toBe(3840);
    // The other requests in flight are refused too: the same event.
    expect(reportQuotaExceeded(account, 0)).toBe(false);
    expect(budgetOf(account)).toBe(3840);

    // Quiet for ten minutes: 60 units a minute back, up to 95% of the limit.
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(budgetOf(account)).toBe(4440);
    vi.setSystemTime(Date.now() + 60 * 60_000);
    expect(budgetOf(account)).toBe(5700);
  });

  it("takes what was spent as the budget when that was most of it", async () => {
    const account = "b@gmail.test";
    for (let i = 0; i < 60; i++) {
      await acquireQuota(account, 50);
      vi.setSystemTime(Date.now() + 900);
    }
    expect(spentLastMinute(account)).toBe(3000);
    reportQuotaExceeded(account, 0);
    expect(budgetOf(account)).toBe(2700);
  });
});
