import { onBackgroundRefresh } from "@otter-mail/mobile-background";

import type { core as coreBridge } from "../../state/core";

/** What iOS gives an app refresh task is about 30 seconds, core's start included. */
const BUDGET_MS = 25_000;

/** BGAppRefresh: core catches mail up (incrementally), within the time iOS gives. */
export function startBackgroundRefresh(core: typeof coreBridge, ready: Promise<unknown>): void {
  onBackgroundRefresh(async (signal) => {
    const startedAt = Date.now();
    await ready;
    if (signal.aborted) return false;
    const budgetMs = Math.max(1000, BUDGET_MS - (Date.now() - startedAt));
    const result = await core.invoke<{ unfinished: number }>("background:refresh", { budgetMs });
    return result.unfinished === 0;
  });
}
