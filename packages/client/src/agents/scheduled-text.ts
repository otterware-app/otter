import type { ScheduledTaskInput, TaskSchedule } from "@otter/contracts/scheduled";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const clock = (hour: number, minute: number) =>
  new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const ordinal = (n: number) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
};

const plural = (n: number, unit: string) => (n === 1 ? unit : `${n} ${unit}s`);

export function everyText(ms: number): string {
  if (ms % DAY === 0) return `Every ${plural(ms / DAY, "day")}`;
  if (ms % HOUR === 0) return `Every ${plural(ms / HOUR, "hour")}`;
  if (ms % MINUTE === 0) return `Every ${plural(ms / MINUTE, "minute")}`;
  return `Every ${plural(Math.round(ms / 1000), "second")}`;
}

const NUMBER = /^\d+$/;

/** Days of the week a cron field names (`1-5`, `1,3,5`, `0`), or null for anything else. */
function weekdays(field: string): number[] | null {
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d)-(\d)$/.exec(part);
    if (range && Number(range[1]) <= Number(range[2]) && Number(range[2]) <= 7)
      for (let d = Number(range[1]); d <= Number(range[2]); d++) days.add(d % 7);
    else if (/^[0-7]$/.test(part)) days.add(Number(part) % 7);
    else return null;
  }
  return days.size > 0 ? [...days].sort() : null;
}

/** A cron expression in words, for the common shapes; null for the rest. */
export function cronText(expr: string): string | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields;
  const step = /^\*\/(\d+)$/;
  if (month !== "*" || (dom !== "*" && dow !== "*")) return null;
  if (hour === "*" && dom === "*" && dow === "*") {
    if (minute === "*") return "Every minute";
    const m = step.exec(minute);
    if (m) return `Every ${plural(Number(m[1]), "minute")}`;
    if (NUMBER.test(minute))
      return minute === "0" ? "Every hour" : `Hourly at :${minute.padStart(2, "0")}`;
    return null;
  }
  const hours = step.exec(hour);
  if (hours && NUMBER.test(minute) && dom === "*" && dow === "*")
    return `Every ${plural(Number(hours[1]), "hour")}`;
  if (!NUMBER.test(minute) || !NUMBER.test(hour)) return null;
  const at = clock(Number(hour), Number(minute));
  if (dom !== "*")
    return NUMBER.test(dom) ? `Monthly on the ${ordinal(Number(dom))} at ${at}` : null;
  if (dow === "*") return `Every day at ${at}`;
  const days = weekdays(dow);
  if (!days) return null;
  const key = days.join(",");
  if (key === "1,2,3,4,5") return `Weekdays at ${at}`;
  if (key === "0,6") return `Weekends at ${at}`;
  if (days.length === 7) return `Every day at ${at}`;
  if (days.length === 1) return `Every ${DAYS[days[0]]} at ${at}`;
  return `${days.map((d) => DAYS[d].slice(0, 3)).join(", ")} at ${at}`;
}

const onceText = (at: string) => {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? "Once"
    : `Once, ${date.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })}`;
};

/** When a task runs, in words: "Weekdays at 8:00 AM", "Every 2 hours", "Once, Mon 9 Nov, 9:00 AM". */
export function scheduleText(schedule: TaskSchedule, here = localTimeZone()): string {
  if (schedule.kind === "every") return everyText(schedule.everyMs);
  if (schedule.kind === "at") return onceText(schedule.at);
  if (schedule.kind === "other") return schedule.text;
  const text = cronText(schedule.expr) ?? `Cron ${schedule.expr}`;
  return schedule.tz && schedule.tz !== here ? `${text} (${schedule.tz})` : text;
}

/** A day and time near `now`: "today at 6:47 PM", "tomorrow at 9:00 AM", "yesterday at…", "Monday at…". */
export function dayTimeText(at: number, now: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const days = Math.round(
    (new Date(date).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY,
  );
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days === -1) return `yesterday at ${time}`;
  if (days > 1 && days < 7) return `${DAYS[date.getDay()]} at ${time}`;
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  return `${day} at ${time}`;
}

/** How long until `at`: "in 5 min", "in 3 h", "in 2 days"; "now" once it's due. */
export function untilText(at: number, now: number): string {
  const left = at - now;
  if (left < MINUTE) return "now";
  if (left < HOUR) return `in ${Math.round(left / MINUTE)} min`;
  if (left < DAY) return `in ${Math.round(left / HOUR)} h`;
  const days = Math.round(left / DAY);
  return `in ${days} ${days === 1 ? "day" : "days"}`;
}

