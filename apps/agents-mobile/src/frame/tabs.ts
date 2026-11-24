import type { IconName } from "@otter/ui-native/components/icon";
import { useSegments, type Href } from "expo-router";

export type Tab = "chats" | "scheduled" | "settings";

export const TABS: readonly { id: Tab; name: string; icon: IconName; href: Href }[] = [
  { id: "chats", name: "Chats", icon: "bubble.left.and.bubble.right.fill", href: "/" },
  { id: "scheduled", name: "Scheduled", icon: "clock.fill", href: "/scheduled" },
  { id: "settings", name: "Settings", icon: "gearshape.fill", href: "/settings" },
];

/** The tab in front: its group is the route's second segment, `(tabs)/(chats)/…`. */
export function useCurrentTab(): Tab {
  const group = useSegments()[1];
  return TABS.find((t) => group === `(${t.id})`)?.id ?? "chats";
}
