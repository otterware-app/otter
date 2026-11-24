import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { OPENAI_MARK } from "../shared/mark";

/** OpenAI's mark, in the color of the text around it. */
export function CodexMark({ size, color }: AgentMarkProps) {
  return (
    <View style={{ width: size, height: size, padding: size * 0.08 }}>
      <Svg width="100%" height="100%" viewBox={OPENAI_MARK.viewBox} preserveAspectRatio="xMidYMid">
        <Path d={OPENAI_MARK.path} fill={color} />
      </Svg>
    </View>
  );
}
