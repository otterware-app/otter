import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import { GestureDetector, GestureStateManager, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { haptics } from "../haptics.ts";
import { alpha, useTheme } from "../theme.ts";
import { Icon } from "./icon.tsx";

const THRESHOLD = 60;
/** From the screen's edge a swipe goes back: it would quote the message it passes instead. */
const EDGE = 24;

/**
 * Drag a message to the right to reply to it, as in WhatsApp (Design.swift's `SwipeToReply`): it
 * follows the finger, an arrow comes in behind it, and letting go past the arrow quotes it. Only a
 * rightward pan starts it, so the list still scrolls and text still selects.
 */
export function SwipeToReply({
  onReply,
  style,
  children,
}: {
  /** Absent: the message only reads. */
  onReply?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const theme = useTheme();
  const offset = useSharedValue(0);
  const armed = useSharedValue(false);

  const reply = () => onReply?.();
  const pan = usePanGesture({
    enabled: Boolean(onReply),
    activeOffsetX: 12,
    failOffsetX: [-6, 10000],
    failOffsetY: [-10, 10],
    maxPointers: 1,
    onTouchesDown: (event) => {
      "worklet";
      if (event.numberOfTouches > 1 || event.changedTouches[0]?.absoluteX < EDGE)
        GestureStateManager.fail(event.handlerTag);
    },
    onActivate: () => {
      "worklet";
      cancelAnimation(offset);
      armed.set(false);
    },
    onUpdate: (event) => {
      "worklet";
      const x = event.translationX;
      offset.set(x <= 0 ? 0 : x < 80 ? x : 80 + (x - 80) * 0.2);
      const now = x >= THRESHOLD;
      if (now && !armed.get()) scheduleOnRN(haptics.impact);
      armed.set(now);
    },
    onDeactivate: (event) => {
      "worklet";
      if (!event.canceled && event.translationX >= THRESHOLD) scheduleOnRN(reply);
      armed.set(false);
      offset.set(withSpring(0, { duration: 300, dampingRatio: 0.8 }));
    },
  });

  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  const arrow = useAnimatedStyle(() => {
    const at = offset.get();
    const shown = Math.min(1, at / THRESHOLD);
    return {
      opacity: shown,
      transform: [
        { translateX: Math.min(at, THRESHOLD) - 38 },
        { scale: armed.get() ? 1.1 : 0.4 + 0.6 * shown },
      ],
    };
  });

  if (!onReply) return children;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={style}
        accessibilityActions={[{ name: "reply", label: "Reply" }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "reply") reply();
        }}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              left: 0,
              top: "50%",
              marginTop: -15,
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: alpha(theme.colors.foreground, 0.12),
            },
            arrow,
          ]}
        >
          <Icon name="arrowshape.turn.up.left.fill" size={13} weight="semibold" />
        </Animated.View>
        <Animated.View style={moved}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
