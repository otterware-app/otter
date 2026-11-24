import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

function useSetting(
  read: () => Promise<boolean>,
  event: "reduceMotionChanged" | "reduceTransparencyChanged",
): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void read().then((value) => alive && setOn(value));
    const subscription = AccessibilityInfo.addEventListener(event, setOn);
    return () => {
      alive = false;
      subscription.remove();
    };
  }, [read, event]);
  return on;
}

/** Settings › Accessibility › Motion › Reduce Motion. */
export const useReduceMotion = () =>
  useSetting(AccessibilityInfo.isReduceMotionEnabled, "reduceMotionChanged");

/** Settings › Accessibility › Display & Text Size › Reduce Transparency: glass draws solid. */
export const useReduceTransparency = () =>
  useSetting(AccessibilityInfo.isReduceTransparencyEnabled, "reduceTransparencyChanged");
