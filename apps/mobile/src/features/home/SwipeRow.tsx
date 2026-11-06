import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, PanResponder, StyleSheet, Text, View } from "react-native";

import { usePalette } from "../theme";

export type SwipeAction = { title: string; symbol: SFSymbol; tint: string; perform: () => void };

/** apps/ios's MailSwipe: how far to pull before letting go runs the action. */
const armed = (offset: number, width: number) =>
  width > 0 && Math.abs(offset) >= Math.min(width * 0.35, 150);

/** Armed, and not flung back toward where it started (vx is points per millisecond). */
const commits = (offset: number, vx: number, width: number) =>
  armed(offset, width) && vx * Math.sign(offset) > -0.4;

const NO_ACTIONS: readonly { title: string; perform: () => void }[] = [];

let reduceMotion = false;
void AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on));
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

/**
 * apps/ios's MailSwipeActions (Linear's swipe): the row follows the finger
 * over a grey pill with the action; past the threshold the pill takes the
 * action's color, with a tap of haptics, and letting go runs it; short of it
 * the row springs back. One action a side; both are accessibility actions too.
 */
export function SwipeRow({
  leading,
  trailing,
  actions = NO_ACTIONS,
  square = false,
  children,
}: {
  leading?: SwipeAction;
  trailing?: SwipeAction;
  /** More accessibility actions (VoiceOver's rotor), after the swipes'. */
  actions?: readonly { title: string; perform: () => void }[];
  /** Full-width rows: the row and its pill stay square, the pill flush with the screen's edge. */
  square?: boolean;
  children: ReactNode;
}) {
  const colors = usePalette();
  const [x] = useState(() => new Animated.Value(0));
  const width = useRef(0);
  const [side, setSide] = useState<"leading" | "trailing" | null>(null);
  const [isArmed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const offset = useRef(0);

  const responder = useMemo(() => {
    const settle = () => {
      armedRef.current = false;
      setArmed(false);
      const done = () => setSide(null);
      if (reduceMotion) {
        x.setValue(0);
        done();
      } else {
        Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(done);
      }
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Boolean(leading || trailing) &&
        Math.abs(g.dx) > 10 &&
        Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => {
        const dx = Math.min(
          Math.max(g.dx, trailing ? -width.current : 0),
          leading ? width.current : 0,
        );
        offset.current = dx;
        x.setValue(dx);
        setSide(dx > 0 ? "leading" : dx < 0 ? "trailing" : null);
        const now = armed(dx, width.current);
        if (now !== armedRef.current) {
          armedRef.current = now;
          setArmed(now);
          if (now) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }
      },
      onPanResponderRelease: (_, g) => {
        const action = offset.current > 0 ? leading : trailing;
        if (!action || !commits(offset.current, g.vx, width.current)) return settle();
        const finish = () => {
          action.perform();
          x.setValue(0);
          setSide(null);
          armedRef.current = false;
          setArmed(false);
        };
        if (reduceMotion) return finish();
        Animated.timing(x, {
          toValue: Math.sign(offset.current) * width.current,
          duration: 220,
          useNativeDriver: true,
        }).start(finish);
      },
      onPanResponderTerminate: settle,
    });
  }, [leading, trailing, x]);

  const action = side === "leading" ? leading : side === "trailing" ? trailing : undefined;
  const all = [...[leading, trailing].filter((a): a is SwipeAction => Boolean(a)), ...actions];
  const fromLeading = side === "leading";

  return (
    <View
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      accessibilityActions={all.map((a) => ({ name: a.title, label: a.title }))}
      onAccessibilityAction={(e) =>
        all.find((a) => a.title === e.nativeEvent.actionName)?.perform()
      }
      style={styles.clip}
    >
      {action ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.pill,
            fromLeading ? styles.fromLeading : styles.fromTrailing,
            square && styles.square,
            { backgroundColor: isArmed ? action.tint : colors.pill },
          ]}
        >
          <View style={[styles.label, !fromLeading && styles.reversed]}>
            <SymbolView
              name={action.symbol}
              size={17}
              tintColor={isArmed ? "#FFFFFF" : colors.secondary}
            />
            <Text style={[styles.title, { color: isArmed ? "#FFFFFF" : colors.secondary }]}>
              {action.title}
            </Text>
          </View>
        </View>
      ) : null}
      <Animated.View
        style={{
          transform: [{ translateX: x }],
          backgroundColor: action ? colors.canvas : undefined,
          borderRadius: action && !square ? 28 : 0,
        }}
        {...responder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  pill: { justifyContent: "center", paddingHorizontal: 22 },
  fromLeading: {
    marginLeft: 12,
    borderTopLeftRadius: 28,
    borderBottomLeftRadius: 28,
    alignItems: "flex-start",
  },
  fromTrailing: {
    marginRight: 12,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    alignItems: "flex-end",
  },
  square: { margin: 0, borderRadius: 0 },
  label: { flexDirection: "row", alignItems: "center", gap: 10 },
  reversed: { flexDirection: "row-reverse" },
  title: { fontSize: 17, fontWeight: "500" },
});
