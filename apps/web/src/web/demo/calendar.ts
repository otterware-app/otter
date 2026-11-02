/**
 * The demo mailbox's Google Calendar: a made-up week of events around today,
 * kept in memory, answering the Calendar API calls the provider makes.
 */

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
  recurringEventId?: string;
};

const calendars = new Map<string, ApiEvent[]>();
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
      attendees: people(
        "accepted",
        ["Maya Chen", "maya@northwind.example"],
        ["Leo Park", "leo@northwind.example"],
      ),
    });
  }
  // The first demo mailbox is someone's own; the others are work.
  const events = email.startsWith("demo@") ? personal : work;
  return events.map((e) => ({ ...e, id: `ev${nextId++}`, status: "confirmed" }));
}

function eventsOf(email: string): ApiEvent[] {
  let events = calendars.get(email);
  if (!events) calendars.set(email, (events = seed(email)));
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
  if (Array.isArray(body.attendees))
    patch.attendees = (body.attendees as ApiEvent["attendees"] & object).map((a) => ({
      ...a,
      responseStatus: a.responseStatus ?? (a.email === email ? "accepted" : "needsAction"),
    }));
  return patch;
}

/** Someone's made-up busy week, the same every time for the same address. */
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

/** The answer to a request under /calendar/v3/calendars/primary, or the free/busy query. */
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
  const events = eventsOf(email);
  const id = /\/events\/([^/]+)$/.exec(url.pathname)?.[1];
  // Invitations in the demo mail aren't on it: RSVPs go out as email replies.
  if (url.searchParams.has("iCalUID")) return json({ items: [] });
  if (!id && method === "GET") {
    const from = Date.parse(url.searchParams.get("timeMin") ?? "");
    const to = Date.parse(url.searchParams.get("timeMax") ?? "");
    const items = events
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
  const index = events.findIndex((e) => e.id === decodeURIComponent(id ?? ""));
  if (index < 0) return json({ error: { code: 404, message: "Not found" } }, 404);
  if (method === "DELETE") {
    events.splice(index, 1);
    return new Response(null, { status: 204 });
  }
  if (method === "PATCH") events[index] = { ...events[index], ...fromBody(body, email) };
  return json(events[index]);
}
