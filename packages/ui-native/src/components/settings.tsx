import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, ScrollView, View, type ScrollViewProps } from "react-native";

import { alpha, useTheme, type ColorToken } from "../theme.ts";
import { Icon, type IconName } from "./icon.tsx";
import { Switch } from "./switch.tsx";
import { Text, type TextProps } from "./text.tsx";

/** SettingsKit.swift: T3 Code's settings look, titled groups on soft cards. */
export function SettingsPage({ children, ...props }: ScrollViewProps & { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="interactive"
      style={{ backgroundColor: theme.colors.canvas }}
      contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 12, paddingBottom: 96, gap: 18 }}
      {...props}
    >
      {children}
    </ScrollView>
  );
}

/** A group of rows on a card, with a title over it and a footer under it; rows are divided for you. */
export function SettingsSection({
  title,
  headline = false,
  footer,
  children,
}: {
  title?: string;
  /** The title bold and as large as a row's, as a SwiftUI Form section's `sectionHeader()`. */
  headline?: boolean;
  /** Text, or paragraphs of `SettingsFooterText`. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const theme = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={{ gap: 7 }}>
      {title ? (
        <Text
          size={headline ? "lg" : "sm"}
          weight={headline ? "semibold" : "medium"}
          color={headline ? "foreground" : "mutedForeground"}
          accessibilityRole="header"
          style={{ paddingHorizontal: 8 }}
        >
          {title}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: theme.colors.card,
          borderRadius: 24,
          borderCurve: "continuous",
          overflow: "hidden",
        }}
      >
        {rows.map((row, index) => (
          <Fragment key={row.key ?? index}>
            {index > 0 ? <SettingsDivider /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <View style={{ paddingHorizontal: 8, paddingTop: 1, gap: 6 }}>
          {typeof footer === "string" ? <SettingsFooterText>{footer}</SettingsFooterText> : footer}
        </View>
      ) : null}
    </View>
  );
}

export function SettingsFooterText(props: Omit<TextProps, "size" | "color">) {
  return <Text size="body" color="mutedForeground" {...props} />;
}

export function SettingsDivider() {
  const theme = useTheme();
  return (
    <View style={{ height: 1, marginLeft: 16, backgroundColor: alpha(theme.colors.border, 0.7) }} />
  );
}

/** A row's frame, 50 high: what goes in it is the caller's (a field, a picker). */
export function SettingsCell({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 11,
        paddingHorizontal: 16,
        minHeight: 50,
      }}
    >
      {children}
    </View>
  );
}

function Leading({ icon, tone }: { icon?: IconName | ReactNode; tone?: ColorToken }) {
  if (icon === undefined) return null;
  return (
    <View style={{ width: 24, alignItems: "center" }}>
      {typeof icon === "string" ? (
        <Icon name={icon as IconName} size={19} color={tone ?? "foreground"} />
      ) : (
        icon
      )}
    </View>
  );
}

export type SettingsRowProps = {
  title: string;
  /** A symbol's name, or an avatar. */
  icon?: IconName | ReactNode;
  /** What it's set to, muted at the end. */
  value?: string;
  /** In place of the chevron: a picker's ⌃⌄, a checkmark. */
  accessory?: ReactNode;
  /** A chevron: it opens a page. On by default when it does something. */
  chevron?: boolean;
  tone?: ColorToken;
  onPress?: () => void;
  accessibilityHint?: string;
};

/** A symbol, a name and a value; with `onPress`, a navigation row with its chevron. */
export function SettingsRow({
  title,
  icon,
  value,
  accessory,
  chevron,
  tone,
  onPress,
  accessibilityHint,
}: SettingsRowProps) {
  const content = (
    <SettingsCell>
      <Leading icon={icon} tone={tone} />
      <Text size="base" color={tone ?? "foreground"} numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <View style={{ flex: 1, minWidth: 8 }} />
      {value ? (
        <Text size="sm" color="mutedForeground" numberOfLines={1} style={{ flexShrink: 1 }}>
          {value}
        </Text>
      ) : null}
      {accessory}
      {(chevron ?? Boolean(onPress)) && !accessory ? (
        <Icon name="chevron.right" size={13} weight="semibold" color="faintForeground" />
      ) : null}
    </SettingsCell>
  );
  if (!onPress)
    return (
      <View accessible accessibilityLabel={value ? `${title}, ${value}` : title}>
        {content}
      </View>
    );
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${title}, ${value}` : title}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
    >
      {content}
    </Pressable>
  );
}

/** A row with a switch: tapping the row flips it too. */
export function SettingsSwitchRow({
  title,
  description,
  icon,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  /** Under the title, muted. */
  description?: string;
  icon?: IconName | ReactNode;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <SettingsCell>
        <Leading icon={icon} />
        {description ? (
          <View style={{ flex: 1, paddingVertical: 10, gap: 2 }}>
            <Text size="base" numberOfLines={1}>
              {title}
            </Text>
            <Text size="body" color="mutedForeground">
              {description}
            </Text>
          </View>
        ) : (
          <Text size="base" numberOfLines={1} style={{ flex: 1 }}>
            {title}
          </Text>
        )}
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          importantForAccessibility="no-hide-descendants"
          accessible={false}
        />
      </SettingsCell>
    </Pressable>
  );
}

/** An action as a row: Sign out, Remove; `destructive` in the error color. */
export function SettingsButton({
  title,
  destructive = false,
  disabled,
  onPress,
}: {
  title: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.5 : 1 })}
    >
      <SettingsCell>
        <Text size="base" weight="medium" color={destructive ? "error" : "foreground"}>
          {title}
        </Text>
      </SettingsCell>
    </Pressable>
  );
}
