import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { VARYS_MARK } from "../shared/mark";

/** varys's mark, in the color of the text around it. */
export function VarysMark({ size, color }: AgentMarkProps) {
  return (
    <View style={{ width: size, height: size, padding: size * 0.12 }}>
      <Svg width="100%" height="100%" viewBox={VARYS_MARK.viewBox}>
        <Path d={VARYS_MARK.path} fill={color} />
      </Svg>
    </View>
  );
}
