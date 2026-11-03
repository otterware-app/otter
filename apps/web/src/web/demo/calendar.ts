type ApiTime = { date?: string; dateTime?: string; timeZone?: string };
type ApiEvent = {
  id: string;
  status: string;
  summary: string;
  description?: string;
  location?: string;
  start: ApiTime;
  end: ApiTime;
  organizer?: { email: string; displayName?: string };
  attendees?: { email: string; displayName?: string; self?: boolean; responseStatus: string }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints: { entryPointType: string; uri: string }[] };
  recurringEventId?: string;
  recurrence?: string[];
};

const overrides = new Map<string, Partial<ApiEvent>>();

const calendars = new Map<string, Map<string, ApiEvent[]>>();

type ListedCalendar = {
  id: string;
  summary: string;
  backgroundColor: string;
  accessRole: "owner" | "reader";
  primary?: boolean;
  selected?: boolean;
  conferenceProperties?: { allowedConferenceSolutionTypes: string[] };
};

function calendarList(email: string): ListedCalendar[] {
  const primary = {
    id: email,
    summary: email,
    backgroundColor: "#9a9cff",
    accessRole: "owner" as const,
    primary: true,
    conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
  };
  if (email.startsWith("demo@"))
    return [
      primary,
      {
        id: "birthdays@demo",
        summary: "Birthdays",
        backgroundColor: "#4fa3e0",
        accessRole: "reader",
      },
      {
        id: "be.holidays@demo",
        summary: "Holidays in Belgium",
        backgroundColor: "#16a765",
        accessRole: "reader",
        selected: false,
      },
    ];
  return [
    primary,
    {
      id: `projects@${email}`,
      summary: "Projects",
      backgroundColor: "#a47ae2",
      accessRole: "owner",
      conferenceProperties: { allowedConferenceSolutionTypes: ["hangoutsMeet"] },
    },
    {
      id: "us.holidays@demo",
      summary: "United States holidays",
      backgroundColor: "#cd74e6",
      accessRole: "reader",
    },
  ];
}

function seedOther(calendarId: string): Omit<ApiEvent, "id" | "status">[] {
  const day = (offset: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return dayKey(d);
  };
  const allDay = (summary: string, offset: number) => ({
    summary,
    start: { date: day(offset) },
    end: { date: day(offset + 1) },
  });
  const at = (offset: number, hour: number) => {
    const d = new Date();
    d.setHours(hour, 0, 0, 0);
    d.setDate(d.getDate() + offset);
    return d.toISOString();
  };
  if (calendarId.startsWith("birthdays"))
    return [allDay("Sam Park's birthday", 3), allDay("Leo Park's birthday", 12)];
  if (calendarId.startsWith("be.holidays")) return [allDay("Armistice Day", 9)];
  if (calendarId.startsWith("us.holidays"))
    return [allDay("Veterans Day", 9), allDay("Thanksgiving", 24)];
  return [
    { summary: "Roadmap review", start: { dateTime: at(1, 10) }, end: { dateTime: at(1, 11) } },
    { summary: "Ship the beta", start: { dateTime: at(4, 15) }, end: { dateTime: at(4, 16) } },
  ];
}
let nextId = 1;

