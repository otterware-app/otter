import { useState, type ReactNode } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { haptics } from "../haptics.ts";
import { alpha, useTheme } from "../theme.ts";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type SwipeAction = {
  title: string;
  icon: IconName;
  /** Its color once armed: a hex color. */
  tint: string;
  onPerform: () => void;
};

/** How far to pull before letting go runs the action (MailSwipeActions.swift's `MailSwipe`). */
const armedAt = (width: number) => {
  "worklet";
  return Math.min(width * 0.35, 150);
};

/** Black or white, whichever reads on the color (Palette.swift's `contrastingText`). */
function contrasting(hex: string): string {
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

/**
 * Linear's swipe (MailSwipeActions.swift), one action a side: the row follows the finger and
 * rounds off on the side it uncovers, over a grey pill with the action. Past the threshold the
 * pill takes the action's color, with a haptic; let go there and it runs, short of it and the row
 * springs back. Only a horizontal pan starts it, so the list keeps scrolling. `square`: a
 * full-width row, its pill flush with the screen's edge.
 */
export function SwipeRow({
  leading,
  trailing,
  square = false,
  children,
}: {
  leading?: SwipeAction;
  trailing?: SwipeAction;
  square?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const committing = useSharedValue(false);
  const [side, setSide] = useState<"leading" | "trailing" | null>(null);
  const [armed, setArmed] = useState(false);
  const radius = square ? 0 : 28;
  const inset = square ? 0 : 12;
  const hasLeading = Boolean(leading);
  const hasTrailing = Boolean(trailing);

  const perform = (which: "leading" | "trailing") =>
    (which === "leading" ? leading : trailing)?.onPerform();

  useAnimatedReaction(
    () => ({
      side: offset.value > 0 ? "leading" : offset.value < 0 ? "trailing" : null,
      armed: width.value > 0 && Math.abs(offset.value) >= armedAt(width.value),
    }),
    (now, before) => {
      if (now.side !== before?.side) scheduleOnRN(setSide, now.side as typeof side);
      if (now.armed !== before?.armed) {
        scheduleOnRN(setArmed, now.armed);
        if (now.armed && dragging.value) scheduleOnRN(haptics.impact);
      }
    },
  );

  const pan = usePanGesture({
    activeOffsetX: [-10, 10],
    failOffsetY: [-10, 10],
    maxPointers: 1,
    enabled: hasLeading || hasTrailing,
    onActivate: () => {
      "worklet";
      dragging.value = !committing.value;
    },
    onUpdate: (event) => {
      "worklet";
      if (!dragging.value) return;
      const max = hasLeading ? width.value : 0;
      const min = hasTrailing ? -width.value : 0;
      offset.value = Math.min(Math.max(event.translationX, min), max);
    },
    onDeactivate: (event) => {
      "worklet";
      if (!dragging.value) return;
      dragging.value = false;
      const direction = offset.value > 0 ? 1 : -1;
      const commits =
        width.value > 0 &&
        Math.abs(offset.value) >= armedAt(width.value) &&
        event.velocityX * direction > -400;
      if (!commits) {
        offset.value = withSpring(0, { duration: 400, dampingRatio: 0.8 });
        return;
      }
      committing.value = true;
      offset.value = withTiming(direction * width.value, { duration: 220 }, (finished) => {
        if (!finished) return;
        scheduleOnRN(perform, direction > 0 ? "leading" : "trailing");
        offset.value = 0;
        committing.value = false;
      });
    },
  });

  const rowStyle = useAnimatedStyle(() => {
    const edge = Math.min(Math.abs(offset.value), radius);
    const fromLeading = offset.value > 0;
    return {
      transform: [{ translateX: offset.value }],
      borderTopLeftRadius: fromLeading ? edge : 0,
      borderBottomLeftRadius: fromLeading ? edge : 0,
      borderTopRightRadius: offset.value < 0 ? edge : 0,
      borderBottomRightRadius: offset.value < 0 ? edge : 0,
    };
  });

  const action = side === "leading" ? leading : side === "trailing" ? trailing : undefined;
  const fromLeading = side === "leading";
  const foreground = armed && action ? contrasting(action.tint) : theme.colors.mutedForeground;

  return (
    <View
      style={{ overflow: "hidden" }}
      onLayout={(event: LayoutChangeEvent) => {
        width.value = event.nativeEvent.layout.width;
      }}
      accessibilityActions={[leading, trailing].flatMap((a) =>
        a ? [{ name: a.title, label: a.title }] : [],
      )}
      onAccessibilityAction={(event) =>
        [leading, trailing].find((a) => a?.title === event.nativeEvent.actionName)?.onPerform()
      }
    >
      {action ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: fromLeading ? inset : 0,
            right: fromLeading ? 0 : inset,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: fromLeading ? "flex-start" : "flex-end",
            gap: 10,
            paddingHorizontal: 22,
            backgroundColor: armed ? action.tint : alpha(theme.colors.foreground, 0.08),
            borderTopLeftRadius: fromLeading ? radius : 0,
            borderBottomLeftRadius: fromLeading ? radius : 0,
            borderTopRightRadius: fromLeading ? 0 : radius,
            borderBottomRightRadius: fromLeading ? 0 : radius,
          }}
        >
          {fromLeading ? <Icon name={action.icon} tint={foreground} /> : null}
          <Text weight="medium" style={{ color: foreground }} numberOfLines={1}>
            {action.title}
          </Text>
          {fromLeading ? null : <Icon name={action.icon} tint={foreground} />}
        </View>
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[{ overflow: "hidden", backgroundColor: theme.colors.canvas }, rowStyle]}
        >
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
