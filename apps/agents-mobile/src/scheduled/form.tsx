import {
  DatePicker,
  HStack,
  Host,
  Image,
  Menu,
  Picker,
  Stepper,
  Text as SwiftText,
} from "@expo/ui/swift-ui";
import {
  accessibilityLabel,
  datePickerStyle,
  font,
  foregroundStyle,
  labelsHidden,
  lineLimit,
  pickerStyle,
  tag,
} from "@expo/ui/swift-ui/modifiers";
import type { Option } from "@otter/client/agents/scheduled-editor";
import { SettingsCell } from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { TextInput, View } from "react-native";

/** SwiftUI's font for Inter at a size, as the Swift app's `.font(.ui(size))`. */
const inter = (size: number) => font({ family: "Inter Variable", size });

/**
 * A row with a title and the system's menu of choices at its end (`.pickerStyle(.menu)`); without
 * a title, the menu leads. The choice it shows is our own one-line Text in a Menu, not the
 * picker's label: the system draws that one itself and wraps it at large sizes, past the row.
 */
export function PickerCell({
  title,
  value,
  options,
  onChange,
}: {
  title?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const color = title ? theme.colors.mutedForeground : theme.colors.foreground;
  const chosen = options.find((o) => o.value === value)?.label ?? "";
  const picker = (
    <Host
      matchContents={{ vertical: true }}
      alignment={title ? "trailing" : "leading"}
      style={{ flex: 1 }}
    >
      <Menu
        label={
          <HStack spacing={4}>
            <SwiftText modifiers={[inter(16), foregroundStyle(color), lineLimit(1)]}>
              {chosen}
            </SwiftText>
            <Image systemName="chevron.up.chevron.down" size={12} color={color} />
          </HStack>
        }
        modifiers={[accessibilityLabel(title ? `${title}, ${chosen}` : chosen)]}
      >
        <Picker
          label={title ?? "Choose"}
          selection={value}
          onSelectionChange={(next: string) => onChange(next)}
        >
          {options.map((o) => (
            <SwiftText key={o.value} modifiers={[tag(o.value)]}>
              {o.label}
            </SwiftText>
          ))}
        </Picker>
      </Menu>
    </Host>
  );
  if (!title) return <SettingsCell>{picker}</SettingsCell>;
  return (
    <SettingsCell>
      <Text size="base">{title}</Text>
      {picker}
    </SettingsCell>
  );
}

/** Two or three choices side by side (`.pickerStyle(.segmented)`). */
export function SegmentedCell({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <SettingsCell>
      <Host matchContents={{ vertical: true }} style={{ flex: 1 }}>
        <Picker
          selection={value}
          onSelectionChange={(next: string) => onChange(next)}
          modifiers={[pickerStyle("segmented")]}
        >
          {options.map((o) => (
            <SwiftText key={o.value} modifiers={[tag(o.value)]}>
              {o.label}
            </SwiftText>
          ))}
        </Picker>
      </Host>
    </SettingsCell>
  );
}

/** The system's compact date and time picker, at a row's end. */
export function DateCell({
  title,
  value,
  onChange,
  time = true,
  date = false,
  from,
}: {
  title: string;
  value: Date;
  onChange: (date: Date) => void;
  time?: boolean;
  date?: boolean;
  from?: Date;
}) {
  return (
    <SettingsCell>
      <Text size="base">{title}</Text>
      <View style={{ flex: 1 }} />
      <Host matchContents>
        <DatePicker
          title={title}
          selection={value}
          range={from ? { start: from } : undefined}
          displayedComponents={[
            ...(date ? ["date" as const] : []),
            ...(time ? ["hourAndMinute" as const] : []),
          ]}
          onDateChange={onChange}
          modifiers={[datePickerStyle("compact"), labelsHidden(), inter(16)]}
        />
      </Host>
    </SettingsCell>
  );
}

/** The system's − + stepper, its title leading. */
export function StepperCell({
  title,
  value,
  min,
  max,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <SettingsCell>
      <Text size="base" style={{ flex: 1 }}>
        {title}
      </Text>
      <Host matchContents>
        <Stepper
          label={title}
          value={value}
          min={min}
          max={max}
          onValueChange={onChange}
          modifiers={[labelsHidden()]}
        />
      </Host>
    </SettingsCell>
  );
}

/** A text field filling a row (SettingsKit.swift's `SettingsField`); `multiline` grows from three lines to ten. */
export function FieldCell({
  placeholder,
  value,
  onChangeText,
  label,
  multiline = false,
  url = false,
  mono = false,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  label?: string;
  multiline?: boolean;
  url?: boolean;
  mono?: boolean;
}) {
  const theme = useTheme();
  const type = typeStyle(theme, mono ? "md" : "base");
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.mutedForeground}
      accessibilityLabel={label ?? placeholder}
      multiline={multiline}
      autoCapitalize={url || mono ? "none" : "sentences"}
      autoCorrect={!(url || mono)}
      keyboardType={url ? "url" : "default"}
      style={[
        type,
        mono && { fontFamily: theme.fonts.mono },
        {
          color: theme.colors.foreground,
          paddingHorizontal: 16,
          minHeight: 50,
        },
        multiline && {
          paddingVertical: 16,
          minHeight: 16 * 2 + type.fontSize! * 1.25 * 3,
          maxHeight: 16 * 2 + type.fontSize! * 1.25 * 10,
          textAlignVertical: "top",
        },
      ]}
    />
  );
}
