import { create } from "zustand";
import { startOfDay } from "./dates";

const HIDDEN_KEY = "calendar:hidden";
const TEAM_KEY = "calendar:team";

/** Someone whose calendar is shown over yours (⌘P). */
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

function readHidden(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** A new event being drawn, before it has a title and is saved. */
export type DraftEvent = {
  accountId: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  title?: string;
};

export type Selection = { accountId: string; id: string } | { draft: true };

type CalendarState = {
  /** The day the view is around; scrolled sideways (`free`), the week's first day shown. */
  date: Date;
  free: boolean;
  /** Mid-scroll, the first day passing by (the mini month and the title follow it). */
  peek: Date | null;
  /** A day to glide to (Today, the mini month); the view takes it and clears it. */
  target: Date | null;
  hidden: string[];
  team: Teammate[];
  selection: Selection | null;
  draft: DraftEvent | null;
  setDate: (date: Date) => void;
  /** Scrolled to: the week starts on this day, not the locale's first. */
  setStart: (date: Date) => void;
  setPeek: (date: Date | null) => void;
  goTo: (date: Date) => void;
  toggleHidden: (accountId: string) => void;
  addTeammate: (teammate: Teammate) => void;
  removeTeammate: (email: string) => void;
  clearTeam: () => void;
  select: (selection: Selection | null) => void;
  setDraft: (draft: DraftEvent | null) => void;
};

export const useCalendar = create<CalendarState>((set) => ({
  date: startOfDay(new Date()),
  free: false,
  peek: null,
  target: null,
  hidden: readHidden(),
  team: readTeam(),
  selection: null,
  draft: null,
  setDate: (date) => set({ date: startOfDay(date), free: false, peek: null, target: null }),
  setStart: (date) => set({ date: startOfDay(date), free: true, peek: null }),
  setPeek: (peek) => set({ peek }),
  goTo: (date) => set({ target: startOfDay(date) }),
  toggleHidden: (accountId) =>
    set((s) => {
      const hidden = s.hidden.includes(accountId)
        ? s.hidden.filter((id) => id !== accountId)
        : [...s.hidden, accountId];
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden));
      return { hidden };
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
}));
