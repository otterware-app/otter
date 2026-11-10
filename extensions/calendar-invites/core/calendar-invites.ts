/**
 * Calendar invitations in the reader. An invitation already in the account's
 * calendar is answered there (Google Calendar or Outlook notify the organizer).
 * Anything else can only be added to a calendar: answering by email went to
 * no-reply senders of bookings and tickets.
 */

import {
  logger,
  fromBase64,
  utf8Decode,
  providerFor,
  NoCalendarAccess,
  getAttachmentData,
  mailStore as store,
} from "@otter/core/extension-kit";
import type { RsvpResponse } from "@otter/core/extension-kit";

export type { RsvpResponse };

export type CalendarInvite = {
  uid: string;
  method: string;
  summary: string;
  start: string | null;
  end: string | null;
  allDay: boolean;
  location: string | null;
  organizer: { name: string; email: string } | null;
  sequence: number;
  response: RsvpResponse | "needsAction";
  calendarAccess: boolean;
  /** In the account's calendar, where Yes / No / Maybe answer it. */
  inCalendar: boolean;
  /** Added to a calendar from here. */
  added: boolean;
  htmlLink: string | null;
  cancelled: boolean;
};

type Added = { accountId: string; calendarId?: string; eventId: string; htmlLink: string | null };

type Prop = { name: string; params: Record<string, string>; value: string };

function unfold(ics: string): string[] {
  return ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
}

