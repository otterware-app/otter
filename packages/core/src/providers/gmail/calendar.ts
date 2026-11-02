/**
 * Google Calendar, the account's primary calendar: invitations (your answer,
 * and RSVP in place: your calendar updates and the organizer is notified,
 * sendUpdates=all), and its events for the agents' tools. The sign-in asks for
 * calendar.events.owned: events on calendars the user owns. Accounts connected
 * before the app asked for calendar access get NoCalendarAccess, and
 * services/calendar-invites.ts replies by email instead.
 */

import { platform } from "../../platform.js";
import {
  NoCalendarAccess,
  type CalendarEvent,
  type EventInput,
  type RsvpResponse,
} from "../provider.js";

const CALENDAR = "https://www.googleapis.com/calendar/v3/calendars/primary";

async function calendarFetch(
  accountId: string,
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<unknown> {
  const token = await platform().google.getAccessToken(accountId);
  const response = await fetch(`${CALENDAR}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 403 || response.status === 401) {
    const body = await response.text().catch(() => "");
    if (/insufficient|scope|PERMISSION_DENIED|accessNotConfigured|has not been used/i.test(body))
      throw new NoCalendarAccess(body.slice(0, 200));
    throw new Error(`Calendar API error: ${response.status} ${body.slice(0, 200)}`);
  }
  if (!response.ok)
    throw new Error(
      `Calendar API error: ${response.status} ${(await response.text()).slice(0, 200)}`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

type ApiTime = { date?: string; dateTime?: string; timeZone?: string };

type ApiAttendee = {
  email: string;
  displayName?: string;
  self?: boolean;
  responseStatus?: string;
};

type ApiEvent = {
  id: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: ApiTime;
  end?: ApiTime;
  organizer?: { email?: string; displayName?: string };
  attendees?: ApiAttendee[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
  recurringEventId?: string;
  recurrence?: string[];
};

async function lookup(accountId: string, uid: string): Promise<ApiEvent | null> {
  const data = (await calendarFetch(
    accountId,
    `/events?iCalUID=${encodeURIComponent(uid)}&showDeleted=false&maxResults=1`,
  )) as { items?: ApiEvent[] };
  return data.items?.[0] ?? null;
}

const isSelf = (a: ApiAttendee, email: string) => a.self || a.email.toLowerCase() === email;

function asResponse(status: string | undefined): RsvpResponse | "needsAction" {
  return status === "accepted" || status === "declined" || status === "tentative"
    ? status
    : "needsAction";
}

function selfStatus(event: ApiEvent, email: string): RsvpResponse | "needsAction" {
  return asResponse(event.attendees?.find((a) => isSelf(a, email))?.responseStatus);
}

export async function findEvent(
  accountId: string,
  uid: string,
): Promise<{ response: RsvpResponse | "needsAction"; htmlLink: string | null } | null> {
  const found = await lookup(accountId, uid);
  if (!found) return null;
  return { response: selfStatus(found, accountId.toLowerCase()), htmlLink: found.htmlLink ?? null };
}

async function setResponse(
  accountId: string,
  event: ApiEvent,
  response: RsvpResponse,
): Promise<ApiEvent> {
  const email = accountId.toLowerCase();
  const attendees = (event.attendees ?? []).map((a) =>
    isSelf(a, email) ? { ...a, responseStatus: response } : a,
  );
  if (!attendees.some((a) => isSelf(a, email))) {
    attendees.push({ email, self: true, responseStatus: response });
  }
  return (await calendarFetch(
    accountId,
    `/events/${encodeURIComponent(event.id)}?sendUpdates=all`,
    { method: "PATCH", body: JSON.stringify({ attendees }) },
  )) as ApiEvent;
}

export async function respond(
  accountId: string,
  uid: string,
  response: RsvpResponse,
): Promise<boolean> {
  const found = await lookup(accountId, uid);
  if (!found) return false;
  await setResponse(accountId, found, response);
  return true;
}

function toEvent(accountId: string, e: ApiEvent): CalendarEvent {
  const email = accountId.toLowerCase();
  const attendees = e.attendees ?? [];
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri;
  return {
    id: e.id,
    title: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    allDay: Boolean(e.start?.date),
    location: e.location ?? null,
    description: e.description ?? null,
    status: e.status === "tentative" || e.status === "cancelled" ? e.status : "confirmed",
    organizer: e.organizer?.email ?? null,
    attendees: attendees.map((a) => ({
      email: a.email,
      ...(a.displayName ? { name: a.displayName } : {}),
      response: asResponse(a.responseStatus),
    })),
    response: attendees.some((a) => isSelf(a, email)) ? selfStatus(e, email) : null,
    meetingLink: video ?? e.hangoutLink ?? null,
    htmlLink: e.htmlLink ?? null,
    recurring: Boolean(e.recurringEventId || e.recurrence),
  };
}

const DAY_MS = 86_400_000;

function apiTime(value: string, allDay: boolean, timeZone: string): ApiTime {
  if (allDay) return { date: value.slice(0, 10) };
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new Error(`Not a date-time: ${value}`);
  return { dateTime: time.toISOString(), timeZone };
}

function duration(event: ApiEvent | undefined): number {
  const start = event?.start?.dateTime ?? event?.start?.date;
  const end = event?.end?.dateTime ?? event?.end?.date;
  const ms = start && end ? Date.parse(end) - Date.parse(start) : NaN;
  return ms > 0 ? ms : event?.start?.date ? DAY_MS : 3_600_000;
}

function apiBody(input: EventInput, current?: ApiEvent): Record<string, unknown> {
  const allDay = input.allDay ?? Boolean(current?.start?.date);
  const timeZone = input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.summary = input.title;
  if (input.location !== undefined) body.location = input.location;
  if (input.description !== undefined) body.description = input.description;
  if (input.attendees !== undefined) body.attendees = input.attendees.map((email) => ({ email }));
  if (input.start !== undefined) {
    body.start = apiTime(input.start, allDay, timeZone);
    // Without an end it keeps its length (new events: an hour, or the day).
    const length = current ? duration(current) : allDay ? DAY_MS : 3_600_000;
    const end =
      input.end ??
      (allDay
        ? new Date(Date.parse(`${input.start.slice(0, 10)}T00:00:00Z`) + length)
            .toISOString()
            .slice(0, 10)
        : new Date(new Date(input.start).getTime() + length).toISOString());
    body.end = apiTime(end, allDay, timeZone);
  } else if (input.end !== undefined) {
    body.end = apiTime(input.end, allDay, timeZone);
  }
  if (input.videoCall) {
    body.conferenceData = {
      createRequest: {
        requestId: crypto.randomUUID(),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return body;
}

const updates = (notify: boolean) => `sendUpdates=${notify ? "all" : "none"}`;

async function fetchEvent(accountId: string, eventId: string): Promise<ApiEvent> {
  return (await calendarFetch(accountId, `/events/${encodeURIComponent(eventId)}`)) as ApiEvent;
}

export async function listEvents(
  accountId: string,
  range: { from: string; to: string; query?: string; limit: number },
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date(range.from).toISOString(),
    timeMax: new Date(range.to).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(range.limit),
  });
  if (range.query) params.set("q", range.query);
  const data = (await calendarFetch(accountId, `/events?${params}`)) as { items?: ApiEvent[] };
  return (data.items ?? []).map((e) => toEvent(accountId, e));
}

export async function getEvent(accountId: string, eventId: string): Promise<CalendarEvent> {
  return toEvent(accountId, await fetchEvent(accountId, eventId));
}

export async function createEvent(
  accountId: string,
  input: EventInput,
  notify: boolean,
): Promise<CalendarEvent> {
  const created = (await calendarFetch(
    accountId,
    `/events?${updates(notify)}&conferenceDataVersion=1`,
    { method: "POST", body: JSON.stringify(apiBody(input)) },
  )) as ApiEvent;
  return toEvent(accountId, created);
}

export async function updateEvent(
  accountId: string,
  eventId: string,
  patch: EventInput,
  notify: boolean,
): Promise<CalendarEvent> {
  const current = patch.start || patch.end ? await fetchEvent(accountId, eventId) : undefined;
  const updated = (await calendarFetch(
    accountId,
    `/events/${encodeURIComponent(eventId)}?${updates(notify)}&conferenceDataVersion=1`,
    { method: "PATCH", body: JSON.stringify(apiBody(patch, current)) },
  )) as ApiEvent;
  return toEvent(accountId, updated);
}

export async function deleteEvent(
  accountId: string,
  eventId: string,
  notify: boolean,
): Promise<void> {
  await calendarFetch(accountId, `/events/${encodeURIComponent(eventId)}?${updates(notify)}`, {
    method: "DELETE",
  });
}

export async function respondToEvent(
  accountId: string,
  eventId: string,
  response: RsvpResponse,
): Promise<CalendarEvent> {
  const event = await fetchEvent(accountId, eventId);
  return toEvent(accountId, await setResponse(accountId, event, response));
}
