/**
 * Ported from T3 Code (github.com/pingdotgg/t3code at a107f8a07; MIT, see
 * THIRD_PARTY_NOTICES.md):
 * apps/web/src/components/settings/themeEditorStore.ts. Mail: without
 * toggleThemeEditorForTheme (upstream's command-palette toggle).
 */
import { create } from "zustand";

import type { ThemeAppearance } from "../../theme/themePalette";

/**
 * The theme editor lives above the router so a draft survives navigation: the
 * palette is painted on the live app, and judging it means browsing the app
 * while the editor stays open. Themes are referenced by id because the stored
 * definitions change underneath an open session (an edit, an import).
 */
export type ThemeEditorSessionInput = {
  editingThemeId: string | null;
  seedThemeId: string | null;
  seedName: string | null;
  initialAppearance: ThemeAppearance;
};

export type ThemeEditorSession = ThemeEditorSessionInput & {
  /**
   * Distinguishes two sessions that name the same themes, so asking for a
   * fresh draft while the panel is already open still reseeds it.
   */
  id: number;
};

type ThemeEditorStore = {
  session: ThemeEditorSession | null;
  openThemeEditor: (session: ThemeEditorSessionInput) => void;
  closeThemeEditor: () => void;
};

let nextSessionId = 0;

export const useThemeEditorStore = create<ThemeEditorStore>((set) => ({
  session: null,
  openThemeEditor: (session) => set({ session: { ...session, id: ++nextSessionId } }),
  closeThemeEditor: () => set({ session: null }),
}));
