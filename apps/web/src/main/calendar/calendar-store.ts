import { create } from "zustand";
import type { Repeat } from "./api";
import { startOfDay } from "./dates";

const SHOWN_KEY = "calendar:shown";
const TEAM_KEY = "calendar:team";

export type Teammate = { email: string; name: string };

function readTeam(): Teammate[] {
  try {
    const value = JSON.parse(localStorage.getItem(TEAM_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((t) => typeof t?.email === "string" && typeof t?.name === "string")
      : [];
  } catch {
    return [];
  }
}

function saveTeam(team: Teammate[]): { team: Teammate[] } {
  localStorage.setItem(TEAM_KEY, JSON.stringify(team));
  return { team };
}

/** Calendars shown or hidden by hand (by calendarKey); the rest follow where they came from. */
function readShown(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export const isShown = (shown: Record<string, boolean>, key: string, hiddenByDefault: boolean) =>
  shown[key] ?? !hiddenByDefault;

export type DraftEvent = {
  accountId: string;
  calendarId: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  title?: string;
  repeat?: Repeat;
};

export type Selection = { accountId: string; calendarId: string; id: string } | { draft: true };

type CalendarState = {
  /** The day the view is around; scrolled sideways (`free`), the week's first day shown. */
  date: Date;
  free: boolean;
  /** Mid-scroll, the first day passing by (the mini month and the title follow it). */
  peek: Date | null;
  /** A day to glide to (Today, the mini month); the view takes it and clears it. */
  target: Date | null;
  shown: Record<string, boolean>;
  team: Teammate[];
  selection: Selection | null;
  draft: DraftEvent | null;
  agenda: string | null;
  /** An event to open once the view has glided to it. */
  reveal: Selection | null;
  setDate: (date: Date) => void;
  /** Scrolled to: the week starts on this day, not the locale's first. */
  setStart: (date: Date) => void;
  setPeek: (date: Date | null) => void;
  goTo: (date: Date) => void;
  setShown: (key: string, show: boolean) => void;
  showOnly: (key: string, keys: string[]) => void;
  addTeammate: (teammate: Teammate) => void;
  removeTeammate: (email: string) => void;
  clearTeam: () => void;
  select: (selection: Selection | null) => void;
  setDraft: (draft: DraftEvent | null) => void;
  setAgenda: (key: string | null) => void;
  show: (event: { accountId: string; calendarId: string; id: string; startMs: number }) => void;
};

export const useCalendar = create<CalendarState>((set) => ({
  date: startOfDay(new Date()),
  free: false,
  peek: null,
  target: null,
  shown: readShown(),
  team: readTeam(),
  selection: null,
  draft: null,
  agenda: null,
  reveal: null,
  setDate: (date) => set({ date: startOfDay(date), free: false, peek: null, target: null }),
  setStart: (date) => set({ date: startOfDay(date), free: true, peek: null }),
  setPeek: (peek) => set({ peek }),
  goTo: (date) => set({ target: startOfDay(date) }),
  setShown: (key, show) =>
    set((s) => {
      const shown = { ...s.shown, [key]: show };
      localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
      return { shown };
    }),
  showOnly: (key, keys) =>
    set((s) => {
      const shown = { ...s.shown, ...Object.fromEntries(keys.map((k) => [k, k === key])) };
      localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
      return { shown };
    }),
  addTeammate: (teammate) =>
    set((s) =>
      s.team.some((t) => t.email.toLowerCase() === teammate.email.toLowerCase())
        ? s
        : saveTeam([...s.team, teammate]),
    ),
  removeTeammate: (email) => set((s) => saveTeam(s.team.filter((t) => t.email !== email))),
  clearTeam: () => set(saveTeam([])),
  select: (selection) =>
    set((s) => ({ selection, draft: selection && "draft" in selection ? s.draft : null })),
  setDraft: (draft) => set({ draft, selection: draft ? { draft: true } : null }),
  setAgenda: (agenda) => set({ agenda }),
  show: ({ accountId, calendarId, id, startMs }) =>
    set({
      target: startOfDay(new Date(startMs)),
      reveal: { accountId, calendarId, id },
      draft: null,
    }),
}));
