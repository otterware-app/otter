export type WallClock = {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM-DDTHH:mm:ss */
  dateTime: string;
  /** 0 is Sunday. */
  weekday: number;
  day: number;
  month: number;
};

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function wallClock(value: string, timeZone: string): WallClock {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return {
      date: value,
      dateTime: `${value}T00:00:00`,
      weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
      day: d,
      month: m,
    };
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw new Error(`Not a date-time: ${value}`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
      .formatToParts(time)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date,
    dateTime: `${date}T${parts.hour}:${parts.minute}:${parts.second}`,
    weekday: WEEKDAY[parts.weekday] ?? 0,
    day: Number(parts.day),
    month: Number(parts.month),
  };
}
