import { Switch } from "~/components/ui/switch";
import { useCalendarLists } from "../calendar/api";
import { calendarAccounts } from "../calendar/calendar-view";
import { MEETING_NAMES, MeetingMark } from "../calendar/meeting";
import { getAccountDisplayName } from "../mail/account-style";
import { useAccounts } from "../mail/hooks";
import {
  CALENDAR_DEFAULTS,
  setCalendarPreference,
  useCalendarPreferences,
  type CalendarPreferences,
  type TimeFormat,
  type WeekStart,
} from "../calendar/preferences";
import {
  RowSelect,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-ui";
import { searchableSetting } from "./settings-search";

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
    <SettingResetButton
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

export function CalendarPane() {
  const prefs = useCalendarPreferences();
  return (
    <SettingsPageContainer title="Calendar">
      <SettingsSection title="Week">
        <SettingsRow
          {...searchableSetting("calendar-week-start")}
          resetAction={reset(prefs, "weekStart", "start of week")}
          description="The first day of the week in the week and month views, and the small month."
          control={
            <RowSelect
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
            <RowSelect
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
