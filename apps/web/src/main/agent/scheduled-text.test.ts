import { describe, expect, it } from "vite-plus/test";
import {
  cronText,
  everyText,
  newWhenForm,
  dayText,
  dayTimeText,
  scheduleOfForm,
  scheduleText,
  untilText,
  whenFormOf,
  whenProblem,
  type WhenForm,
} from "./scheduled-text";

const at = (h: number, m: number) =>
  new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

describe("cronText", () => {
  it("says the common shapes in words", () => {
    expect(cronText("0 8 * * *")).toBe(`Every day at ${at(8, 0)}`);
    expect(cronText("30 7 * * 1-5")).toBe(`Weekdays at ${at(7, 30)}`);
    expect(cronText("0 10 * * 0,6")).toBe(`Weekends at ${at(10, 0)}`);
    expect(cronText("0 9 * * 1")).toBe(`Every Monday at ${at(9, 0)}`);
    expect(cronText("0 9 * * 7")).toBe(`Every Sunday at ${at(9, 0)}`);
    expect(cronText("0 9 * * 1,3,5")).toBe(`Mon, Wed, Fri at ${at(9, 0)}`);
    expect(cronText("0 9 1 * *")).toBe(`Monthly on the 1st at ${at(9, 0)}`);
    expect(cronText("0 9 22 * *")).toBe(`Monthly on the 22nd at ${at(9, 0)}`);
    expect(cronText("0 9 11 * *")).toBe(`Monthly on the 11th at ${at(9, 0)}`);
    expect(cronText("*/15 * * * *")).toBe("Every 15 minutes");
    expect(cronText("0 * * * *")).toBe("Every hour");
    expect(cronText("5 * * * *")).toBe("Hourly at :05");
    expect(cronText("0 */2 * * *")).toBe("Every 2 hours");
    expect(cronText("* * * * *")).toBe("Every minute");
  });

  it("leaves the rest as cron", () => {
    expect(cronText("0 9 1 1 *")).toBeNull();
    expect(cronText("0 9-17 * * *")).toBeNull();
    expect(cronText("0 9 * * MON")).toBeNull();
    expect(cronText("0 9 * *")).toBeNull();
    expect(cronText("0 9 * * 5-1")).toBeNull();
    expect(cronText("0 9 * * 8")).toBeNull();
  });
});

describe("scheduleText", () => {
  it("names a time zone only when it isn't this one", () => {
    const cron = { kind: "cron" as const, expr: "0 8 * * 1-5", tz: "Europe/Paris" };
    expect(scheduleText(cron, "Europe/Paris")).toBe(`Weekdays at ${at(8, 0)}`);
    expect(scheduleText(cron, "America/New_York")).toBe(`Weekdays at ${at(8, 0)} (Europe/Paris)`);
    expect(scheduleText({ kind: "cron", expr: "0 9 1 1 *" }, "UTC")).toBe("Cron 0 9 1 1 *");
  });

  it("says intervals, one-offs and what it can't edit", () => {
    expect(everyText(3_600_000)).toBe("Every hour");
    expect(everyText(7_200_000)).toBe("Every 2 hours");
    expect(everyText(1_800_000)).toBe("Every 30 minutes");
    expect(everyText(86_400_000)).toBe("Every day");
    expect(scheduleText({ kind: "at", at: "2026-12-01T09:00:00Z" })).toMatch(/^Once, /);
    expect(scheduleText({ kind: "other", text: "When make exits" })).toBe("When make exits");
  });
});

describe("dayText", () => {
  const now = new Date(2026, 10, 8, 14, 0).getTime();
  const on = (d: number) => new Date(2026, 10, d, 9, 30).getTime();

  it("names the day near today, and dates the rest", () => {
    expect(dayText(on(8), now)).toBe("Today");
    expect(dayText(on(9), now)).toBe("Tomorrow");
    expect(dayText(on(7), now)).toBe("Yesterday");
    expect(dayText(on(5), now)).toBe(
      new Date(2026, 10, 5).toLocaleDateString(undefined, { weekday: "short" }),
    );
    expect(dayText(on(20), now)).toBe(
      new Date(2026, 10, 20).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    );
  });
});

