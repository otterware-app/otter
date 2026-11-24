import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import type { StyleProp, ViewStyle } from "react-native";

import { useTheme, type ColorToken } from "../theme.ts";

export type IconName = SFSymbol;

export type IconProps = {
  /** An SF Symbol's name, as `Image(systemName:)` takes it. */
  name: IconName;
  size?: number;
  weight?: SymbolWeight;
  color?: ColorToken;
  /** A color that isn't a token: a data color, or one passed down. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
};

/** An SF Symbol, drawn by the system: decorative, so the control around it carries the label. */
export function Icon({
  name,
  size = 17,
  weight = "regular",
  color = "foreground",
  tint,
  style,
}: IconProps) {
  const theme = useTheme();
  return (
    <SymbolView
      name={name}
      size={size}
      weight={weight}
      tintColor={tint ?? theme.colors[color]}
      style={[{ width: size, height: size }, style]}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
