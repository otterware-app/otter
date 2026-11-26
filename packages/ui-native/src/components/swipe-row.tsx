import { useState, type ReactNode } from "react";
import { Pressable, View, type LayoutChangeEvent } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, {
  type SharedValue,
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

/** How far to pull before letting go runs the action. */
const armedAt = (width: number) => {
  "worklet";
  return Math.min(width * 0.35, 150);
};

/** How wide each of several actions is once they're showing, as a List's swipe buttons. */
const BUTTON_WIDTH = 74;

/** Black or white, whichever reads on the color. */
function contrasting(hex: string): string {
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

const listOf = (actions: SwipeAction | SwipeAction[] | undefined) =>
  actions === undefined ? [] : Array.isArray(actions) ? actions : [actions];

/** Where the row whose actions are showing is: another one opening closes it, as a List does. */
let openRow: SharedValue<number> | null = null;

const settle = (at: SharedValue<number>, to = 0) => {
  "worklet";
  at.set(withSpring(to, { duration: 400, dampingRatio: 0.8 }));
};

/**
 * Linear's swipe: the row follows the finger and rounds off on the side
 * it uncovers, over a grey pill with the action. Past the threshold the pill takes the action's
 * color, with a haptic; let go there and it runs, short of it and the row springs back. Only a
 * horizontal pan starts it, so the list keeps scrolling. `square`: a full-width row, its pill
 * flush with the screen's edge.
 *
 * Several actions a side (an array) are SwiftUI's `swipeActions`: let go partway and the row stays
 * open on its buttons, in their colors, the first at the edge; pull on past them and the first
 * runs, as `allowsFullSwipe`.
 */
export function SwipeRow({
  leading,
  trailing,
  square = false,
  children,
}: {
  leading?: SwipeAction | SwipeAction[];
  trailing?: SwipeAction | SwipeAction[];
  square?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const width = useSharedValue(0);
  const offset = useSharedValue(0);
  const start = useSharedValue(0);
  const dragging = useSharedValue(false);
  const committing = useSharedValue(false);
  const [side, setSide] = useState<"leading" | "trailing" | null>(null);
  const [armed, setArmed] = useState(false);
  const [opened, setOpened] = useState(false);
  const leadingActions = listOf(leading);
  const trailingActions = listOf(trailing);
  const radius = square ? 0 : 28;
  const inset = square ? 0 : 12;
  const hasLeading = leadingActions.length > 0;
  const hasTrailing = trailingActions.length > 0;
  /** How far the row opens on each side's buttons: 0 for one action, which only runs. */
  const leadingOpen = leadingActions.length > 1 ? leadingActions.length * BUTTON_WIDTH : 0;
  const trailingOpen = trailingActions.length > 1 ? trailingActions.length * BUTTON_WIDTH : 0;

  const perform = (which: "leading" | "trailing") =>
    (which === "leading" ? leadingActions : trailingActions)[0]?.onPerform();

  const close = () => settle(offset);
  const markOpened = (open: boolean) => {
    setOpened(open);
    if (open) {
      if (openRow && openRow !== offset) settle(openRow);
      openRow = offset;
    } else if (openRow === offset) openRow = null;
  };

  /** Where letting go runs the first action: past the buttons, when there are some. */
  const fullAt = (opens: number) => {
    "worklet";
    return opens > 0 ? Math.max(armedAt(width.get()), opens + 48) : armedAt(width.get());
  };

  useAnimatedReaction(
    () => {
      const at = offset.get();
      const opens = at > 0 ? leadingOpen : trailingOpen;
      return {
        side: at > 0 ? "leading" : at < 0 ? "trailing" : null,
        armed: width.get() > 0 && at !== 0 && Math.abs(at) >= fullAt(opens),
        opened: at !== 0,
      };
    },
    (now, before) => {
      if (now.side !== before?.side) scheduleOnRN(setSide, now.side as typeof side);
      if (now.opened !== before?.opened) scheduleOnRN(markOpened, now.opened);
      if (now.armed !== before?.armed) {
        scheduleOnRN(setArmed, now.armed);
        if (now.armed && dragging.get()) scheduleOnRN(haptics.impact);
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
      dragging.set(!committing.get());
      start.set(offset.get());
    },
    onUpdate: (event) => {
      "worklet";
      if (!dragging.get()) return;
      const max = hasLeading ? width.get() : 0;
      const min = hasTrailing ? -width.get() : 0;
      offset.set(Math.min(Math.max(start.get() + event.translationX, min), max));
    },
    onDeactivate: (event) => {
      "worklet";
      if (!dragging.get()) return;
      dragging.set(false);
      const direction = offset.get() > 0 ? 1 : -1;
      const opens = direction > 0 ? leadingOpen : trailingOpen;
      const pulled = Math.abs(offset.get());
      const outward = event.velocityX * direction;
      const commits = width.get() > 0 && pulled >= fullAt(opens) && outward > -400;
      if (!commits) {
        const stays = opens > 0 && pulled >= opens / 2 && outward > -400;
        settle(offset, stays ? direction * opens : 0);
        return;
      }
      committing.set(true);
      offset.set(
        withTiming(direction * width.get(), { duration: 220 }, (finished) => {
          if (!finished) return;
          scheduleOnRN(perform, direction > 0 ? "leading" : "trailing");
          offset.set(0);
          committing.set(false);
        }),
      );
    },
  });

  const rowStyle = useAnimatedStyle(() => {
    const edge = Math.min(Math.abs(offset.get()), radius);
    const fromLeading = offset.get() > 0;
    return {
      transform: [{ translateX: offset.get() }],
      borderTopLeftRadius: fromLeading ? edge : 0,
      borderBottomLeftRadius: fromLeading ? edge : 0,
      borderTopRightRadius: offset.get() < 0 ? edge : 0,
      borderBottomRightRadius: offset.get() < 0 ? edge : 0,
    };
  });
  const uncovered = useAnimatedStyle(() => ({ width: Math.abs(offset.get()) }));

  const actions = side === "leading" ? leadingActions : side === "trailing" ? trailingActions : [];
  const action = actions[0];
  const fromLeading = side === "leading";
  const foreground = armed && action ? contrasting(action.tint) : theme.colors.mutedForeground;
  const all = [...leadingActions, ...trailingActions];

  return (
    <View
      style={{ overflow: "hidden" }}
      onLayout={(event: LayoutChangeEvent) => {
        width.set(event.nativeEvent.layout.width);
      }}
      accessibilityActions={all.map((a) => ({ name: a.title, label: a.title }))}
      onAccessibilityAction={(event) =>
        all.find((a) => a.title === event.nativeEvent.actionName)?.onPerform()
      }
    >
      {actions.length > 1 ? (
        <Animated.View
          style={[
            {
              position: "absolute",
              top: 0,
              bottom: 0,
              [fromLeading ? "left" : "right"]: 0,
              flexDirection: fromLeading ? "row" : "row-reverse",
            },
            uncovered,
          ]}
        >
          {(armed ? actions.slice(0, 1) : actions).map((a) => (
            <Pressable
              key={a.title}
              accessibilityRole="button"
              onPress={() => {
                close();
                a.onPerform();
              }}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                overflow: "hidden",
                backgroundColor: a.tint,
              }}
            >
              <Icon name={a.icon} size={18} tint={contrasting(a.tint)} />
              <Text
                size="xs"
                weight="medium"
                style={{ color: contrasting(a.tint) }}
                numberOfLines={1}
              >
                {a.title}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : action ? (
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
          {opened ? (
            <Pressable
              onPress={close}
              accessibilityElementsHidden
              style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
