import { logger } from "../logger.ts";
import { platform } from "../platform.ts";
import { capabilitiesOf } from "../providers/index.ts";
import type { CalendarEvent } from "../providers/provider.ts";
import type { MailAccount } from "../types.ts";
import { listAccounts } from "./account-store.ts";
import * as calendarStore from "./calendar-store.ts";
import { onCalendarChanged } from "./calendar-sync.ts";
import { turnedOffMailboxes } from "./mail-sync.ts";
import { accountLabel } from "./notifier.ts";
import { getSettings, onSettingsChanged } from "./settings-store.ts";

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
  // An event added or moved into the next minutes reminds too.
  let again: ReturnType<typeof setTimeout> | undefined;
  onCalendarChanged(() => {
    clearTimeout(again);
    again = setTimeout(() => void checkReminders(), 1_000);
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
    for (const account of accounts) checkAccount(account, now);
  } catch (err) {
    logger.failure("calendar-reminders", "checking for reminders failed", err);
  }
}

/** From the synced calendars (calendar-sync.ts), so a check costs no request. */
function checkAccount(account: MailAccount, now: number): void {
  const list = calendarStore.getList(account.id);
  if (!list) return;
  const events: CalendarEvent[] = list.calendars
    .filter((c) => !c.hiddenByDefault)
    .flatMap((c) =>
      calendarStore.eventsIn(account.id, c.id, now, now + REMINDER_LEAD_MS + CHECK_MS),
    );
  clearPending(account.id);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  pending.set(account.id, timers);
  for (const event of events) {
    const start = Date.parse(event.start);
    if (
      event.allDay ||
      event.status === "cancelled" ||
      event.response === "declined" ||
      !(start > now) ||
      start > now + REMINDER_LEAD_MS + CHECK_MS
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
