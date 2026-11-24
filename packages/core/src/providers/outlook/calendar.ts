/**
 * The mailbox's Outlook calendar (its default one), through Graph:
 * invitations answered in place (the organizer is told), and its events for
 * the agents' tools. Times come back in UTC (`Prefer: outlook.timezone`); a
 * sign-in that may not use the calendar gets NoCalendarAccess, and
 * services/calendar-invites.ts replies by email instead.
 */

import {
  CalendarSyncExpired,
  NoCalendarAccess,
  type CalendarChanges,
  type CalendarPushTarget,
  type BusyBlock,
  type CalendarEvent,
  type CalendarInfo,
  type Repeat,
  type RespondOptions,
  type EventInput,
  type RsvpResponse,
} from "../provider.ts";
import { findMeetingLink } from "@otter/contracts";
import { wallClock } from "../wall-clock.ts";
import { logger } from "../../logger.ts";
import * as mailStore from "../../services/mail-store.ts";
import { GraphError, graph, isNotFound, type GraphInit, type Page } from "./graph.ts";

const UTC = 'outlook.timezone="UTC"';

async function calendarGraph<T>(accountId: string, path: string, init: GraphInit = {}) {
  try {
    return await graph<T>(accountId, path, { ...init, prefer: [UTC, ...(init.prefer ?? [])] });
  } catch (err) {
    // Only a sign-in without calendar access; not a suspended account or the like.
    if (
      err instanceof GraphError &&
      err.status === 403 &&
      /AccessDenied|Authorization_RequestDenied|scope|privilege/i.test(`${err.code} ${err.message}`)
    ) {
      throw new NoCalendarAccess(err.message);
    }
    throw err;
  }
}

type ApiTime = { dateTime: string; timeZone?: string };
type ApiAttendee = {
  emailAddress?: { address?: string; name?: string };
  status?: { response?: string };
};

type ApiEvent = {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start?: ApiTime;
  end?: ApiTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  isOrganizer?: boolean;
  showAs?: string;
  location?: { displayName?: string };
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: ApiAttendee[];
  responseStatus?: { response?: string };
  onlineMeeting?: { joinUrl?: string } | null;
  onlineMeetingUrl?: string | null;
  webLink?: string;
  type?: string;
  seriesMasterId?: string | null;
};

const EVENT_FIELDS =
  "id,subject,bodyPreview,start,end,isAllDay,isCancelled,isOrganizer,showAs,location,organizer,attendees,responseStatus,onlineMeeting,onlineMeetingUrl,webLink,type,seriesMasterId";

function asResponse(response: string | undefined): RsvpResponse | "needsAction" {
  if (response === "accepted" || response === "organizer") return "accepted";
  if (response === "declined") return "declined";
  if (response === "tentativelyAccepted") return "tentative";
  return "needsAction";
}

const ACTION: Record<RsvpResponse, string> = {
  accepted: "accept",
  declined: "decline",
  tentative: "tentativelyAccept",
};

const eventPath = (id: string) => `/me/events/${encodeURIComponent(id)}`;

async function lookup(accountId: string, uid: string): Promise<ApiEvent | null> {
  const filter = encodeURIComponent(`iCalUId eq '${uid.replace(/'/g, "''")}'`);
  const found = await calendarGraph<{ value?: ApiEvent[] }>(
    accountId,
    `/me/events?$filter=${filter}&$select=${EVENT_FIELDS}&$top=1`,
  );
  return found.value?.[0] ?? null;
}

export async function findEvent(
  accountId: string,
  uid: string,
): Promise<{ response: RsvpResponse | "needsAction"; htmlLink: string | null } | null> {
  const found = await lookup(accountId, uid);
  if (!found) return null;
  return { response: asResponse(found.responseStatus?.response), htmlLink: found.webLink ?? null };
}

async function answer(
  accountId: string,
  eventId: string,
  response: RsvpResponse,
  comment?: string,
) {
  await calendarGraph(accountId, `${eventPath(eventId)}/${ACTION[response]}`, {
    method: "POST",
    body: { sendResponse: true, ...(comment ? { comment } : {}) },
  });
}

