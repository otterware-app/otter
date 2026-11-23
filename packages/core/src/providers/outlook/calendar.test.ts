import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createEvent, syncEvents } from "./calendar.ts";

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

describe("Outlook's calendar delta", () => {
  const master = {
    id: "series",
    type: "seriesMaster",
    subject: "Tech Daily",
    isAllDay: false,
    isOrganizer: false,
    webLink: "https://outlook.office.com/calendar/item/series",
    organizer: { emailAddress: { address: "julian@contoso.test" } },
    responseStatus: { response: "accepted" },
    start: { dateTime: "2026-11-02T09:00:00.0000000" },
    end: { dateTime: "2026-11-02T09:15:00.0000000" },
  };
  const occurrence = (day: number) => ({
    id: `series-${day}`,
    type: "occurrence",
    seriesMasterId: "series",
    start: { dateTime: `2026-11-${day}T09:00:00.0000000` },
    end: { dateTime: `2026-11-${day}T09:15:00.0000000` },
  });
  const range = { from: "2026-11-01T00:00:00Z", to: "2026-12-01T00:00:00Z", token: null };

  it("fills a series' occurrences from it, and keeps the series out", async () => {
    graph.mockResolvedValueOnce({
      value: [master, occurrence(23), occurrence(24)],
      "@odata.deltaLink": "next",
    });
    const changes = await syncEvents(ME, "cal", range);
    expect(changes.events.map((e) => [e.id, e.title, e.start, e.response, e.seriesId])).toEqual([
      ["series-23", "Tech Daily", "2026-11-23T09:00:00.000Z", "accepted", "series"],
      ["series-24", "Tech Daily", "2026-11-24T09:00:00.000Z", "accepted", "series"],
    ]);
    expect(changes.events[0]!.organizer).toBe("julian@contoso.test");
    expect(changes.events[0]!.htmlLink).toBeNull();
  });

  it("asks for a series the delta didn't carry, once", async () => {
    graph
      .mockResolvedValueOnce({
        value: [occurrence(23), occurrence(24)],
        "@odata.deltaLink": "next",
      })
      .mockResolvedValueOnce(master);
    const changes = await syncEvents(ME, "cal", { ...range, token: "/delta" });
    expect(changes.events.map((e) => e.title)).toEqual(["Tech Daily", "Tech Daily"]);
    expect(graph).toHaveBeenCalledTimes(2);
    expect(graph.mock.calls[1][1]).toMatch(/^\/me\/events\/series\?/);
  });
});
