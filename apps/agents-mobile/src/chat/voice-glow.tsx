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
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";

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
const AGENT_VIOLET = { light: "#a131d4", dark: "#c04ee8" } as const;
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
 * The light of a call, as Claude's voice mode shows who is talking: the agent's violet along the
 * display's edge, strongest at its foot, as it speaks; a blue haze rising from the foot as you do;
 * a soft glow in the middle while the agent works.
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
  const violet = AGENT_VIOLET[scheme];
  const blue = YOUR_BLUE[scheme];
  // Phones with a home indicator have rounded displays; the others are square.
  const radius = insets.bottom > 0 ? DISPLAY_RADIUS : 0;
  const hazeHeight = height * 0.42;

  const rim = useAnimatedStyle(() => ({
    opacity: interpolate(agent.get(), [0, 0.6, 1], [0, 0.85, 1]),
  }));
  const haze = useAnimatedStyle(() => ({ opacity: you.get() }));

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <WorkingGlow shown={working} color={violet} />
      <Animated.View style={[styles.haze, { height: hazeHeight }, haze]}>
        <Svg width={width} height={hazeHeight}>
          <Defs>
            <RadialGradient
              id="haze"
              cx={width / 2}
              cy={hazeHeight}
              rx={width}
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
              <Stop offset="0" stopColor={violet} stopOpacity={1} />
              <Stop offset="0.12" stopColor={violet} stopOpacity={0.75} />
              <Stop offset="0.35" stopColor={violet} stopOpacity={0.2} />
              <Stop offset="0.55" stopColor={violet} stopOpacity={0} />
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

const WORKING_SIZE = 300;

/** A soft, breathing light in the middle while the agent works, as Claude's thinks. */
function WorkingGlow({ shown, color }: { shown: boolean; color: string }) {
  const presence = useSharedValue(0);
  const breath = useSharedValue(0);
  useEffect(() => {
    presence.set(withTiming(shown ? 1 : 0, { duration: shown ? 500 : 350 }));
  }, [shown, presence]);
  useEffect(() => {
    breath.set(
      withRepeat(withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
  }, [breath]);
  const style = useAnimatedStyle(() => ({
    opacity: presence.get() * (0.55 + breath.get() * 0.45),
    transform: [{ scale: 0.88 + breath.get() * 0.14 }],
  }));
  return (
    <View style={styles.middle}>
      <Animated.View style={style}>
        <Svg width={WORKING_SIZE} height={WORKING_SIZE}>
          <Defs>
            <RadialGradient id="working" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity={0.32} />
              <Stop offset="0.5" stopColor={color} stopOpacity={0.12} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle
            cx={WORKING_SIZE / 2}
            cy={WORKING_SIZE / 2}
            r={WORKING_SIZE / 2}
            fill="url(#working)"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  haze: { position: "absolute", left: 0, right: 0, bottom: 0 },
  middle: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" },
});