describe("dayTimeText", () => {
  const now = new Date(2026, 10, 8, 14, 0).getTime();
  const at = (d: number, h: number) => new Date(2026, 10, d, h, 30).getTime();
  const time = (h: number) =>
    new Date(2026, 10, 8, h, 30).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });

  it("says the day the way a person would", () => {
    expect(dayTimeText(at(8, 18), now)).toBe(`today at ${time(18)}`);
    expect(dayTimeText(at(9, 7), now)).toBe(`tomorrow at ${time(7)}`);
    expect(dayTimeText(at(12, 9), now)).toBe(`Thursday at ${time(9)}`);
    expect(dayTimeText(at(20, 9), now)).toMatch(new RegExp(`at ${time(9)}$`));
    expect(dayTimeText(at(7, 9), now)).toBe(`yesterday at ${time(9)}`);
    expect(dayTimeText(at(1, 9), now)).not.toMatch(/^(today|yesterday)/);
  });
});

describe("untilText", () => {
  it("counts down", () => {
    expect(untilText(1000, 0)).toBe("now");
    expect(untilText(5 * 60_000, 0)).toBe("in 5 min");
    expect(untilText(3 * 3_600_000, 0)).toBe("in 3 h");
    expect(untilText(26 * 3_600_000, 0)).toBe("in 1 day");
  });
});

describe("the editor's when", () => {
  const now = new Date(2026, 10, 8, 14, 0);
  const round = (schedule: Parameters<typeof whenFormOf>[0]) =>
    scheduleOfForm(whenFormOf(schedule, now)!);

  it("reads a schedule into the fields that make it, and back", () => {
    for (const expr of ["30 7 * * *", "0 8 * * 1-5", "0 9 * * 3", "15 6 12 * *", "0 9 1 1 *"])
      expect(round({ kind: "cron", expr, tz: "Europe/Paris" })).toEqual({
        kind: "cron",
        expr,
        tz: "Europe/Paris",
      });
    expect(round({ kind: "every", everyMs: 7_200_000 })).toEqual({
      kind: "every",
      everyMs: 7_200_000,
    });
    expect(round({ kind: "every", everyMs: 900_000 })).toEqual({ kind: "every", everyMs: 900_000 });
    expect(round({ kind: "at", at: "2026-12-01T09:30:00.000Z" })).toEqual({
      kind: "at",
      at: "2026-12-01T09:30:00.000Z",
    });
    expect(whenFormOf({ kind: "other", text: "x" }, now)).toBeNull();
  });

  it("picks the preset a cron expression is", () => {
    expect(whenFormOf({ kind: "cron", expr: "0 8 * * 1-5" }, now)).toMatchObject({
      repeat: "weekdays",
      time: "08:00",
    });
    expect(whenFormOf({ kind: "cron", expr: "0 9 * * 7" }, now)).toMatchObject({
      repeat: "weekly",
      weekday: 0,
    });
    expect(whenFormOf({ kind: "cron", expr: "*/5 * * * *" }, now)).toMatchObject({
      repeat: "cron",
      cron: "*/5 * * * *",
    });
    expect(whenFormOf({ kind: "cron", expr: "0 9 * * * *" }, now)).toMatchObject({
      repeat: "cron",
      cron: "0 9 * * * *",
    });
  });

  it("keeps a schedule without a time zone on the agent's", () => {
    expect(whenFormOf({ kind: "cron", expr: "0 8 * * *" }, now)?.tz).toBe("");
    expect(round({ kind: "cron", expr: "0 8 * * *" })).toEqual({ kind: "cron", expr: "0 8 * * *" });
  });

  it("starts tomorrow at nine, daily", () => {
    const form = newWhenForm(now);
    expect(form).toMatchObject({ repeat: "daily", time: "09:00", once: "2026-11-09T09:00" });
  });

  it("says what's wrong", () => {
    const form: WhenForm = newWhenForm(now);
    expect(whenProblem(form, now.getTime())).toBeNull();
    expect(
      whenProblem({ ...form, repeat: "once", once: "2026-11-08T13:00" }, now.getTime()),
    ).toMatch(/future/);
    expect(whenProblem({ ...form, repeat: "interval", every: 0 })).toMatch(/every minute/);
    expect(whenProblem({ ...form, repeat: "daily", time: "" })).toBe("Pick a time.");
    expect(whenProblem({ ...form, repeat: "cron", cron: "0 9 * *" })).toMatch(/five fields/);
    expect(whenProblem({ ...form, repeat: "cron", cron: "0 0 9 * * *" })).toBeNull();
  });
});
