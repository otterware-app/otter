import { Switch } from "~/components/ui/switch";
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

/** A way back to the default, once it's been changed. */
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

/** Settings → Calendar: how the calendar lays out the week and shows its events. */
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
    </SettingsPageContainer>
  );
}
