import { Host, Picker, Text as SwiftText } from "@expo/ui/swift-ui";
import { font, labelsHidden, pickerStyle, tag, tint } from "@expo/ui/swift-ui/modifiers";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { SettingsCell } from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { View } from "react-native";

/** A row choosing among a few, in the system's menu, as SwiftUI's menu `Picker`. */
export function PickerRow<T extends string>({
  title,
  icon,
  value,
  options,
  onChange,
}: {
  title: string;
  icon: IconName;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <SettingsCell>
      <View style={{ width: 24, alignItems: "center" }}>
        <Icon name={icon} size={19} color="foreground" />
      </View>
      <Text size="base" numberOfLines={1} style={{ flexShrink: 0 }}>
        {title}
      </Text>
      <View style={{ flex: 1 }} />
      <Host matchContents colorScheme={theme.scheme}>
        <Picker
          label={title}
          selection={value}
          onSelectionChange={(next: string) => onChange(next as T)}
          modifiers={[
            pickerStyle("menu"),
            labelsHidden(),
            tint(theme.colors.primary),
            font({ family: theme.fonts.sans, size: theme.text.base.fontSize }),
          ]}
        >
          {(Object.keys(options) as T[]).map((key) => (
            <SwiftText key={key} modifiers={[tag(key)]}>
              {options[key]}
            </SwiftText>
          ))}
        </Picker>
      </Host>
    </SettingsCell>
  );
}
