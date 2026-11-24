import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { create } from "zustand";

import type { Tab } from "./tabs.ts";

/** A card over the bar: a tab's recents (touch and hold it), the agents to ask, or chats you started writing. */
export type Card = { kind: "recents"; tab: Tab } | { kind: "agents" } | { kind: "drafts" };

type FrameState = {
  card: Card | null;
  /** Screens in front that asked for the bars to leave. */
  hiding: number;
  /** A chat that finished while you were elsewhere. */
  finished: string | null;
};

export const useFrame = create<FrameState>(() => ({ card: null, hiding: 0, finished: null }));

export const showCard = (card: Card | null) => useFrame.setState({ card });
export const showFinished = (finished: string | null) => useFrame.setState({ finished });

/**
 * The bars (ask and tabs) leave while `hidden` and the calling screen is in front: chats being
 * selected. A pushed screen needn't ask: the bars belong to each tab's first screen and leave
 * with it.
 */
export function useHideBars(hidden: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!hidden) return;
      useFrame.setState((s) => ({ hiding: s.hiding + 1 }));
      return () => useFrame.setState((s) => ({ hiding: s.hiding - 1 }));
    }, [hidden]),
  );
}
