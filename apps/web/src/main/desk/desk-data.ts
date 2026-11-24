import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { TodoistPage, TodoistTask } from "@otter/contracts/todoist";
import { ipc, task } from "~/lib/ipc";
import { calendarKey, useCalendarLists, useUpcomingEvents, type CalEvent } from "../calendar/api";
import { isShown, useCalendar } from "../calendar/calendar-store";
import { calendarAccounts, listedCalendars } from "../calendar/calendar-view";
import { useCalendarPreferences } from "../calendar/preferences";
import { useEnabledExtensions } from "../extensions/registry";
import { useCombinedMessages } from "../mail/hooks";
import type { MailAccount, MessageSummary } from "../mail/types";

/**
 * Today's conversations in every inbox that wait on you: unread or starred, and not last
 * written by you.
 */
export function useTodayMail(accounts: MailAccount[], from: number): MessageSummary[] {
  const rules = accounts.map((a) => ({ accountId: a.id, allOf: ["INBOX"], noneOf: [] }));
  const query = useCombinedMessages(rules, "desk");
  const mine = new Set(accounts.map((a) => a.email.toLowerCase()));
  return (query.data?.pages ?? [])
    .flatMap((page) => page.messages)
    .filter(
      (m) =>
        m.date >= from &&
        ((m.threadUnread ?? m.unread) || (m.threadStarred ?? m.starred)) &&
        !mine.has((m.threadSenders?.at(-1)?.email ?? m.fromEmail).toLowerCase()),
    );
}

/** Today's events in the calendars shown, as the calendar shows them. */
export function useTodayEvents(accounts: MailAccount[], from: number): CalEvent[] {
  const calendars = calendarAccounts(accounts);
  const lists = useCalendarLists(calendars.map((a) => a.id)).data;
  const { colors, showDeclined } = useCalendarPreferences();
  const shown = useCalendar((s) => s.shown);
  const visible = listedCalendars(calendars, lists, colors).filter((c) =>
    isShown(shown, c.key, c.info.hiddenByDefault),
  );
  const keys = new Set(visible.map((c) => c.key));
  const query = useUpcomingEvents(
    visible.map((c) => ({
      accountId: c.account.id,
      calendarId: c.info.id,
      writable: c.info.writable,
    })),
    from,
    1,
  );
  return (query.data?.events ?? [])
    .filter(
      (e) =>
        keys.has(calendarKey(e)) &&
        !e.allDay &&
        e.status !== "cancelled" &&
        (showDeclined || e.response !== "declined"),
    )
    .sort((a, b) => a.startMs - b.startMs);
}

/** Todoist's tasks due today or overdue, when it's connected, and how to open them. */
export function useTodayTasks(): { tasks: TodoistTask[]; open?: () => void } {
  const todoist = useEnabledExtensions().find((e) => e.manifest.id === "todoist");
  const enabled = todoist !== undefined;
  const qc = useQueryClient();
  useEffect(
    () =>
      window.desktopBridge.on("todoist:tasksChanged", () => {
        void qc.invalidateQueries({ queryKey: ["todoist", "desk"] });
      }),
    [qc],
  );
  const status = useQuery({
    queryKey: ["todoist", "status"],
    queryFn: () => ipc<{ connected: boolean }>("todoist:status"),
    enabled,
  });
  const connected = enabled && status.data?.connected === true;
  const tasks = useQuery({
    queryKey: ["todoist", "desk"],
    queryFn: () => task<TodoistPage>("todoist:tasks", { filter: "today | overdue" }),
    enabled: connected,
    staleTime: 60_000,
  });
  if (!connected) return { tasks: [] };
  return {
    tasks: tasks.data?.results ?? [],
    open: todoist.commands?.find((c) => c.id === "todoist")?.run,
  };
}