export async function respond(
  accountId: string,
  uid: string,
  response: RsvpResponse,
): Promise<boolean> {
  const found = await lookup(accountId, uid);
  if (!found) return false;
  await answer(accountId, found.id, response);
  return true;
}

function isoTime(time: ApiTime | undefined, allDay: boolean): string {
  if (!time?.dateTime) return "";
  if (allDay) return time.dateTime.slice(0, 10);
  return new Date(`${time.dateTime.replace(/\.\d+$/, "")}Z`).toISOString();
}

function toEvent(e: ApiEvent): CalendarEvent {
  const allDay = e.isAllDay === true;
  return {
    id: e.id,
    title: e.subject || "(no title)",
    start: isoTime(e.start, allDay),
    end: isoTime(e.end, allDay),
    allDay,
    location: e.location?.displayName || null,
    description: e.bodyPreview || null,
    status: e.isCancelled ? "cancelled" : e.showAs === "tentative" ? "tentative" : "confirmed",
    organizer: e.organizer?.emailAddress?.address ?? null,
    attendees: (e.attendees ?? [])
      .filter((a) => a.emailAddress?.address)
      .map((a) => ({
        email: a.emailAddress!.address!,
        ...(a.emailAddress?.name ? { name: a.emailAddress.name } : {}),
        response: asResponse(a.status?.response),
      })),
    response: e.isOrganizer ? null : asResponse(e.responseStatus?.response),
    meetingLink:
      e.onlineMeeting?.joinUrl ??
      e.onlineMeetingUrl ??
      findMeetingLink(e.location?.displayName, e.bodyPreview),
    htmlLink: e.webLink ?? null,
    recurring: e.type !== undefined ? e.type !== "singleInstance" : Boolean(e.seriesMasterId),
    seriesId: e.seriesMasterId ?? (e.type === "seriesMaster" ? e.id : null),
  };
}

const DAY_MS = 86_400_000;

/** UTC, except a repeating event's times: its wall clock in its zone, so it keeps the hour over DST. */
function apiTime(value: string, allDay: boolean, timeZone: string, repeats = false): ApiTime {
  if (allDay) return { dateTime: `${value.slice(0, 10)}T00:00:00`, timeZone };
  if (repeats) return { dateTime: wallClock(value, timeZone).dateTime, timeZone };
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new Error(`Not a date-time: ${value}`);
  return { dateTime: time.toISOString().slice(0, 19), timeZone: "UTC" };
}

