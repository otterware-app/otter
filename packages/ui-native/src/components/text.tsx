import { Text as NativeText, type TextProps as NativeTextProps } from "react-native";

import { typeStyle, useTheme, type ColorToken, type TypeStep, type Weight } from "../theme.ts";

export type TextProps = NativeTextProps & {
  /** A step of the type scale: `lg` 17 is the phone's body, `base` 16 a row's title. */
  size?: TypeStep;
  weight?: Weight;
  color?: ColorToken;
  /** Monospaced digits, for counts and times that change in place. */
  tabular?: boolean;
};

/** Inter on the type scale, scaling with Dynamic Type as its iOS text style does. */
export function Text({
  size = "lg",
  weight = "regular",
  color = "foreground",
  tabular = false,
  style,
  ...props
}: TextProps) {
  const theme = useTheme();
  return (
    <NativeText
      dynamicTypeRamp={theme.text[size].dynamicTypeRamp}
      style={[
        typeStyle(theme, size, weight),
        { color: theme.colors[color] },
        tabular && { fontVariant: ["tabular-nums"] },
        style,
      ]}
      {...props}
    />
  );
}
