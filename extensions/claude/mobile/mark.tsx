import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { CLAUDE_MARK } from "../shared/mark";

/** Claude's mark, in its own color. */
export function ClaudeMark({ size }: AgentMarkProps) {
  return (
    <View style={{ width: size, height: size, padding: size * 0.08 }}>
      <Svg width="100%" height="100%" viewBox={CLAUDE_MARK.viewBox} preserveAspectRatio="xMidYMid">
        <Path d={CLAUDE_MARK.path} fill={CLAUDE_MARK.color} />
      </Svg>
    </View>
  );
}
