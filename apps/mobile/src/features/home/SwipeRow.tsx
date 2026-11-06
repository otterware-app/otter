import * as Haptics from "expo-haptics";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, PanResponder, StyleSheet, Text, View, useColorScheme } from "react-native";

import { palette } from "../theme";

export type SwipeAction = { title: string; symbol: SFSymbol; tint: string; perform: () => void };

const ARM = 0.35;

/**
 * apps/ios's MailSwipeActions: the row follows the finger over a grey pill
 * with the action; past the threshold the pill takes the action's color (a
 * tap of haptics) and letting go runs it, short of it the row springs back.
 * One action a side; both also read as accessibility actions.
 */
export function SwipeRow({
  leading,
  trailing,
  children,
}: {
  leading?: SwipeAction;
  trailing?: SwipeAction;
  children: ReactNode;
}) {
  const colors = palette(useColorScheme());
  const x = useRef(new Animated.Value(0)).current;
  const width = useRef(0);
  const [side, setSide] = useState<"leading" | "trailing" | null>(null);
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => {
          const dx = Math.min(
            Math.max(g.dx, trailing ? -width.current : 0),
            leading ? width.current : 0,
          );
          x.setValue(dx);
          setSide(dx > 0 ? "leading" : dx < 0 ? "trailing" : null);
          const nowArmed = Math.abs(dx) > width.current * ARM;
          if (nowArmed !== armedRef.current) {
            armedRef.current = nowArmed;
            setArmed(nowArmed);
            if (nowArmed) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          }
        },
        onPanResponderRelease: (_, g) => {
          const action = g.dx > 0 ? leading : trailing;
          const run = action && (armedRef.current || Math.abs(g.vx) > 1.2);
          armedRef.current = false;
          setArmed(false);
          if (run) {
            Animated.timing(x, {
              toValue: Math.sign(g.dx) * width.current,
              duration: 160,
              useNativeDriver: true,
            }).start(() => {
              action.perform();
              x.setValue(0);
              setSide(null);
            });
          } else {
            Animated.spring(x, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start(() =>
              setSide(null),
            );
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(x, { toValue: 0, useNativeDriver: true }).start(() => setSide(null));
        },
      }),
    [leading, trailing, x],
  );

  const action = side === "leading" ? leading : side === "trailing" ? trailing : undefined;
  const actions = [leading, trailing].filter((a): a is SwipeAction => Boolean(a));

  return (
    <View
      onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
      accessibilityActions={actions.map((a) => ({ name: a.title, label: a.title }))}
      onAccessibilityAction={(e) =>
        actions.find((a) => a.title === e.nativeEvent.actionName)?.perform()
      }
    >
      {action ? (
        <View
          style={[
            StyleSheet.absoluteFill,
            styles.pill,
            {
              backgroundColor: armed ? action.tint : colors.pill,
              alignItems: side === "leading" ? "flex-start" : "flex-end",
            },
          ]}
        >
          <View style={styles.label}>
            <SymbolView name={action.symbol} tintColor="#FFFFFF" size={20} />
            <Text style={styles.title}>{action.title}</Text>
          </View>
        </View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX: x }] }} {...responder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { justifyContent: "center", paddingHorizontal: 24, marginHorizontal: 12, borderRadius: 28 },
  label: { alignItems: "center", gap: 2 },
  title: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
});
