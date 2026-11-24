import type { AgentMarkProps } from "@otter/mobile/extension-kit";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

// Otterware's agent, the Pilot (assets/agent/otter-agent-symbol.svg; apps/web's AgentIcon).
const PILOT =
  "M255 347C386 288 566 205 747 167C801 156 824 176 809 230C764 398 681 583 624 754C609 799 584 827 554 811C523 795 497 711 471 637C451 579 427 557 370 535C300 508 219 486 207 453C195 418 217 372 255 347Z M384 445C438 463 484 487 520 524C553 559 577 607 592 650C626 530 678 408 732 291C614 346 498 395 384 445Z";

/** Otter's mark, for an agent with no picture and no kind's. */
export function OtterMark({ size, color }: AgentMarkProps) {
  return (
    <View style={{ width: size, height: size, padding: size * 0.04 }}>
      <Svg width="100%" height="100%" viewBox="94 77 832 832">
        <Path d={PILOT} fill={color} fillRule="evenodd" />
      </Svg>
    </View>
  );
}
