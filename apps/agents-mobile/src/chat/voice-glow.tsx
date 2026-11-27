import { useTheme } from "@otter/ui-native/theme";
import { useEffect } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from "react-native-svg";

/** The display's rounded corners, which the rim light follows. */
const DISPLAY_RADIUS = 54;
/**
 * The rim light, a blur drawn as strokes along the display's edge, each wider and fainter: half
 * of each falls off the screen, the rest glows inward.
 */
const RIM = [
  { width: 2, opacity: 0.45 },
  { width: 10, opacity: 0.22 },
  { width: 26, opacity: 0.12 },
  { width: 56, opacity: 0.07 },
  { width: 110, opacity: 0.04 },
];
/** Who is talking, told apart at a glance: the agent's light leans warm, yours cool. */
const AGENT_ORANGE = { light: "#e0622a", dark: "#f0874a" } as const;
export const YOUR_BLUE = { light: "#0a8fce", dark: "#1aa3dc" } as const;
/** Below this a meter hears the room, not a voice. */
const QUIET = 0.05;

/**
 * How present a speaker's light is, from their voice's level: it comes up as they speak and lets
 * go slowly, so it holds steady between words rather than flickering with each syllable.
 */
export function useGlow(level: SharedValue<number>): SharedValue<number> {
  const glow = useSharedValue(0);
  useAnimatedReaction(
    () => level.get(),
    (value) => {
      const target = value < QUIET ? 0 : Math.min(1, 0.6 + (value - QUIET) * 1.2);
      const rising = target > glow.get();
      glow.set(
        withTiming(target, { duration: rising ? 240 : 900, easing: Easing.inOut(Easing.quad) }),
      );
    },
  );
  return glow;
}

function rimPath(width: number, height: number, r: number): string {
  return [
    `M ${r} 0 H ${width - r}`,
    `A ${r} ${r} 0 0 1 ${width} ${r} V ${height - r}`,
    `A ${r} ${r} 0 0 1 ${width - r} ${height} H ${r}`,
    `A ${r} ${r} 0 0 1 0 ${height - r} V ${r}`,
    `A ${r} ${r} 0 0 1 ${r} 0 Z`,
  ].join(" ");
}

/**
 * The light of a call, as Claude's voice mode shows who is talking: the agent's orange along the
 * display's edges, strongest in its foot's corners, as it speaks, breathing there softly while it
 * works; your blue rising from the middle of the foot as you do.
 */
export function VoiceGlow({
  agent,
  you,
  working,
}: {
  agent: SharedValue<number>;
  you: SharedValue<number>;
  working: boolean;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { scheme } = useTheme();
  const orange = AGENT_ORANGE[scheme];
  const blue = YOUR_BLUE[scheme];
  // Phones with a home indicator have rounded displays; the others are square.
  const radius = insets.bottom > 0 ? DISPLAY_RADIUS : 0;
  const hazeHeight = height * 0.42;

  const busy = useSharedValue(0);
  const breath = useSharedValue(0);
  useEffect(() => {
    busy.set(withTiming(working ? 1 : 0, { duration: working ? 500 : 350 }));
  }, [working, busy]);
  useEffect(() => {
    breath.set(
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
  }, [breath]);
  const rim = useAnimatedStyle(() => ({
    opacity: Math.max(
      interpolate(agent.get(), [0, 0.6, 1], [0, 0.85, 1]),
      busy.get() * (0.2 + breath.get() * 0.25),
    ),
  }));
  const haze = useAnimatedStyle(() => ({ opacity: you.get() }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.haze, { height: hazeHeight }, haze]}>
        <Svg width={width} height={hazeHeight}>
          <Defs>
            <RadialGradient
              id="haze"
              cx={width / 2}
              cy={hazeHeight}
              rx={width * 0.62}
              ry={hazeHeight}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={blue} stopOpacity={scheme === "dark" ? 0.5 : 0.32} />
              <Stop offset="0.45" stopColor={blue} stopOpacity={0.12} />
              <Stop offset="1" stopColor={blue} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect width={width} height={hazeHeight} fill="url(#haze)" />
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, rim]}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="rim" x1="0" y1="1" x2="0" y2="0">
              {/* Brightest in the foot's corners, gone by the middle of the sides. */}
              <Stop offset="0" stopColor={orange} stopOpacity={1} />
              <Stop offset="0.12" stopColor={orange} stopOpacity={0.75} />
              <Stop offset="0.35" stopColor={orange} stopOpacity={0.2} />
              <Stop offset="0.55" stopColor={orange} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          {RIM.map((stroke) => (
            <Path
              key={stroke.width}
              d={rimPath(width, height, radius)}
              fill="none"
              stroke="url(#rim)"
              strokeWidth={stroke.width}
              strokeOpacity={stroke.opacity}
            />
          ))}
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  haze: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
