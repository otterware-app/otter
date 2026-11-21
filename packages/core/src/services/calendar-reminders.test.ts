import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { CalendarEvent } from "../providers/provider.js";

const notify = vi.fn();
let events: CalendarEvent[] = [];
let reminders = true;

vi.mock("../platform.js", () => ({ platform: () => ({ notify }) }));
vi.mock("./settings-store.js", () => ({
  getSettings: async () => ({ calendarReminders: reminders }),
  onSettingsChanged: () => {},
}));
vi.mock("./account-store.js", () => ({
  listAccounts: async () => [{ id: "me@work.com", email: "me@work.com", name: "work" }],
}));
vi.mock("./mail-sync.js", () => ({ turnedOffMailboxes: () => new Set() }));
vi.mock("./notifier.js", () => ({ accountLabel: (a: { name: string }) => a.name }));
vi.mock("../providers/index.js", () => ({
  capabilitiesOf: () => ({ calendar: true }),
  providerFor: () => ({
    calendar: {
      listCalendars: async () => [
        { id: "primary", hiddenByDefault: false },
        { id: "team", hiddenByDefault: false },
        { id: "holidays", hiddenByDefault: true },
      ],
      listEvents: async (_: string, range: { calendarId: string }) =>
        range.calendarId === "holidays" ? [event("Holiday", 30)] : events,
    },
  }),
}));

const { checkReminders } = await import("./calendar-reminders.js");

const NOW = Date.parse("2026-11-23T09:00:00Z");
const event = (title: string, inMinutes: number, extra: Partial<CalendarEvent> = {}) =>
  ({
    id: title,
    title,
    start: new Date(NOW + inMinutes * 60_000).toISOString(),
    end: new Date(NOW + (inMinutes + 30) * 60_000).toISOString(),
    allDay: false,
    location: null,
    status: "confirmed",
    response: "accepted",
    ...extra,
  }) as CalendarEvent;

afterEach(() => {
  notify.mockReset();
  reminders = true;
  vi.useRealTimers();
});

describe("calendar reminders", () => {
  it("reminds 10 minutes before, once, for events you're going to", async () => {
    vi.useFakeTimers({ now: NOW });
    events = [
      event("Standup", 12, { location: "Room 4" }),
      event("Declined", 12, { response: "declined" }),
      event("Off site", 12, { allDay: true }),
    ];
    await checkReminders(NOW);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notify).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      category: "calendar",
      title: "Calendar · work",
      subtitle: "Standup",
      body: "In 10 minutes · Room 4",
    });

    await checkReminders(Date.now());
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("says nothing with reminders off", async () => {
    vi.useFakeTimers({ now: NOW });
    reminders = false;
    events = [event("Review", 5)];
    await checkReminders(NOW);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(notify).not.toHaveBeenCalled();
  });
});
