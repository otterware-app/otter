import {
  Animation,
  background,
  glassEffect,
  glassEffectId,
  matchedGeometryEffect,
  shadow,
  shapes,
  type ModifierConfig,
} from "@expo/ui/swift-ui/modifiers";
import { isGlassEffectAPIAvailable } from "expo-glass-effect";
import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** Whether this iOS draws Liquid Glass at all (as Otter Code's NATIVE_LIQUID_GLASS_SUPPORTED). */
export const GLASS_AVAILABLE = isGlassEffectAPIAvailable();

function useAccessibilitySetting(
  read: () => Promise<boolean>,
  event: "reduceMotionChanged" | "reduceTransparencyChanged",
): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let live = true;
    void read().then((value) => live && setEnabled(value));
    const subscription = AccessibilityInfo.addEventListener(event, setEnabled);
    return () => {
      live = false;
      subscription.remove();
    };
  }, [read, event]);
  return enabled;
}

export const useReduceMotion = () =>
  useAccessibilitySetting(AccessibilityInfo.isReduceMotionEnabled, "reduceMotionChanged");

export const useReduceTransparency = () =>
  useAccessibilitySetting(
    AccessibilityInfo.isReduceTransparencyEnabled,
    "reduceTransparencyChanged",
  );

/** The Swift app's menu spring; none with Reduce Motion. */
export const glassSpring = (reduceMotion: boolean) =>
  reduceMotion ? null : Animation.spring({ duration: 0.4, bounce: 0.15 });

type GlassShape =
  | { shape: "capsule" | "circle" }
  | { shape: "roundedRectangle"; cornerRadius: number };

/**
 * A surface of the glass container: Liquid Glass sharing `id` (so it morphs
 * into whatever takes the id next), or, without glass (an older iOS, Reduce
 * Transparency), an opaque fill whose frame morphs by matched geometry.
 */
export function glassSurface(
  shape: GlassShape,
  id: string,
  namespace: string,
  options: { interactive?: boolean; solid: boolean; fill: string },
): ModifierConfig[] {
  if (GLASS_AVAILABLE && !options.solid) {
    return [
      glassEffect({
        glass: { variant: "regular", interactive: options.interactive },
        ...shape,
      }),
      glassEffectId(id, namespace),
    ];
  }
  const fill =
    shape.shape === "roundedRectangle"
      ? shapes.roundedRectangle({ cornerRadius: shape.cornerRadius })
      : shape.shape === "circle"
        ? shapes.circle()
        : shapes.capsule();
  return [
    background(options.fill, fill),
    // Lifted off the content it covers, as glass would be.
    shadow({ radius: 12, y: 4, color: "#00000026" }),
    matchedGeometryEffect(id, namespace),
  ];
}
