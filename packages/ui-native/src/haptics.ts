import * as Haptics from "expo-haptics";

/** apps/ios-agents's `Haptics`: a selection tick, a success, and a medium impact. */
export const haptics = {
  tap: () => void Haptics.selectionAsync(),
  done: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  impact: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
};