function duration(event: ApiEvent | undefined): number {
  const start = event?.start?.dateTime;
  const end = event?.end?.dateTime;
  const ms = start && end ? Date.parse(`${end}Z`) - Date.parse(`${start}Z`) : NaN;
  return ms > 0 ? ms : event?.isAllDay ? DAY_MS : 3_600_000;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** How it repeats, as Graph's recurrence, from the day it starts in its time zone, without end. */
function repeatPattern(repeat: Repeat, start: string, timeZone: string) {
  const day = wallClock(start, timeZone);
  const pattern = {
    daily: { type: "daily", interval: 1 },
    weekdays: { type: "weekly", interval: 1, daysOfWeek: WEEKDAYS.slice(1, 6) },
    weekly: { type: "weekly", interval: 1, daysOfWeek: [WEEKDAYS[day.weekday]] },
    monthly: { type: "absoluteMonthly", interval: 1, dayOfMonth: day.day },
    yearly: { type: "absoluteYearly", interval: 1, dayOfMonth: day.day, month: day.month },
  }[repeat];
  return { pattern, range: { type: "noEnd", startDate: day.date, recurrenceTimeZone: timeZone } };
}

function apiBody(input: EventInput, current?: ApiEvent): Record<string, unknown> {
  const allDay = input.allDay ?? current?.isAllDay ?? false;
  const timeZone = input.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: Record<string, unknown> = {};
  if (input.title !== undefined) body.subject = input.title;
  if (input.location !== undefined) body.location = { displayName: input.location };
  if (input.description !== undefined) {
    body.body = { contentType: "text", content: input.description };
  }
  if (input.attendees !== undefined) {
    body.attendees = input.attendees.map((address) => ({
      emailAddress: { address },
      type: "required",
    }));
  }
  if (input.allDay !== undefined) body.isAllDay = input.allDay;
  const repeats = Boolean(input.repeat && input.start);
  if (input.repeat && input.start)
    body.recurrence = repeatPattern(input.repeat, input.start, timeZone);
  if (input.start !== undefined) {
    body.start = apiTime(input.start, allDay, timeZone, repeats);
    const length = current ? duration(current) : allDay ? DAY_MS : 3_600_000;
    const end =
      input.end ??
      (allDay
        ? new Date(Date.parse(`${input.start.slice(0, 10)}T00:00:00Z`) + length)
            .toISOString()
            .slice(0, 10)
        : new Date(new Date(input.start).getTime() + length).toISOString());
    body.end = apiTime(end, allDay, timeZone, repeats);
  } else if (input.end !== undefined) {
    body.end = apiTime(input.end, allDay, timeZone, repeats);
  }
  if (input.videoCall) {
    body.isOnlineMeeting = true;
    body.onlineMeetingProvider = "teamsForBusiness";
  }
  return body;
}

async function fetchEvent(accountId: string, eventId: string): Promise<ApiEvent> {
  return calendarGraph<ApiEvent>(accountId, `${eventPath(eventId)}?$select=${EVENT_FIELDS}`);
}

// Outlook's named calendar colors, as Outlook shows them.
const NAMED_COLORS: Record<string, string> = {
  lightBlue: "#5ea3e0",
  lightGreen: "#5ebd73",
  lightOrange: "#f5a64a",
  lightGray: "#a6a6a6",
  lightYellow: "#e8c43c",
  lightTeal: "#4cb8b8",
  lightPink: "#e57ab8",
  lightBrown: "#b58a68",
  lightRed: "#e06666",
  maxColor: "#7f7f7f",
};

type ApiCalendar = {
  id: string;
  name?: string;
  hexColor?: string;
  color?: string;
  isDefaultCalendar?: boolean;
  canEdit?: boolean;
  allowedOnlineMeetingProviders?: string[];
};

export async function listCalendars(accountId: string): Promise<CalendarInfo[]> {
  const data = await calendarGraph<{ value?: ApiCalendar[] }>(
    accountId,
    "/me/calendars?$select=id,name,hexColor,color,isDefaultCalendar,canEdit,allowedOnlineMeetingProviders&$top=100",
  );
  return (data.value ?? [])
    .map((c) => ({
      id: c.id,
      name: c.name || "Calendar",
      color: c.hexColor || (c.color ? (NAMED_COLORS[c.color] ?? null) : null),
      primary: Boolean(c.isDefaultCalendar),
      writable: c.canEdit !== false,
      hiddenByDefault: false,
      // Work and school mailboxes; personal ones have no Teams meetings to add.
      meetings: c.allowedOnlineMeetingProviders?.includes("teamsForBusiness")
        ? ("teams" as const)
        : null,
    }))
    .sort((a, b) => Number(b.primary) - Number(a.primary));
}

export async function listEvents(
  accountId: string,
  range: { from: string; to: string; query?: string; limit: number; calendarId?: string },
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({
    startDateTime: new Date(range.from).toISOString(),
    endDateTime: new Date(range.to).toISOString(),
    $orderby: "start/dateTime",
    $select: EVENT_FIELDS,
    // calendarView can't search: look through more, then keep the matches.
    $top: String(range.query ? Math.max(range.limit, 250) : range.limit),
  });
  const data = await calendarGraph<{ value?: ApiEvent[] }>(
    accountId,
    `${range.calendarId ? `/me/calendars/${encodeURIComponent(range.calendarId)}` : "/me"}/calendarView?${params.toString()}`,
  );
  const query = range.query?.toLowerCase();
  return (data.value ?? [])
    .filter(
      (e) =>
        !query ||
        [e.subject, e.location?.displayName, e.bodyPreview].some((text) =>
          text?.toLowerCase().includes(query),
        ),
    )
    .slice(0, range.limit)
    .map(toEvent);
}

type DeltaEvent = ApiEvent & { "@removed"?: unknown };

/** The calendar view's delta: the token is its deltaLink, which keeps the range. */
export async function syncEvents(
  accountId: string,
  calendarId: string,
  request: { from: string; to: string; token: string | null },
): Promise<CalendarChanges> {
  const params = new URLSearchParams({
    startDateTime: new Date(request.from).toISOString(),
    endDateTime: new Date(request.to).toISOString(),
  });
  let next: string | undefined =
    request.token ?? `/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?${params}`;
  const changes: CalendarChanges = { events: [], removed: [], token: null };
  const masters = new Map<string, ApiEvent | null>();
  const occurrences: DeltaEvent[] = [];
  while (next) {
    let page: Page<DeltaEvent>;
    try {
      page = await calendarGraph<Page<DeltaEvent>>(accountId, next, {
        prefer: ["odata.maxpagesize=1000"],
      });
    } catch (err) {
      // An old delta is gone (410); one Graph can't read any more is "badly formed" (400).
      if (request.token && err instanceof GraphError && (err.status === 410 || err.status === 400))
        throw new CalendarSyncExpired(err.message);
      throw err;
    }
    for (const item of page.value ?? []) {
      if (item["@removed"] || item.isCancelled) changes.removed.push(item.id);
      else if (item.type === "seriesMaster") masters.set(item.id, item);
      // The delta gives a series' plain occurrences only their times: the rest is the series'.
      else if (item.type === "occurrence" && item.subject === undefined) occurrences.push(item);
      else changes.events.push(toEvent(item));
    }
    next = page["@odata.nextLink"];
    changes.token = page["@odata.deltaLink"] ?? null;
  }
  for (const item of occurrences) {
    const masterId = item.seriesMasterId;
    if (!masterId) continue;
    if (!masters.has(masterId))
      masters.set(
        masterId,
        await fetchEvent(accountId, masterId).catch((err) => {
          if (isNotFound(err)) return null;
          throw err;
        }),
      );
    const master = masters.get(masterId);
    if (master) changes.events.push(toEvent({ ...master, webLink: undefined, ...item }));
    else changes.removed.push(item.id);
  }
  return changes;
}

/**
 * One Graph subscription to the mailbox's events, every calendar's, as mail's
 * (`watch.ts`): to the relay's calendar address, renewed a day before it lapses.
 */
type Subscription = { id: string; notificationUrl: string; expiration: number };

const LIFETIME_MS = 70 * 60 * 60_000;
const RENEW_BEFORE_MS = 24 * 60 * 60_000;
const subscriptionKey = (accountId: string) => `outlookCalendarSubscription:${accountId}`;

function readSubscription(accountId: string): Subscription | null {
  try {
    return JSON.parse(mailStore.getKv(subscriptionKey(accountId)) || "null") as Subscription | null;
  } catch {
    return null;
  }
}

export async function watchEvents(
  accountId: string,
  _calendarIds: string[],
  target: CalendarPushTarget,
): Promise<boolean> {
  const current = readSubscription(accountId);
  if (
    current?.notificationUrl === target.notificationUrl &&
    current.expiration - Date.now() > RENEW_BEFORE_MS
  )
    return true;
  const expiration = Date.now() + LIFETIME_MS;
  const expirationDateTime = new Date(expiration).toISOString();
  try {
    let id: string | null = null;
    if (current?.notificationUrl === target.notificationUrl) {
      try {
        await graph(accountId, `/subscriptions/${encodeURIComponent(current.id)}`, {
          method: "PATCH",
          body: { expirationDateTime },
        });
        id = current.id;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    id ??= (
      await graph<{ id: string }>(accountId, "/subscriptions", {
        method: "POST",
        body: {
          changeType: "created,updated,deleted",
          notificationUrl: target.notificationUrl,
          resource: "me/events",
          expirationDateTime,
          clientState: target.token,
        },
      })
    ).id;
    if (current && current.id !== id) await endSubscription(accountId, current);
    mailStore.setKv(
      subscriptionKey(accountId),
      JSON.stringify({
        id,
        notificationUrl: target.notificationUrl,
        expiration,
      } satisfies Subscription),
    );
    return true;
  } catch (err) {
    logger.failure("calendar-watch", `Couldn't watch ${accountId}'s calendar`, err);
    return false;
  }
}

const endSubscription = (accountId: string, subscription: Subscription) =>
  graph(accountId, `/subscriptions/${encodeURIComponent(subscription.id)}`, {
    method: "DELETE",
  }).catch(() => {});

export async function stopWatchingEvents(accountId: string): Promise<void> {
  const current = readSubscription(accountId);
  mailStore.setKv(subscriptionKey(accountId), "");
  if (current) await endSubscription(accountId, current);
}

export async function getEvent(accountId: string, eventId: string): Promise<CalendarEvent> {
  return toEvent(await fetchEvent(accountId, eventId));
}

export async function createEvent(
  accountId: string,
  input: EventInput,
  _notify: boolean,
  calendarId?: string,
): Promise<CalendarEvent> {
  const body = apiBody(input);
  const path = calendarId ? `/me/calendars/${encodeURIComponent(calendarId)}/events` : "/me/events";
  try {
    return toEvent(await calendarGraph<ApiEvent>(accountId, path, { method: "POST", body }));
  } catch (err) {
    // Personal accounts can't make Teams meetings: the event without one.
    if (!(err instanceof GraphError) || err.status !== 400 || !body.isOnlineMeeting) throw err;
    delete body.isOnlineMeeting;
    delete body.onlineMeetingProvider;
    return toEvent(await calendarGraph<ApiEvent>(accountId, path, { method: "POST", body }));
  }
}

export async function updateEvent(
  accountId: string,
  eventId: string,
  patch: EventInput,
  _notify: boolean,
): Promise<CalendarEvent> {
  const current = patch.start || patch.end ? await fetchEvent(accountId, eventId) : undefined;
  await calendarGraph(accountId, eventPath(eventId), {
    method: "PATCH",
    body: apiBody(patch, current),
  });
  return getEvent(accountId, eventId);
}

export async function deleteEvent(
  accountId: string,
  eventId: string,
  notify: boolean,
): Promise<void> {
  try {
    const event = await fetchEvent(accountId, eventId);
    if (notify && event.isOrganizer && (event.attendees?.length ?? 0) > 0) {
      await calendarGraph(accountId, `${eventPath(eventId)}/cancel`, {
        method: "POST",
        body: { comment: "" },
      });
      return;
    }
    await calendarGraph(accountId, eventPath(eventId), { method: "DELETE" });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

export async function respondToEvent(
  accountId: string,
  eventId: string,
  response: RsvpResponse,
  _calendarId?: string,
  options: RespondOptions = {},
): Promise<CalendarEvent> {
  const before = await fetchEvent(accountId, eventId);
  const target = options.allEvents && before.seriesMasterId ? before.seriesMasterId : eventId;
  await answer(accountId, target, response, options.comment);
  try {
    return await getEvent(accountId, eventId);
  } catch (err) {
    // Declining takes the invitation off the calendar: answered, and gone.
    if (!isNotFound(err)) throw err;
    return { ...toEvent(before), response };
  }
}

type ScheduleItem = {
  status?: string;
  subject?: string;
  isPrivate?: boolean;
  start?: ApiTime;
  end?: ApiTime;
};

const utc = (time: ApiTime | undefined) =>
  time?.dateTime ? new Date(`${time.dateTime.replace(/Z$/, "")}Z`).toISOString() : "";

export async function schedule(
  accountId: string,
  emails: string[],
  range: { from: string; to: string },
): Promise<Record<string, BusyBlock[] | null>> {
  const at = (iso: string) => ({
    dateTime: new Date(iso).toISOString().slice(0, 19),
    timeZone: "UTC",
  });
  const data = await calendarGraph<{
    value?: { scheduleId: string; scheduleItems?: ScheduleItem[]; error?: unknown }[];
  }>(accountId, "/me/calendar/getSchedule", {
    method: "POST",
    body: { schedules: emails, startTime: at(range.from), endTime: at(range.to) },
  });
  const byEmail = new Map((data.value ?? []).map((s) => [s.scheduleId.toLowerCase(), s]));
  return Object.fromEntries(
    emails.map((email) => {
      const found = byEmail.get(email.toLowerCase());
      if (!found || found.error) return [email, null];
      const items = (found.scheduleItems ?? []).filter((i) => i.status && i.status !== "free");
      return [
        email,
        items.map((i) => ({
          start: utc(i.start),
          end: utc(i.end),
          title: !i.isPrivate && i.subject ? i.subject : null,
        })),
      ];
    }),
  );
}
