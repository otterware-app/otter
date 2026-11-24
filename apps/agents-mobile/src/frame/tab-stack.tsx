import { Stack } from "expo-router";

import { useStackOptions } from "./stack-options.ts";

/** A tab's own stack: its first screen with the bars, and what it pushes over them. */
export function TabStack() {
  return <Stack screenOptions={useStackOptions()} />;
}
