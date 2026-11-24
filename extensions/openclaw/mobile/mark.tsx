import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

import { LOBSTER } from "../shared/mark";

/** OpenClaw's lobster. */
export function OpenClawMark({ size }: AgentMarkProps) {
  const [from, to] = LOBSTER.gradient;
  return (
    <View style={{ width: size, height: size, padding: size * 0.06 }}>
      <Svg width="100%" height="100%" viewBox={LOBSTER.viewBox} fill="none">
        <Defs>
          <LinearGradient id="lobster" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={from} />
            <Stop offset="100%" stopColor={to} />
          </LinearGradient>
        </Defs>
        {LOBSTER.filled.map((d) => (
          <Path key={d} d={d} fill="url(#lobster)" />
        ))}
        {LOBSTER.antennae.map((d) => (
          <Path key={d} d={d} stroke={from} strokeWidth={3} strokeLinecap="round" />
        ))}
        {LOBSTER.eyes.map((eye) => (
          <Circle key={`${eye.cx}-${eye.r}`} {...eye} />
        ))}
      </Svg>
    </View>
  );
}
