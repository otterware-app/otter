import { useEffect, useState } from "react";
import { Switch } from "@otter/ui/components/switch";
import { useCalendarLists } from "../calendar/api";
import { calendarAccounts } from "../calendar/calendar-view";
import { MEETING_NAMES, MeetingMark } from "../calendar/meeting";
import { getAccountDisplayName } from "../mail/account-style";
import { mailApi, type SyncSettings } from "../mail/api";
import { useAccounts } from "../mail/hooks";
import { toast } from "@otter/ui/components/toast";
import {
  CALENDAR_DEFAULTS,
  setCalendarPreference,
  useCalendarPreferences,
  type CalendarPreferences,
  type TimeFormat,
  type WeekStart,
} from "../calendar/preferences";
import { searchableSetting } from "./settings-search";
import {
  SettingsSelect,
  SettingsResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "@otter/ui/components/settings";

const WEEK_START_OPTIONS: { value: WeekStart; label: string }[] = [
  { value: "auto", label: "As in your region" },
  { value: "sunday", label: "Sunday" },
  { value: "monday", label: "Monday" },
  { value: "saturday", label: "Saturday" },
];

const TIME_FORMAT_OPTIONS: { value: TimeFormat; label: string }[] = [
  { value: "auto", label: "As in your region" },
  { value: "12", label: "12-hour (1:00 PM)" },
  { value: "24", label: "24-hour (13:00)" },
];

function reset<K extends keyof CalendarPreferences>(
  prefs: CalendarPreferences,
  key: K,
  label: string,
) {
  return prefs[key] !== CALENDAR_DEFAULTS[key] ? (
    <SettingsResetButton
      label={label}
      onClick={() => setCalendarPreference(key, CALENDAR_DEFAULTS[key])}
    />
  ) : null;
}

function ConferencingSection({ meetingsByDefault }: { meetingsByDefault: string[] }) {
  const accounts = calendarAccounts(useAccounts().data ?? []);
  const lists = useCalendarLists(accounts.map((a) => a.id));
  const rows = accounts.flatMap((account) => {
    const calendars = lists.data?.find((l) => l.accountId === account.id)?.calendars;
    const service = calendars?.find((c) => c.primary)?.meetings;
    return service ? [{ account, service }] : [];
  });
  if (!rows.length) return null;
  return (
    <SettingsSection
      {...searchableSetting("calendar-meetings")}
      description="Add an online meeting to new events from each mailbox. Each event can still add or remove one."
    >
      {rows.map(({ account, service }) => (
        <SettingsRow
          key={account.id}
          title={
            <span className="flex items-center gap-2">
              <MeetingMark provider={service} className="size-4" />
              {MEETING_NAMES[service]}
            </span>
          }
          description={`New events from ${getAccountDisplayName(account)} (${account.email})`}
          control={
            <Switch
              checked={meetingsByDefault.includes(account.id)}
              onCheckedChange={(checked) =>
                setCalendarPreference(
                  "meetingsByDefault",
                  checked
                    ? [...meetingsByDefault, account.id]
                    : meetingsByDefault.filter((id) => id !== account.id),
                )
              }
              aria-label={`Add ${MEETING_NAMES[service]} to new events from ${account.email}`}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}

function RemindersRow() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void mailApi
      .getSyncSettings()
      .then((settings) => {
        if (active) setOn(settings.calendarReminders);
      })
      .catch(() => {});
    const off = window.desktopBridge.on("settings:changed", (raw: unknown) => {
      const settings = raw as Partial<SyncSettings> | null;
      if (typeof settings?.calendarReminders === "boolean") setOn(settings.calendarReminders);
    });
    return () => {
      active = false;
      off();
    };
  }, []);

  const update = (next: boolean) => {
    setOn(next);
    void mailApi.setSyncSettings({ calendarReminders: next }).catch((error: unknown) => {
      setOn(!next);
      toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  return (
    <SettingsRow
      {...searchableSetting("calendar-reminders")}
      description="A notification 10 minutes before each event, from the calendars each mailbox shows by default."
      control={
        <Switch
          checked={on ?? false}
          disabled={on === null}
          onCheckedChange={update}
          aria-label="Event reminders"
        />
      }
    />
  );
}

export function CalendarPane() {
  const prefs = useCalendarPreferences();
  return (
    <SettingsPageContainer title="Calendar">
      <SettingsSection title="Notifications">
        <RemindersRow />
      </SettingsSection>
      <SettingsSection title="Week">
        <SettingsRow
          {...searchableSetting("calendar-week-start")}
          resetAction={reset(prefs, "weekStart", "start of week")}
          description="The first day of the week in the week and month views, and the small month."
          control={
            <SettingsSelect
              value={prefs.weekStart}
              onValueChange={(v) => setCalendarPreference("weekStart", v as WeekStart)}
              options={WEEK_START_OPTIONS}
              ariaLabel="Start of week"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("calendar-weekends")}
          resetAction={reset(prefs, "showWeekends", "show weekends")}
          description="Off, the week and month views show only weekdays."
          control={
            <Switch
              checked={prefs.showWeekends}
              onCheckedChange={(checked) => setCalendarPreference("showWeekends", checked)}
              aria-label="Show weekends"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Events">
        <SettingsRow
          {...searchableSetting("calendar-declined")}
          resetAction={reset(prefs, "showDeclined", "show declined events")}
          description="Invitations you said no to, struck through."
          control={
            <Switch
              checked={prefs.showDeclined}
              onCheckedChange={(checked) => setCalendarPreference("showDeclined", checked)}
              aria-label="Show declined events"
            />
          }
        />
        <SettingsRow
          {...searchableSetting("calendar-time-format")}
          resetAction={reset(prefs, "timeFormat", "time format")}
          description="How times read on the calendar and its events."
          control={
            <SettingsSelect
              value={prefs.timeFormat}
              onValueChange={(v) => setCalendarPreference("timeFormat", v as TimeFormat)}
              options={TIME_FORMAT_OPTIONS}
              ariaLabel="Time format"
            />
          }
        />
      </SettingsSection>

      <ConferencingSection meetingsByDefault={prefs.meetingsByDefault} />
    </SettingsPageContainer>
  );
}
