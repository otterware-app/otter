// Ported from T3 Code (github.com/pingdotgg/t3code at 470ca6349; MIT, see THIRD_PARTY_NOTICES.md):
// apps/web/src/components/HistorySwipeNavigation.test.ts.
import { describe, expect, it } from "vite-plus/test";

import { isMomentumTail } from "./history-swipe";

describe("isMomentumTail", () => {
  it.each([
    ["steady momentum decay", [40, 37, 34, 31.3, 28.8], true],
    ["fingers still moving", [12, 18, 9, 15, 11], false],
    ["fingers slowing unevenly", [30, 22, 20, 12, 11], false],
    ["reversing", [10, 8, 6, 4, -2], false],
    ["too few samples", [40, 37, 34], false],
  ])("%s", (_name, deltas, expected) => {
    expect(isMomentumTail(deltas)).toBe(expected);
  });
});
