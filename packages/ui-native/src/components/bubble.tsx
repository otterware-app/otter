import { View, type ViewProps } from "react-native";

import { useTheme, type Theme } from "../theme.ts";

/**
 * A chat's two bubble colors (apps/ios-agents's Design.swift): the agent's grey, and yours, the
 * canvas with some of the accent in it (16 % light, 38 % dark).
 */
const colors = {
  light: { incoming: "#e6e6e6", outgoing: "#d9e5f9" },
  dark: { incoming: "#242426", outgoing: "#233c61" },
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
