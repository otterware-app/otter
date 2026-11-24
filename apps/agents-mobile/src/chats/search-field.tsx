import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { TextInput } from "react-native";

/** ChatsScreen.swift's `SearchField`: a glass capsule. */
export function SearchField({
  prompt,
  text,
  onChange,
  autoFocus = false,
}: {
  prompt: string;
  text: string;
  onChange: (text: string) => void;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  return (
    <Glass
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        height: 44,
        paddingHorizontal: 14,
      }}
    >
      <Icon name="magnifyingglass" size={14} weight="medium" color="mutedForeground" />
      <TextInput
        value={text}
        onChangeText={onChange}
        placeholder={prompt}
        placeholderTextColor={theme.colors.mutedForeground}
        accessibilityLabel={prompt}
        autoFocus={autoFocus}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
        style={[typeStyle(theme, "base"), { flex: 1, color: theme.colors.foreground }]}
      />
    </Glass>
  );
}
