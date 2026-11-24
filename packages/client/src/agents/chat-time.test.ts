import { describe, expect, it } from "vite-plus/test";
import { messageTime } from "./chat-time.ts";

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