function parseLine(line: string): Prop | null {
  const colon = line.search(/:(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  if (colon < 0) return null;
  const [head, ...paramParts] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: head.toUpperCase(), params, value: line.slice(colon + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
}

function toIso(prop: Prop | undefined): { iso: string | null; allDay: boolean } {
  if (!prop) return { iso: null, allDay: false };
  const v = prop.value;
  const date = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (date || prop.params.VALUE === "DATE") {
    const [, y, m, d] = date ?? v.match(/^(\d{4})(\d{2})(\d{2})/)!;
    return { iso: `${y}-${m}-${d}`, allDay: true };
  }
  const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!dt) return { iso: null, allDay: false };
  const [, y, m, d, hh, mm, ss, z] = dt;
  const local = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  if (z) return { iso: `${local}Z`, allDay: false };
  const zoned = prop.params.TZID ? inZone(local, prop.params.TZID) : null;
  return { iso: zoned ?? local, allDay: false };
}

/** A wall-clock time in an IANA zone as an instant; null for zones Intl doesn't know (Windows names). */
function inZone(local: string, zone: string): string | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
  const wall = Date.parse(`${local}Z`);
  const offset = (ms: number) => {
    const p = Object.fromEntries(format.formatToParts(ms).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  const guess = wall - offset(wall);
  return new Date(wall - offset(guess)).toISOString();
}

function endOf(event: Prop[], start: { iso: string | null; allDay: boolean }) {
  const end = toIso(get(event, "DTEND"));
  const duration = get(event, "DURATION")?.value.match(
    /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (end.iso || !start.iso || !duration) return end;
  const [w, d, h, m, sec] = duration.slice(1).map((n) => Number(n ?? 0));
  const ms = ((((w * 7 + d) * 24 + h) * 60 + m) * 60 + sec) * 1000;
  if (!start.allDay)
    return { iso: new Date(new Date(start.iso).getTime() + ms).toISOString(), allDay: false };
  const day = new Date(`${start.iso}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + Math.max(1, Math.round(ms / 86_400_000)));
  return { iso: day.toISOString().slice(0, 10), allDay: true };
}

type ParsedIcs = {
  method: string;
  event: Prop[];
  raw: string;
};

function parseIcs(ics: string): ParsedIcs | null {
  const lines = unfold(ics);
  let method = "";
  const event: Prop[] = [];
  let inEvent = false;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === "METHOD" && !inEvent) method = prop.value.toUpperCase();
    if (prop.name === "BEGIN" && prop.value.toUpperCase() === "VEVENT") {
      if (event.length > 0) break;
      inEvent = true;
      continue;
    }
    if (prop.name === "END" && prop.value.toUpperCase() === "VEVENT") inEvent = false;
    else if (inEvent) event.push(prop);
  }
  return event.length > 0 ? { method, event, raw: ics } : null;
}

const get = (event: Prop[], name: string) => event.find((p) => p.name === name);
const mailto = (value: string) =>
  value
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();

const icsCache = new Map<string, ParsedIcs | null>();

async function inviteIcs(accountId: string, messageId: string): Promise<ParsedIcs | null> {
  const key = `${accountId}:${messageId}`;
  if (icsCache.has(key)) return icsCache.get(key)!;
  const detail =
    store.getMessageDetail(accountId, messageId) ??
    (await providerFor(accountId).getMessage(accountId, messageId));
  const part = detail.attachments.find(
    (a) => /text\/calendar|application\/ics/i.test(a.mimeType) || /\.ics$/i.test(a.filename),
  );
  let parsed: ParsedIcs | null = null;
  if (part) {
    const { base64 } = await getAttachmentData(accountId, messageId, part.id);
    parsed = parseIcs(utf8Decode(fromBase64(base64)));
  }
  icsCache.set(key, parsed);
  return parsed;
}

const addedKey = (accountId: string, uid: string) => `invite-added:${accountId}:${uid}`;

export async function getInvite(
  accountId: string,
  messageId: string,
): Promise<CalendarInvite | null> {
  const ics = await inviteIcs(accountId, messageId);
  if (!ics) return null;
  const { event, method } = ics;
  const uid = get(event, "UID")?.value;
  if (!uid) return null;
  const email = accountId.toLowerCase();
  const start = toIso(get(event, "DTSTART"));
  const end = endOf(event, start);
  const organizerProp = get(event, "ORGANIZER");
  const mine = event.find((p) => p.name === "ATTENDEE" && mailto(p.value) === email);
  const icsStatus = mine?.params.PARTSTAT?.toLowerCase();
  const saved = store.getKv(addedKey(accountId, uid));
  const added = saved ? (JSON.parse(saved) as Added) : null;

  let response: CalendarInvite["response"] =
    icsStatus === "accepted" || icsStatus === "declined" || icsStatus === "tentative"
      ? icsStatus
      : "needsAction";
  const calendar = providerFor(accountId).calendar;
  let calendarAccess = Boolean(calendar);
  let inCalendar = false;
  let htmlLink = added?.htmlLink ?? null;
  try {
    const found = await calendar?.findEvent(accountId, uid);
    if (found) {
      inCalendar = true;
      response = found.response;
      htmlLink = found.htmlLink;
    }
  } catch (error) {
    if (error instanceof NoCalendarAccess) calendarAccess = false;
    else logger.info("calendar", "event lookup failed", { error: String(error) });
  }

  return {
    uid,
    method,
    summary: unescapeText(get(event, "SUMMARY")?.value ?? "(no title)"),
    start: start.iso,
    end: end.iso,
    allDay: start.allDay,
    location: get(event, "LOCATION") ? unescapeText(get(event, "LOCATION")!.value) : null,
    organizer: organizerProp
      ? { name: organizerProp.params.CN ?? "", email: mailto(organizerProp.value) }
      : null,
    sequence: Number(get(event, "SEQUENCE")?.value ?? 0) || 0,
    response,
    calendarAccess,
    inCalendar,
    added: Boolean(added),
    htmlLink,
    cancelled: method === "CANCEL" || get(event, "STATUS")?.value.toUpperCase() === "CANCELLED",
  };
}

export async function respondToInvite(
  accountId: string,
  messageId: string,
  response: RsvpResponse,
): Promise<CalendarInvite | null> {
  const ics = await inviteIcs(accountId, messageId);
  const uid = ics && get(ics.event, "UID")?.value;
  if (!ics || !uid) throw new Error("This message has no calendar invitation.");
  const answered = await providerFor(accountId).calendar?.respond(accountId, uid, response);
  if (!answered) throw new Error("This invitation isn't in your calendar.");
  logger.info("calendar", "rsvp", { response });
  return getInvite(accountId, messageId);
}

export async function addInviteToCalendar(
  accountId: string,
  messageId: string,
  target: { accountId: string; calendarId?: string },
): Promise<CalendarInvite | null> {
  const ics = await inviteIcs(accountId, messageId);
  const uid = ics && get(ics.event, "UID")?.value;
  if (!ics || !uid) throw new Error("This message has no calendar invitation.");
  const calendar = providerFor(target.accountId).calendar;
  if (!calendar) throw new Error("This mailbox has no calendar.");
  const { event } = ics;
  const start = toIso(get(event, "DTSTART"));
  const end = endOf(event, start);
  if (!start.iso) throw new Error("This invitation has no start time.");
  const text = (name: string) => {
    const value = get(event, name)?.value;
    return value ? unescapeText(value) : undefined;
  };
  const created = await calendar.createEvent(
    target.accountId,
    {
      title: text("SUMMARY") ?? "(no title)",
      start: start.allDay ? start.iso : new Date(start.iso).toISOString(),
      ...(end.iso ? { end: end.allDay ? end.iso : new Date(end.iso).toISOString() } : {}),
      allDay: start.allDay,
      location: text("LOCATION"),
      description: text("DESCRIPTION"),
    },
    false,
    target.calendarId,
  );
  const added: Added = { ...target, eventId: created.id, htmlLink: created.htmlLink };
  store.setKv(addedKey(accountId, uid), JSON.stringify(added));
  logger.info("calendar", "invite added");
  return getInvite(accountId, messageId);
}