const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function seed(email: string): ApiEvent[] {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const at = (day: number, hour: number, minute = 0) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + day);
    d.setHours(hour, minute);
    return d.toISOString();
  };
  const date = (day: number) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + day);
    return dayKey(d);
  };
  const me = { email, self: true };
  const people = (response: string, ...others: [string, string][]) => [
    { ...me, responseStatus: response },
    ...others.map(([displayName, address]) => ({
      email: address,
      displayName,
      responseStatus: "accepted",
    })),
  ];
  type Seed = Omit<ApiEvent, "id" | "status">;
  const personal: Seed[] = [
    {
      summary: "Lunch with Priya",
      location: "Café Lumen",
      start: { dateTime: at(1, 12, 30) },
      end: { dateTime: at(1, 13, 30) },
    },
    {
      summary: "Team dinner",
      location: "Osteria Nove",
      start: { dateTime: at(4, 19, 30) },
      end: { dateTime: at(4, 21, 30) },
    },
    { summary: "Maya's birthday", start: { date: date(2) }, end: { date: date(3) } },
    { summary: "Dentist", start: { dateTime: at(8, 10) }, end: { dateTime: at(8, 11) } },
    { summary: "Weekend in Lisbon", start: { date: date(12) }, end: { date: date(14) } },
  ];
  for (let week = -1; week <= 2; week++)
    for (const day of [1, 3])
      personal.push({
        summary: "Run club",
        location: "Riverside",
        start: { dateTime: at(week * 7 + day, 7) },
        end: { dateTime: at(week * 7 + day, 8) },
        recurringEventId: "run",
      });
  const work: Seed[] = [
    {
      summary: "Launch planning",
      description: "Walk through the launch checklist and owners.",
      start: { dateTime: at(0, 11) },
      end: { dateTime: at(0, 12, 30) },
      organizer: { email: "maya@northwind.example", displayName: "Maya Chen" },
      attendees: people(
        "accepted",
        ["Maya Chen", "maya@northwind.example"],
        ["Sam Rivera", "sam@northwind.example"],
      ),
      hangoutLink: "https://meet.example/launch",
    },
    {
      summary: "Quarterly sync with Acme",
      description:
        '<p>Microsoft Teams meeting</p><p><a href="https://teams.microsoft.com/l/meetup-join/19%3ameeting_acme%40thread.v2/0?context=%7b%7d&amp;anon=true">Join the meeting now</a></p><p>Meeting ID: 398 804 647 106</p>',
      start: { dateTime: at(1, 16) },
      end: { dateTime: at(1, 17) },
      organizer: { email: "jordan@acme.example", displayName: "Jordan Blake" },
      attendees: people("needsAction", ["Jordan Blake", "jordan@acme.example"]),
    },
    { summary: "Focus time", start: { dateTime: at(3, 8) }, end: { dateTime: at(3, 11) } },
    {
      summary: "Hiring panel",
      start: { dateTime: at(3, 13) },
      end: { dateTime: at(3, 14) },
      location: "https://northwind.zoom.us/j/8812345678",
      organizer: { email: "leo@northwind.example", displayName: "Leo Park" },
      attendees: people("tentative", ["Leo Park", "leo@northwind.example"]),
    },
    { summary: "Offsite", start: { date: date(9) }, end: { date: date(11) } },
  ];
  for (let week = -1; week <= 2; week++) {
    for (let day = 0; day < 5; day++)
      work.push({
        summary: "Standup",
        start: { dateTime: at(week * 7 + day, 9, 30) },
        end: { dateTime: at(week * 7 + day, 9, 45) },
        recurringEventId: "standup",
        hangoutLink: "https://meet.example/standup",
        attendees: people("accepted", ["Maya Chen", "maya@northwind.example"]),
      });
    work.push({
      summary: "Design review",
      start: { dateTime: at(week * 7 + 2, 14) },
      end: { dateTime: at(week * 7 + 2, 15) },
      recurringEventId: "design",
      location: "Studio 3",
      organizer: { email: "leo@northwind.example", displayName: "Leo Park" },
      attendees: people(
        "needsAction",
        ["Maya Chen", "maya@northwind.example"],
        ["Leo Park", "leo@northwind.example"],
      ),
    });
  }
  const events = email.startsWith("demo@") ? personal : work;
  return events.map((e) => ({ ...e, id: `ev${nextId++}`, status: "confirmed" }));
}

function eventsOf(email: string, calendarId: string): ApiEvent[] {
  let byCalendar = calendars.get(email);
  if (!byCalendar) calendars.set(email, (byCalendar = new Map()));
  const id = calendarId === "primary" ? email : calendarId;
  let events = byCalendar.get(id);
  if (!events) {
    events =
      id === email
        ? seed(email)
        : seedOther(id).map((e) => ({ ...e, id: `ev${nextId++}`, status: "confirmed" }));
    byCalendar.set(id, events);
  }
  return events;
}

const startOf = (e: ApiEvent) => Date.parse(e.start.dateTime ?? `${e.start.date}T00:00`);
const endOf = (e: ApiEvent) => Date.parse(e.end.dateTime ?? `${e.end.date}T00:00`);

function fromBody(body: Record<string, unknown>, email: string): Partial<ApiEvent> {
  const patch: Partial<ApiEvent> = {};
  if (typeof body.summary === "string") patch.summary = body.summary;
  if (typeof body.location === "string") patch.location = body.location;
  if (typeof body.description === "string") patch.description = body.description;
  if (body.start) patch.start = body.start as ApiTime;
  if (body.end) patch.end = body.end as ApiTime;
  if (Array.isArray(body.recurrence)) patch.recurrence = body.recurrence as string[];
  if (body.conferenceData === null) {
    patch.conferenceData = undefined;
    patch.hangoutLink = undefined;
  } else if (body.conferenceData) {
    const code = Math.random()
      .toString(36)
      .slice(2, 12)
      .replace(/(...)(....)(...)/, "$1-$2-$3");
    const uri = `https://meet.google.com/${code}`;
    patch.conferenceData = { entryPoints: [{ entryPointType: "video", uri }] };
    patch.hangoutLink = uri;
  }
  if (Array.isArray(body.attendees))
    patch.attendees = (body.attendees as ApiEvent["attendees"] & object).map((a) => ({
      ...a,
      responseStatus: a.responseStatus ?? (a.email === email ? "accepted" : "needsAction"),
    }));
  return patch;
}

export function busyWeek(
  email: string,
  from: number,
  to: number,
): { start: string; end: string }[] {
  let seed = [...email].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
  const next = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const busy: { start: string; end: string }[] = [];
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (; day.getTime() < to; day.setDate(day.getDate() + 1)) {
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    const blocks = 1 + Math.floor(next() * 3);
    for (let i = 0; i < blocks; i++) {
      const start = new Date(day);
      start.setHours(9 + Math.floor(next() * 8), next() < 0.5 ? 0 : 30);
      const end = new Date(start.getTime() + (1 + Math.floor(next() * 3)) * 30 * 60_000);
      if (end.getTime() > from && start.getTime() < to)
        busy.push({ start: start.toISOString(), end: end.toISOString() });
    }
  }
  return busy;
}

