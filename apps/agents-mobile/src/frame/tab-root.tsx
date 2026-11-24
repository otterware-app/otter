import { createContext, use, type ReactNode } from "react";
import { View } from "react-native";

import { BottomBar, BAR_HEIGHT } from "./bottom-bar.tsx";
import { useFrame } from "./frame-store.ts";
import type { Tab } from "./tabs.ts";

const BarInset = createContext(0);

/**
 * How much of a tab's first screen the bars cover above the safe area: a list adds it to its
 * bottom inset (`contentInset`, `scrollIndicatorInsets`) so its last row clears them. 0 elsewhere.
 */
export const useBottomBarInset = () => use(BarInset);

/** A tab's first screen, with the bars under it: they leave with it when a screen is pushed. */
export function TabRoot({ tab, children }: { tab: Tab; children: ReactNode }) {
  const hidden = useFrame((s) => s.hiding > 0);
  return (
    <BarInset value={hidden ? 0 : BAR_HEIGHT}>
      <View style={{ flex: 1 }}>
        {children}
        <BottomBar tab={tab} hidden={hidden} />
      </View>
    </BarInset>
  );
}
