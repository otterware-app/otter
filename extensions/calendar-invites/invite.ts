export type RsvpResponse = "accepted" | "declined" | "tentative";

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
  htmlLink: string | null;
  cancelled: boolean;
};

export const hasInvite = (detail: { attachments: { mimeType: string; filename: string }[] }) =>
  detail.attachments.some(
    (a) => /text\/calendar|application\/ics/i.test(a.mimeType) || /\.ics$/i.test(a.filename),
  );

export function formatWhen(invite: CalendarInvite): string | null {
  if (!invite.start) return null;
  const start = new Date(invite.allDay ? `${invite.start}T00:00:00` : invite.start);
  const end = invite.end ? new Date(invite.allDay ? `${invite.end}T00:00:00` : invite.end) : null;
  const day = (d: Date) =>
    d.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (invite.allDay) {
    // DTEND of an all-day event is exclusive.
    const last = end ? new Date(end.getTime() - 86_400_000) : start;
    return last > start ? `${day(start)} – ${day(last)}` : day(start);
  }
  if (!end) return `${day(start)}, ${time(start)}`;
  return start.toDateString() === end.toDateString()
    ? `${day(start)}, ${time(start)} – ${time(end)}`
    : `${day(start)}, ${time(start)} – ${day(end)}, ${time(end)}`;
}

export const CHOICES: { value: RsvpResponse; label: string }[] = [
  { value: "accepted", label: "Yes" },
  { value: "declined", label: "No" },
  { value: "tentative", label: "Maybe" },
];

export const DONE: Record<RsvpResponse, string> = {
  accepted: "You're going",
  declined: "You declined",
  tentative: "You might go",
};