export function agoText(at: number, now: number): string {
  const past = now - at;
  if (past < MINUTE) return "just now";
  if (past < HOUR) return `${Math.round(past / MINUTE)} min ago`;
  if (past < DAY) return `${Math.round(past / HOUR)} h ago`;
  const days = Math.round(past / DAY);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function durationText(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < MINUTE) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / MINUTE)} min ${Math.round((ms % MINUTE) / 1000)} s`;
}

export type Repeat = "daily" | "weekdays" | "weekly" | "monthly" | "interval" | "once" | "cron";

/** The editor's "when", in the fields a person picks. */
export type WhenForm = {
  repeat: Repeat;
  /** HH:MM */
  time: string;
  weekday: number;
  monthDay: number;
  every: number;
  unit: "minutes" | "hours";
  /** A local datetime, YYYY-MM-DDTHH:MM. */
  once: string;
  cron: string;
  tz: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export const localDateTime = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function newWhenForm(now = new Date()): WhenForm {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  return {
    repeat: "daily",
    time: "09:00",
    weekday: 1,
    monthDay: 1,
    every: 1,
    unit: "hours",
    once: localDateTime(tomorrow),
    cron: "0 9 * * *",
    tz: localTimeZone(),
  };
}

/** A schedule as the editor shows it; one it has no fields for is a cron expression, or can't be edited. */
export function whenFormOf(schedule: TaskSchedule, now = new Date()): WhenForm | null {
  const form = newWhenForm(now);
  if (schedule.kind === "other") return null;
  if (schedule.kind === "at") {
    const date = new Date(schedule.at);
    return Number.isNaN(date.getTime())
      ? null
      : { ...form, repeat: "once", once: localDateTime(date) };
  }
  if (schedule.kind === "every") {
    const hours = schedule.everyMs % HOUR === 0;
    return {
      ...form,
      repeat: "interval",
      unit: hours ? "hours" : "minutes",
      every: Math.max(1, Math.round(schedule.everyMs / (hours ? HOUR : MINUTE))),
    };
  }
  // No zone is the agent's own: kept, not replaced with this device's.
  const tz = schedule.tz ?? "";
  const custom = { ...form, repeat: "cron" as const, cron: schedule.expr, tz };
  const fields = schedule.expr.trim().split(/\s+/);
  const [minute, hour, dom, month, dow] = fields;
  if (fields.length !== 5 || month !== "*" || !NUMBER.test(minute) || !NUMBER.test(hour))
    return custom;
  const timed = { ...form, tz, time: `${pad(Number(hour))}:${pad(Number(minute))}` };
  if (dom === "*" && dow === "*") return { ...timed, repeat: "daily" };
  if (dom === "*" && dow === "1-5") return { ...timed, repeat: "weekdays" };
  if (dom === "*" && /^[0-7]$/.test(dow))
    return { ...timed, repeat: "weekly", weekday: Number(dow) % 7 };
  if (dow === "*" && NUMBER.test(dom) && Number(dom) >= 1 && Number(dom) <= 31)
    return { ...timed, repeat: "monthly", monthDay: Number(dom) };
  return custom;
}

export function scheduleOfForm(form: WhenForm): ScheduledTaskInput["schedule"] {
  const [hour, minute] = form.time.split(":").map(Number);
  const at = `${minute || 0} ${hour || 0}`;
  const cron = (expr: string) => ({
    kind: "cron" as const,
    expr,
    ...(form.tz ? { tz: form.tz } : {}),
  });
  switch (form.repeat) {
    case "daily":
      return cron(`${at} * * *`);
    case "weekdays":
      return cron(`${at} * * 1-5`);
    case "weekly":
      return cron(`${at} * * ${form.weekday}`);
    case "monthly":
      return cron(`${at} ${form.monthDay} * *`);
    case "interval":
      return {
        kind: "every",
        everyMs: Math.max(1, form.every) * (form.unit === "hours" ? HOUR : MINUTE),
      };
    case "once":
      return { kind: "at", at: new Date(form.once).toISOString() };
    case "cron":
      return cron(form.cron.trim());
  }
}

/** What's wrong with the "when", if anything. */
export function whenProblem(form: WhenForm, now = Date.now()): string | null {
  const timed = ["daily", "weekdays", "weekly", "monthly"].includes(form.repeat);
  if (timed && !/^\d{2}:\d{2}$/.test(form.time)) return "Pick a time.";
  if (form.repeat === "once") {
    const at = new Date(form.once).getTime();
    if (Number.isNaN(at)) return "Pick a date and time.";
    if (at <= now) return "Pick a time in the future.";
  }
  if (form.repeat === "interval" && (!Number.isInteger(form.every) || form.every < 1))
    return "Run it at least every minute.";
  if (form.repeat === "cron" && ![5, 6].includes(form.cron.trim().split(/\s+/).length))
    return "A cron expression has five fields: minute hour day month weekday.";
  return null;
}
