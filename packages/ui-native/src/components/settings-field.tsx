import { TextInput } from "react-native";

import { typeStyle, useTheme } from "../theme.ts";
import { SettingsCell } from "./settings.tsx";

/** SettingsKit.swift's `SettingsField`: a row that is a text field, its placeholder its label. */
export function SettingsField({
  placeholder,
  value,
  onChangeText,
  secret = false,
  url = false,
  onSubmit,
}: {
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  /** Typed out of sight: a key, a token. */
  secret?: boolean;
  /** The URL keyboard. */
  url?: boolean;
  onSubmit?: () => void;
}) {
  const theme = useTheme();
  return (
    <SettingsCell>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.mutedForeground}
        accessibilityLabel={placeholder}
        secureTextEntry={secret}
        keyboardType={url ? "url" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        onSubmitEditing={onSubmit}
        style={[
          typeStyle(theme, "base"),
          { flex: 1, alignSelf: "stretch", color: theme.colors.foreground },
        ]}
      />
    </SettingsCell>
  );
}
