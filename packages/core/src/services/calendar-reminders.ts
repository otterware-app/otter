import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { capabilitiesOf, providerFor } from "../providers/index.js";
import type { CalendarEvent } from "../providers/provider.js";
import type { MailAccount } from "../types.js";
import { listAccounts } from "./account-store.js";
import { turnedOffMailboxes } from "./mail-sync.js";
import { accountLabel } from "./notifier.js";
import { getSettings, onSettingsChanged } from "./settings-store.js";

export const REMINDER_LEAD_MS = 10 * 60_000;
const CHECK_MS = 5 * 60_000;

/** Reminders waiting to fire, by account, replaced by each check that reads the account. */
const pending = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
/** Reminders shown, by event start and title: one event on two calendars or mailboxes reminds once. */
const reminded = new Map<string, number>();

export function startCalendarReminders(): void {
  void checkReminders();
  setInterval(() => void checkReminders(), CHECK_MS);
  onSettingsChanged((_settings, patch) => {
    if (patch.calendarReminders !== undefined) void checkReminders();
  });
}

/** Events starting in the next check's window, from the calendars each mailbox shows by default. */
export async function checkReminders(now = Date.now()): Promise<void> {
  try {
    for (const [key, start] of reminded) if (start < now) reminded.delete(key);
    if (!(await getSettings()).calendarReminders) return clearPending();
    const off = turnedOffMailboxes();
    const accounts = (await listAccounts()).filter(
      (a) => capabilitiesOf(a)?.calendar && !off.has(a.email.toLowerCase()),
    );
    for (const id of pending.keys()) if (!accounts.some((a) => a.id === id)) clearPending(id);
    await Promise.all(accounts.map((account) => checkAccount(account, now)));
  } catch (err) {
    logger.failure("calendar-reminders", "checking for reminders failed", err);
  }
}

async function checkAccount(account: MailAccount, now: number): Promise<void> {
  const calendar = providerFor(account.id).calendar;
  if (!calendar) return;
  const range = {
    from: new Date(now).toISOString(),
    to: new Date(now + REMINDER_LEAD_MS + CHECK_MS).toISOString(),
    limit: 50,
  };
  let events: CalendarEvent[];
  try {
    const calendars = (await calendar.listCalendars(account.id)).filter((c) => !c.hiddenByDefault);
    events = (
      await Promise.all(
        calendars.map((c) => calendar.listEvents(account.id, { ...range, calendarId: c.id })),
      )
    ).flat();
  } catch {
    // Unreachable for now (offline, or no calendar access): what's set keeps.
    return;
  }
  clearPending(account.id);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  pending.set(account.id, timers);
  for (const event of events) {
    const start = Date.parse(event.start);
    if (
      event.allDay ||
      event.status === "cancelled" ||
      event.response === "declined" ||
      !(start > now)
    )
      continue;
    const key = `${start}:${event.title}`;
    if (reminded.has(key) || timers.has(key)) continue;
    const fire = () => {
      timers.delete(key);
      if (reminded.has(key)) return;
      reminded.set(key, start);
      remind(account, event, start);
    };
    timers.set(key, setTimeout(fire, Math.max(0, start - REMINDER_LEAD_MS - now)));
  }
}

function clearPending(accountId?: string): void {
  for (const [id, timers] of pending) {
    if (accountId && id !== accountId) continue;
    for (const timer of timers.values()) clearTimeout(timer);
    pending.delete(id);
  }
}

function remind(account: MailAccount, event: CalendarEvent, start: number): void {
  const minutes = Math.round((start - Date.now()) / 60_000);
  const when = minutes >= 1 ? `In ${minutes} minute${minutes === 1 ? "" : "s"}` : "Now";
  platform().notify({
    category: "calendar",
    title: `Calendar · ${accountLabel(account)}`,
    subtitle: event.title || "Untitled event",
    body: event.location ? `${when} · ${event.location}` : when,
  });
}
