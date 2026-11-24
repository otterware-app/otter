import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";

import { alpha, useTheme, type ColorToken, type Theme } from "../theme.ts";
import { Glass } from "./glass.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { Text } from "./text.tsx";

export type ButtonVariant =
  | "outline"
  | "primary"
  | "secondary"
  | "ghost"
  | "ghost-muted"
  | "destructive"
  | "ghost-destructive"
  | "link"
  /** The Swift app's `.buttonStyle(.glass)`. */
  | "glass"
  /** `.buttonStyle(.glassProminent)` tinted with the text color: Done, compose. */
  | "glass-prominent";

export type ButtonSize = "sm" | "default" | "lg" | "xl";

/** Heights: `default` is the ask bar's 38, `lg` the 44 a touch needs alone, `xl` a settings row's 50. */
const HEIGHT: Record<ButtonSize, number> = { sm: 32, default: 38, lg: 44, xl: 50 };

type Look = {
  fill?: string;
  border?: string;
  text: ColorToken | string;
  glass?: boolean;
  tint?: string;
};

function look(theme: Theme, variant: ButtonVariant): Look {
  const { colors } = theme;
  switch (variant) {
    case "outline":
      return { fill: colors.canvas, border: colors.border, text: "foreground" };
    case "primary":
      return { fill: colors.primary, text: "primaryForeground" };
    case "secondary":
      return { fill: alpha(colors.foreground, 0.06), text: "foreground" };
    case "ghost":
      return { text: "foreground" };
    case "ghost-muted":
      return { text: "mutedForeground" };
    case "destructive":
      return { fill: colors.errorSurface, text: "destructiveForeground" };
    case "ghost-destructive":
      return { text: "destructiveForeground" };
    case "link":
      return { text: "primary" };
    case "glass":
      return { glass: true, text: "foreground" };
    case "glass-prominent":
      return { glass: true, tint: colors.foreground, text: "canvas" };
  }
}

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

function Frame({
  variant = "outline",
  size = "default",
  disabled,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  square,
  style,
  children,
}: Common & {
  accessibilityLabel: string;
  square: boolean;
  children: (text: string) => ReactNode;
}) {
  const theme = useTheme();
  const { fill, border, text, glass, tint } = look(theme, variant);
  const color = text in theme.colors ? theme.colors[text as ColorToken] : text;
  const height = HEIGHT[size];
  const shape = {
    height,
    minWidth: height,
    borderRadius: height / 2,
    paddingHorizontal: square || variant === "link" ? 0 : height * 0.42,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    gap: 6,
  };
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      hitSlop={height < 44 ? (44 - height) / 2 : undefined}
      style={({ pressed }) => [
        { opacity: disabled ? 0.4 : pressed && !glass ? 0.6 : 1, alignSelf: "flex-start" },
        style,
      ]}
    >
      {glass ? (
        <Glass interactive tint={tint} style={shape}>
          {children(color)}
        </Glass>
      ) : (
        <View
          style={[
            shape,
            { backgroundColor: fill, borderWidth: border ? 1 : 0, borderColor: border },
          ]}
        >
          {children(color)}
        </View>
      )}
    </Pressable>
  );
}

export type ButtonProps = Common & { title: string; icon?: IconName };

/** A labelled button, in @otter/ui's variants and the phone's glass ones. */
export function Button({ title, icon, size = "default", ...props }: ButtonProps) {
  const fontSize = size === "sm" ? "sm" : "base";
  return (
    <Frame {...props} size={size} square={false} accessibilityLabel={title}>
      {(color) => (
        <>
          {icon ? (
            <Icon name={icon} size={fontSize === "sm" ? 14 : 16} weight="semibold" tint={color} />
          ) : null}
          <Text size={fontSize} weight="semibold" style={{ color }} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}
    </Frame>
  );
}

export type IconButtonProps = Common & { icon: IconName; label: string };

/** A round button of one symbol, glass by default; `label` is what VoiceOver says. */
export function IconButton({
  icon,
  label,
  variant = "glass",
  size = "lg",
  ...props
}: IconButtonProps) {
  return (
    <Frame {...props} variant={variant} size={size} square accessibilityLabel={label}>
      {(color) => <Icon name={icon} size={HEIGHT[size] * 0.42} weight="medium" tint={color} />}
    </Frame>
  );
}
