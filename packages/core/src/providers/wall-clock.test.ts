import { describe, expect, it } from "vite-plus/test";

import { wallClock } from "./wall-clock.ts";

describe("wallClock", () => {
  it("reads the day in the event's zone, not the computer's", () => {
    const nyc = wallClock("2026-11-03T04:30:00.000Z", "America/New_York");
    expect(nyc).toMatchObject({ date: "2026-11-02", dateTime: "2026-11-02T23:30:00", weekday: 1 });
    expect(wallClock("2026-11-03T04:30:00.000Z", "UTC")).toMatchObject({
      date: "2026-11-03",
      weekday: 2,
    });
  });

  it("keeps an all-day date as written", () => {
    expect(wallClock("2026-03-01", "Pacific/Auckland")).toEqual({
      date: "2026-03-01",
      dateTime: "2026-03-01T00:00:00",
      weekday: 0,
      day: 1,
      month: 3,
    });
  });
});
