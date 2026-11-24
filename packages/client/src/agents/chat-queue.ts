import { useSyncExternalStore } from "react";
import {
  getSyncedPreference,
  onSyncedPreferenceChange,
  setSyncedPreference,
} from "../preferences.ts";
import type { QueuedMessage } from "./chat-store.ts";

/** What a message sent while a turn runs does: waits for it to end, or joins it. */
export type FollowUpBehavior = "queue" | "steer";

const FOLLOW_UP_KEY = "assistant:follow-up-behavior";

export function getFollowUpBehavior(): FollowUpBehavior {
  return getSyncedPreference(FOLLOW_UP_KEY) === "steer" ? "steer" : "queue";
}

export function setFollowUpBehavior(value: FollowUpBehavior): void {
  setSyncedPreference(FOLLOW_UP_KEY, value);
}

const subscribe = (listener: () => void) =>
  onSyncedPreferenceChange((key) => key === FOLLOW_UP_KEY && listener());

export function useFollowUpBehavior(): FollowUpBehavior {
  return useSyncExternalStore(subscribe, getFollowUpBehavior);
}

/** A queued message as it reads: its skill's command, then what you wrote. */
export const queuedText = (item: QueuedMessage) =>
  `${item.skill ? `/${item.skill.name} ` : ""}${item.question}`.trim();

const QUEUE_VISIBLE_ROWS = 3;

/** The queued messages shown: all of a short queue; of a long one, the first two until it's opened. */
export function visibleQueue(items: QueuedMessage[], showAll: boolean) {
  const collapsible = items.length > QUEUE_VISIBLE_ROWS;
  return {
    collapsible,
    visible: collapsible && !showAll ? items.slice(0, QUEUE_VISIBLE_ROWS - 1) : items,
  };
}
