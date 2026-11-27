import { View, type ViewProps } from "react-native";

import { useTheme, type Theme } from "../theme.ts";

/**
 * A chat's two greys: the agent's, for what sits on its side (its folds, chips, a failure), and
 * yours, the bubble your messages are in, a shade off the canvas as in Claude's app.
 */
const colors = {
  light: { incoming: "#e6e6e6", outgoing: "#ededed" },
  dark: { incoming: "#242426", outgoing: "#2c2c2e" },
};

export const bubbleColors = (theme: Theme) => colors[theme.scheme];

export type BubbleProps = ViewProps & {
  /** Whose: the agent's on the leading side, yours on the trailing. */
  side: "leading" | "trailing";
  /** Messages just before and after it from the same side: the corners where they meet are tight. */
  joinsAbove?: boolean;
  joinsBelow?: boolean;
};

/** A message's bubble: round, but tight on its side where it meets the one above or below, as T3 Code groups them. */
export function Bubble({ side, joinsAbove, joinsBelow, style, ...props }: BubbleProps) {
  const theme = useTheme();
  const round = 18;
  const tight = 5;
  const top = joinsAbove ? tight : round;
  const bottom = joinsBelow ? tight : round;
  const leading = side === "leading";
  return (
    <View
      style={[
        {
          backgroundColor: bubbleColors(theme)[leading ? "incoming" : "outgoing"],
          borderCurve: "continuous",
          borderTopLeftRadius: leading ? top : round,
          borderBottomLeftRadius: leading ? bottom : round,
          borderTopRightRadius: leading ? round : top,
          borderBottomRightRadius: leading ? round : bottom,
        },
        style,
      ]}
      {...props}
    />
  );
}
