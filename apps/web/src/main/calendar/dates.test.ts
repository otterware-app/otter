import { describe, expect, it } from "vite-plus/test";

import { dayKey, stepDays, visibleDays } from "./dates";

const keys = (days: Date[]) => days.map(dayKey);
// Monday, November 2 2026.
const MONDAY = new Date(2026, 10, 2);

describe("weekdays only", () => {
  it("steps over weekends both ways", () => {
    expect(dayKey(stepDays(new Date(2026, 10, 6), 1, false))).toBe("2026-11-09");
    expect(dayKey(stepDays(MONDAY, -1, false))).toBe("2026-10-30");
    expect(dayKey(stepDays(new Date(2026, 10, 7), 0, false))).toBe("2026-11-09");
    expect(dayKey(stepDays(MONDAY, 3))).toBe("2026-11-05");
  });

  it("shows a week's five weekdays, from any day it leads with", () => {
    expect(keys(visibleDays("week", new Date(2026, 10, 4), true, false))).toEqual([
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
      "2026-11-10",
    ]);
  });

  it("leaves weekends out of the month", () => {
    const days = visibleDays("month", MONDAY, false, false);
    expect(days.length % 5).toBe(0);
    expect(days.some((d) => d.getDay() === 0 || d.getDay() === 6)).toBe(false);
  });
});
