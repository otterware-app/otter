import type { CSSProperties } from "react";
import { getAccountContrastColor } from "../mail/account-style";
import type { CalEvent } from "./api";
import { timeLabel } from "./dates";

export const isPending = (event: Pick<CalEvent, "response">) =>
  event.response === "needsAction" || event.response === "tentative";

export function eventStyle(
  color: string,
  event: Pick<CalEvent, "response">,
  selected: boolean,
): CSSProperties {
  if (selected)
    return {
      "--event-color": color,
      background: color,
      color: getAccountContrastColor(color),
      borderColor: color,
    } as CSSProperties;
  if (isPending(event))
    return {
      "--event-color": color,
      background: "var(--canvas)",
      borderColor: `color-mix(in srgb, ${color} 70%, transparent)`,
    } as CSSProperties;
  return {
    "--event-color": color,
    background: `color-mix(in srgb, ${color} 18%, var(--canvas))`,
    borderColor: "transparent",
  } as CSSProperties;
}

export function rangeLabel(startMs: number, endMs: number): string {
  const start = timeLabel(new Date(startMs));
  const end = timeLabel(new Date(endMs));
  const suffix = /\s?[AP]M$/i.exec(start)?.[0];
  if (suffix && end.endsWith(suffix.trim())) return `${start.slice(0, -suffix.length)}–${end}`;
  return `${start}–${end}`;
}
