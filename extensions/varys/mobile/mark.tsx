import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

// The same drawing as ../ui/icon.tsx's: unify the two once the halves can share a file.
const D =
  "M0 -563L135 -563L175 -395L509 -395L489 -345L193 -345L240 -147L335 -307L392 -307L225 0L135 0ZM475 -565L535 -565L469 -440L410 -440Z";

/** varys's mark (packages/brand in varys), in the color of the text around it. */
export function VarysMark({ size, color }: AgentMarkProps) {
  return (
    <View style={{ width: size, height: size, padding: size * 0.12 }}>
      <Svg width="100%" height="100%" viewBox="-15 -565 565 565">
        <Path d={D} fill={color} />
      </Svg>
    </View>
  );
}
