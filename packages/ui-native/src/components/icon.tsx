import { SymbolView, type SFSymbol, type SymbolWeight } from "expo-symbols";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { useTheme, type ColorToken } from "../theme.ts";

export type IconName = SFSymbol;

export type IconProps = {
  /** An SF Symbol's name, as `Image(systemName:)` takes it. */
  name: IconName;
  /** Its point size, as SwiftUI's `.font(.system(size:))`: the symbol is drawn that size, its frame `size` square. */
  size?: number;
  weight?: SymbolWeight;
  color?: ColorToken;
  /** A color that isn't a token: a data color, or one passed down. */
  tint?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * A symbol at a point size is about 1.2 times as tall as the size and as wide as its shape
 * makes it; `SymbolView` fits the symbol into its box, so the box is that tall and wide enough
 * for the widest, and overflows the square frame the layout sees.
 */
const TALL = 1.2;
const WIDE = 1.8;

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
    <View
      style={[{ width: size, height: size, alignItems: "center", justifyContent: "center" }, style]}
      accessible={false}
      accessibilityElementsHidden
    >
      <SymbolView
        name={name}
        weight={weight}
        tintColor={tint ?? theme.colors[color]}
        resizeMode="scaleAspectFit"
        style={{ position: "absolute", width: size * WIDE, height: size * TALL }}
      />
    </View>
  );
}
