import {
  Button,
  ConfirmationDialog,
  Host,
  Menu,
  Picker,
  RNHostView,
  Text as SwiftText,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel as label,
  disabled as disabledModifier,
  font,
  labelsHidden,
  pickerStyle,
  tag,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import type { PickerRowProps } from "@otter/mobile/extension-kit";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { SettingsCell } from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useState, type ReactElement } from "react";
import { View } from "react-native";

/** A row choosing among a few, in the system's menu, as SettingsKit.swift's menu `Picker`s. */
export function PickerRow({
  title,
  icon,
  value,
  options,
  onChange,
  disabled,
}: PickerRowProps & { icon?: IconName }) {
  const theme = useTheme();
  return (
    <View style={{ opacity: disabled ? 0.4 : 1 }}>
      <SettingsCell>
        {icon ? (
          <View style={{ width: 24, alignItems: "center" }}>
            <Icon name={icon} size={19} color="foreground" />
          </View>
        ) : null}
        <Text size="base" numberOfLines={1} style={{ flexShrink: 0 }}>
          {title}
        </Text>
        <View style={{ flex: 1 }} />
        <Host matchContents colorScheme={theme.scheme}>
          <Picker
            label={title}
            selection={value}
            onSelectionChange={(next: string) => onChange(next)}
            modifiers={[
              pickerStyle("menu"),
              labelsHidden(),
              tint(theme.colors.mutedForeground),
              font({ family: theme.fonts.sans, size: theme.text.base.fontSize }),
              disabledModifier(Boolean(disabled)),
            ]}
          >
            {options.map((o) => (
              <SwiftText key={o.value} modifiers={[tag(o.value)]}>
                {o.label}
              </SwiftText>
            ))}
          </Picker>
        </Host>
      </SettingsCell>
    </View>
  );
}

export type MenuAction = {
  title: string;
  icon?: IconName;
  destructive?: boolean;
  onPress: () => void;
};

/** What's drawn (a row, a picture) opening the system's menu of `actions` when tapped. */
export function MenuButton({
  actions,
  accessibilityLabel,
  children,
}: {
  actions: MenuAction[];
  accessibilityLabel: string;
  children: ReactElement;
}) {
  const theme = useTheme();
  return (
    <Host matchContents colorScheme={theme.scheme}>
      <Menu
        label={<RNHostView matchContents>{children}</RNHostView>}
        modifiers={[tint(theme.colors.foreground), label(accessibilityLabel)]}
      >
        {actions.map((a) => (
          <Button
            key={a.title}
            label={a.title}
            systemImage={a.icon}
            role={a.destructive ? "destructive" : "default"}
            onPress={a.onPress}
          />
        ))}
      </Menu>
    </Host>
  );
}

/**
 * SwiftUI's `confirmationDialog`, shown from what's drawn (`children`, given a way to present it):
 * its title, message and one destructive action, anchored to it.
 */
export function Confirmation({
  title,
  message,
  action,
  onConfirm,
  children,
}: {
  title: string;
  message: string;
  action: string;
  onConfirm: () => void;
  children: (present: () => void) => ReactElement;
}) {
  const theme = useTheme();
  const [presented, setPresented] = useState(false);
  return (
    <Host matchContents={{ vertical: true }} colorScheme={theme.scheme}>
      <ConfirmationDialog
        title={title}
        titleVisibility="visible"
        isPresented={presented}
        onIsPresentedChange={setPresented}
      >
        <ConfirmationDialog.Trigger>
          <RNHostView matchContents={{ vertical: true }}>
            {children(() => setPresented(true))}
          </RNHostView>
        </ConfirmationDialog.Trigger>
        <ConfirmationDialog.Actions>
          <Button label={action} role="destructive" onPress={onConfirm} />
        </ConfirmationDialog.Actions>
        <ConfirmationDialog.Message>
          <SwiftText>{message}</SwiftText>
        </ConfirmationDialog.Message>
      </ConfirmationDialog>
    </Host>
  );
}
