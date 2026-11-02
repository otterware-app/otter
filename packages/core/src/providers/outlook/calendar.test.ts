import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEvent } from "./calendar.ts";

const graph = vi.hoisted(() => vi.fn());
vi.mock("./graph.js", async (original) => ({ ...(await original()), graph }));

const ME = "me@contoso.test";
const sent = () => graph.mock.calls[0][2].body;

beforeEach(() => {
  graph.mockReset();
  graph.mockResolvedValue({ id: "ev1", subject: "Late weekly" });
});

describe("Outlook repeating events", () => {
  it("repeats on the day it starts in its zone, keeping the hour over DST", async () => {
    // 23:30 UTC on Sunday is 00:30 Monday in Berlin.
    await createEvent(
      ME,
      {
        title: "Late weekly",
        start: "2026-11-08T23:30:00Z",
        repeat: "weekly",
        timeZone: "Europe/Berlin",
      },
      false,
    );
    expect(sent()).toMatchObject({
      start: { dateTime: "2026-11-09T00:30:00", timeZone: "Europe/Berlin" },
      end: { dateTime: "2026-11-09T01:30:00", timeZone: "Europe/Berlin" },
      recurrence: {
        pattern: { type: "weekly", daysOfWeek: ["monday"] },
        range: { type: "noEnd", startDate: "2026-11-09", recurrenceTimeZone: "Europe/Berlin" },
      },
    });
  });

  it("keeps a one-off event in UTC", async () => {
    await createEvent(
      ME,
      { title: "Once", start: "2026-11-08T23:30:00Z", timeZone: "Europe/Berlin" },
      false,
    );
    expect(sent().start).toEqual({ dateTime: "2026-11-08T23:30:00", timeZone: "UTC" });
    expect(sent().recurrence).toBeUndefined();
  });
});
