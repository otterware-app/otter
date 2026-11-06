import type { ColorSchemeName } from "react-native";

export type Palette = ReturnType<typeof palette>;

export function palette(scheme: ColorSchemeName | null | undefined) {
  return scheme === "dark"
    ? {
        background: "#000000",
        text: "#F2F2F7",
        secondary: "#8E8E93",
        accent: "#5AA9FF",
        pressed: "#1C1C1E",
        card: "#1C1C1E",
        unreadCard: "#15181E",
        border: "#2C2C2E",
        archive: "#30D158",
        trash: "#FF453A",
        star: "#FFD60A",
        pill: "#3A3A3C",
        focus: "#5AA9FF",
      }
    : {
        background: "#FFFFFF",
        text: "#111111",
        secondary: "#6B6B70",
        accent: "#1F6FEB",
        pressed: "#F2F2F7",
        card: "#F2F2F7",
        unreadCard: "#F3F6FB",
        border: "#E5E5EA",
        archive: "#34C759",
        trash: "#FF3B30",
        star: "#FFB800",
        pill: "#D1D1D6",
        focus: "#1F6FEB",
      };
}

export function relativeDate(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}
