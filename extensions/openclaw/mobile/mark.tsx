import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";

// The same drawing as ../ui/icon.tsx's: unify the two once the halves can share a file.
const BODY = "openclaw-lobster";
const LEFT_CLAW =
  "M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z";
const RIGHT_CLAW = "M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z";

/** OpenClaw's lobster. */
export function OpenClawMark({ size }: AgentMarkProps) {
  return (
    <View style={{ width: size, height: size, padding: size * 0.06 }}>
      <Svg width="100%" height="100%" viewBox="0 0 120 120" fill="none">
        <Defs>
          <LinearGradient id="lobster" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor="#ff4d4d" />
            <Stop offset="100%" stopColor="#991b1b" />
          </LinearGradient>
        </Defs>
        <Path d={BODY} fill="url(#lobster)" />
        <Path d={LEFT_CLAW} fill="url(#lobster)" />
        <Path d={RIGHT_CLAW} fill="url(#lobster)" />
        <Path
          d={"M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"}
          stroke="#ff4d4d"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Path d={"M45 15 Q35 5 30 8"} stroke="#ff4d4d" strokeWidth={3} strokeLinecap="round" />
        <Circle cx={45} cy={35} r={6} fill="#050810" />
        <Circle cx={75} cy={35} r={6} fill="#050810" />
        <Circle cx={46} cy={34} r={2.5} fill="#00e5cc" />
        <Circle cx={76} cy={34} r={2.5} fill="#00e5cc" />
      </Svg>
    </View>
  );
}
