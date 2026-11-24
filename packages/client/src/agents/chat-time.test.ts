import { describe, expect, it } from "vite-plus/test";
import { clockText, dayText, messageTime, turnDay } from "./chat-time.ts";

describe("a message's time", () => {
  const now = new Date(2026, 10, 8, 14, 30).getTime();
  const time = (at: Date) => at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  it("is the time today, yesterday's says so, older ones carry the day", () => {
    const today = new Date(2026, 10, 8, 10, 0);
    expect(messageTime(today.getTime(), now)).toBe(time(today));
    const yesterday = new Date(2026, 10, 7, 21, 1);
    expect(messageTime(yesterday.getTime(), now)).toBe(`Yesterday at ${time(yesterday)}`);
    const older = new Date(2026, 10, 2, 9, 5);
    expect(messageTime(older.getTime(), now)).toBe(
      `${older.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time(older)}`,
    );
    expect(messageTime(new Date(2025, 11, 31, 9, 5).getTime(), now)).toContain("2025");
  });
});

describe("a day's name", () => {
  const now = new Date(2026, 10, 13, 14, 30).getTime();

  it("is Today, Yesterday, the weekday this week, then the date", () => {
    expect(dayText(new Date(2026, 10, 13, 8).getTime(), now)).toBe("Today");
    expect(dayText(new Date(2026, 10, 12, 23).getTime(), now)).toBe("Yesterday");
    const monday = new Date(2026, 10, 9, 9);
    expect(dayText(monday.getTime(), now)).toBe(monday.toLocaleDateString([], { weekday: "long" }));
    const older = new Date(2026, 10, 3, 9);
    expect(dayText(older.getTime(), now)).toBe(
      older.toLocaleDateString([], { day: "numeric", month: "short" }),
    );
    expect(dayText(new Date(2025, 10, 3, 9).getTime(), now)).toContain("2025");
  });

  it("is the time today in a list, where Today says nothing", () => {
    const morning = new Date(2026, 10, 13, 8, 5).getTime();
    expect(dayText(morning, now, null)).toBe(clockText(morning));
  });

  it("marks a turn that starts on another day than the one before", () => {
    const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
    const turns = [
      { startedAt: at(12, 9) },
      { startedAt: at(12, 10) },
      {},
      { startedAt: at(13, 8) },
    ];
    expect(turnDay(turns, 0, now)).toBe("Yesterday");
    expect(turnDay(turns, 1, now)).toBeNull();
    expect(turnDay(turns, 2, now)).toBeNull();
    expect(turnDay(turns, 3, now)).toBe("Today");
  });
});
