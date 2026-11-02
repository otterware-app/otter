import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { setPlatform, type Platform } from "../../platform.ts";
import { NoCalendarAccess } from "../provider.ts";
import { createEvent, listEvents, respondToEvent, updateEvent } from "./calendar.ts";

const ME = "me@example.com";

type Call = { method: string; url: URL; body: Record<string, unknown> | null };
let calls: Call[];
let replies: { status?: number; body: unknown }[];

beforeEach(() => {
  calls = [];
  replies = [];
  setPlatform({
    google: { getAccessToken: async () => "token" },
  } as unknown as Platform);
  vi.stubGlobal("fetch", async (url: string, init: { method?: string; body?: string } = {}) => {
    calls.push({
      method: init.method ?? "GET",
      url: new URL(url),
      body: init.body ? JSON.parse(init.body) : null,
    });
    const reply = replies.shift() ?? { body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const event = {
  id: "ev1",
  summary: "Standup",
  start: { dateTime: "2026-10-01T09:00:00Z" },
  end: { dateTime: "2026-10-01T09:30:00Z" },
  organizer: { email: "ada@example.com" },
  attendees: [
    { email: "ada@example.com", responseStatus: "accepted" },
    { email: ME, self: true, responseStatus: "needsAction" },
  ],
  conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/x" }] },
};

describe("Google Calendar events", () => {
  it("reads events as the tools show them", async () => {
    replies.push({ body: { items: [event] } });
    const [read] = await listEvents(ME, {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-08T00:00:00Z",
      query: "standup",
      limit: 50,
    });
    const url = calls[0].url;
    expect(url.pathname).toBe("/calendar/v3/calendars/primary/events");
    expect(url.searchParams.get("singleEvents")).toBe("true");
    expect(url.searchParams.get("q")).toBe("standup");
    expect(read).toMatchObject({
      id: "ev1",
      title: "Standup",
      allDay: false,
      organizer: "ada@example.com",
      response: "needsAction",
      meetingLink: "https://meet.google.com/x",
    });
  });

  it("creates an hour-long event with a video call, telling attendees", async () => {
    replies.push({ body: event });
    await createEvent(
      ME,
      {
        title: "Review",
        start: "2026-10-02T14:00:00Z",
        timeZone: "Europe/Paris",
        attendees: ["ada@example.com"],
        videoCall: true,
      },
      true,
    );
    const { method, url, body } = calls[0];
    expect(method).toBe("POST");
    expect(url.searchParams.get("sendUpdates")).toBe("all");
    expect(url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(body).toMatchObject({
      summary: "Review",
      start: { dateTime: "2026-10-02T14:00:00.000Z", timeZone: "Europe/Paris" },
      end: { dateTime: "2026-10-02T15:00:00.000Z", timeZone: "Europe/Paris" },
      attendees: [{ email: "ada@example.com" }],
      conferenceData: { createRequest: { conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
  });

  it("takes Google Meet off an event", async () => {
    replies.push({ body: event });
    await updateEvent(ME, "ev1", { videoCall: false }, false);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url.searchParams.get("conferenceDataVersion")).toBe("1");
    expect(calls[0].body).toEqual({ conferenceData: null });
  });

  it("finds a Teams or Zoom link in an invitation from another calendar", async () => {
    const teams = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?a=1&b=2";
    replies.push({
      body: {
        items: [
          {
            ...event,
            hangoutLink: undefined,
            conferenceData: undefined,
            description: `<p>Join: <a href="${teams.replace("&", "&amp;")}">Click here</a></p>`,
          },
          {
            ...event,
            id: "ev2",
            hangoutLink: undefined,
            conferenceData: undefined,
            location: "https://acme.zoom.us/j/123.",
          },
        ],
      },
    });
    const read = await listEvents(ME, {
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-08T00:00:00Z",
      limit: 50,
    });
    expect(read.map((e) => e.meetingLink)).toEqual([teams, "https://acme.zoom.us/j/123"]);
  });

  it("ends an all-day event the next day", async () => {
    replies.push({ body: event });
    await createEvent(ME, { title: "Off", start: "2026-10-05", allDay: true }, false);
    expect(calls[0].url.searchParams.get("sendUpdates")).toBe("none");
    expect(calls[0].body).toMatchObject({
      start: { date: "2026-10-05" },
      end: { date: "2026-10-06" },
    });
  });

  it("repeats on the day it starts in its zone", async () => {
    replies.push({ body: event });
    // 04:30 UTC on Tuesday is 23:30 Monday in New York.
    await createEvent(
      ME,
      {
        title: "Late",
        start: "2026-11-03T04:30:00Z",
        repeat: "weekly",
        timeZone: "America/New_York",
      },
      false,
    );
    expect(calls[0].body).toMatchObject({ recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] });
  });

  it("keeps an event's length when it moves", async () => {
    replies.push({ body: event }, { body: event });
    await updateEvent(ME, "ev1", { start: "2026-10-01T10:00:00Z" }, true);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
    expect(calls[1].body).toMatchObject({
      start: { dateTime: "2026-10-01T10:00:00.000Z" },
      end: { dateTime: "2026-10-01T10:30:00.000Z" },
    });
    expect(calls[1].body).not.toHaveProperty("summary");
  });

  it("answers an invitation as you, keeping the other attendees", async () => {
    replies.push({ body: event }, { body: event });
    await respondToEvent(ME, "ev1", "accepted");
    expect(calls[1].method).toBe("PATCH");
    expect(calls[1].url.searchParams.get("sendUpdates")).toBe("all");
    expect(calls[1].body).toEqual({
      attendees: [
        { email: "ada@example.com", responseStatus: "accepted" },
        { email: ME, self: true, responseStatus: "accepted" },
      ],
    });
  });

  it("says when the sign-in may not use the calendar", async () => {
    replies.push({ status: 403, body: { error: { message: "Request had insufficient scopes" } } });
    await expect(
      listEvents(ME, { from: "2026-10-01", to: "2026-10-02", limit: 5 }),
    ).rejects.toBeInstanceOf(NoCalendarAccess);
  });
});
