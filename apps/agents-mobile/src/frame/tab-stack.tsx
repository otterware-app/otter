import { Stack } from "expo-router";
import type { ComponentProps } from "react";

import { presents } from "./navigation.ts";
import { useStackOptions, type ScreenOptions } from "./stack-options.ts";
import { TabRoot } from "./tab-root.tsx";
import type { Tab } from "./tabs.ts";

type ScreenLayout = NonNullable<ComponentProps<typeof Stack>["screenLayout"]>;
const noPresentedScreens: Record<string, ScreenOptions> = {};

/** Puts the bars over the stack's first screen, `root`, and nothing over the rest. */
const barsOver =
  (tab: Tab, root: string): ScreenLayout =>
  ({ route, children }) =>
    route.name === root ? <TabRoot tab={tab}>{children}</TabRoot> : children;

/**
 * A tab's own stack: its first screen with the bars over it, and what it pushes and presents
 * over them. `presented`: the routes that present rather than push (a sheet, a cover), with how;
 * a link or a chat opening elsewhere closes them first (`closeSheets`).
 */
export function TabStack({
  tab,
  root,
  presented = noPresentedScreens,
}: {
  tab: Tab;
  root: string;
  presented?: Record<string, ScreenOptions>;
}) {
  presents(Object.keys(presented));
  return (
    <Stack screenOptions={useStackOptions()} screenLayout={barsOver(tab, root)}>
      {Object.entries(presented).map(([name, options]) => (
        <Stack.Screen key={name} name={name} options={options} />
      ))}
    </Stack>
  );
}