const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function occurrences(base: ApiEvent, from: number, to: number): ApiEvent[] {
  const rule = Object.fromEntries(
    (base.recurrence?.[0] ?? "")
      .replace(/^RRULE:/, "")
      .split(";")
      .map((part) => part.split("=") as [string, string]),
  );
  const first = startOf(base);
  const length = endOf(base) - first;
  const allDay = Boolean(base.start.date);
  const days = rule.BYDAY ? rule.BYDAY.split(",") : [RRULE_DAYS[new Date(first).getDay()]];
  const out: ApiEvent[] = [];
  const day = new Date(Math.max(first, from - length));
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 400 && day.getTime() < to; i++, day.setDate(day.getDate() + 1)) {
    const at = new Date(first);
    const start = new Date(day);
    start.setHours(at.getHours(), at.getMinutes(), 0, 0);
    const s = start.getTime();
    const matches =
      rule.FREQ === "DAILY" ||
      (rule.FREQ === "WEEKLY" && days.includes(RRULE_DAYS[day.getDay()]!)) ||
      (rule.FREQ === "MONTHLY" && day.getDate() === Number(rule.BYMONTHDAY ?? at.getDate())) ||
      (rule.FREQ === "YEARLY" &&
        day.getDate() === at.getDate() &&
        day.getMonth() === at.getMonth());
    if (!matches || s < first || s + length <= from || s >= to) continue;
    const id = `${base.id}_${dayKey(day).replaceAll("-", "")}`;
    out.push({
      ...base,
      id,
      recurringEventId: base.id,
      recurrence: undefined,
      start: allDay ? { date: dayKey(day) } : { dateTime: new Date(s).toISOString() },
      end: allDay
        ? { date: dayKey(new Date(s + length)) }
        : { dateTime: new Date(s + length).toISOString() },
      ...overrides.get(id),
    });
  }
  return out;
}

export function fakeCalendar(
  email: string,
  method: string,
  url: URL,
  body: Record<string, unknown>,
): Response {
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  if (url.pathname.endsWith("/freeBusy")) {
    const from = Date.parse(String(body.timeMin));
    const to = Date.parse(String(body.timeMax));
    const items = (body.items as { id: string }[] | undefined) ?? [];
    return json({
      calendars: Object.fromEntries(items.map(({ id }) => [id, { busy: busyWeek(id, from, to) }])),
    });
  }
  if (url.pathname.endsWith("/users/me/calendarList")) return json({ items: calendarList(email) });
  const calendarId = decodeURIComponent(
    /\/calendars\/([^/]+)/.exec(url.pathname)?.[1] ?? "primary",
  );
  const events = eventsOf(email, calendarId);
  const id = /\/events\/([^/]+)$/.exec(url.pathname)?.[1];
  // Invitations in the demo mail aren't on it: RSVPs go out as email replies.
  if (url.searchParams.has("iCalUID")) return json({ items: [] });
  if (!id && method === "GET") {
    const from = Date.parse(url.searchParams.get("timeMin") ?? "");
    const to = Date.parse(url.searchParams.get("timeMax") ?? "");
    const items = events
      .flatMap((e) => (e.recurrence ? occurrences(e, from, to) : [e]))
      .filter((e) => endOf(e) > from && startOf(e) < to)
      .sort((a, b) => startOf(a) - startOf(b));
    return json({ items });
  }
  if (!id && method === "POST") {
    const event: ApiEvent = {
      id: `ev${nextId++}`,
      status: "confirmed",
      summary: "",
      start: {},
      end: {},
      ...fromBody(body, email),
    };
    events.push(event);
    return json(event);
  }
  const wanted = decodeURIComponent(id ?? "");
  const index = events.findIndex((e) => e.id === wanted);
  if (index < 0) {
    const base = events.find((e) => e.recurrence && wanted.startsWith(`${e.id}_`));
    const date = wanted.slice(wanted.lastIndexOf("_") + 1);
    if (base) {
      const day = Date.parse(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00`);
      if (method === "PATCH")
        overrides.set(wanted, { ...overrides.get(wanted), ...fromBody(body, email) });
      const found = occurrences(base, day, day + 86_400_000).find((e) => e.id === wanted);
      if (found) return json(found);
    }
    const group = events.filter((e) => e.recurringEventId === wanted);
    if (group.length) {
      if (method === "PATCH") for (const e of group) Object.assign(e, fromBody(body, email));
      return json({ ...group[0], id: wanted, recurringEventId: undefined });
    }
    return json({ error: { code: 404, message: "Not found" } }, 404);
  }
  if (method === "DELETE") {
    events.splice(index, 1);
    return new Response(null, { status: 204 });
  }
  if (method === "PATCH") events[index] = { ...events[index], ...fromBody(body, email) };
  return json(events[index]);
}
