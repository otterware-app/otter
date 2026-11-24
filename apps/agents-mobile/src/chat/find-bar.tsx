import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { Pressable, TextInput, View } from "react-native";

/** Find in chat: a glass capsule over the transcript, with where you are among the turns it found. */
export function FindBar({
  query,
  onChange,
  at,
  found,
  onGo,
  onDone,
}: {
  query: string;
  onChange: (query: string) => void;
  at: number;
  found: number;
  onGo: (step: 1 | -1) => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const arrow = (step: 1 | -1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={step === 1 ? "Next" : "Previous"}
      accessibilityState={{ disabled: found === 0 }}
      disabled={found === 0}
      hitSlop={4}
      onPress={() => onGo(step)}
      style={{
        width: 30,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
        opacity: found ? 1 : 0.35,
      }}
    >
      <Icon name={step === 1 ? "chevron.down" : "chevron.up"} size={14} weight="medium" />
    </Pressable>
  );
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
      <Glass
        style={{
          height: 44,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          paddingLeft: 14,
          paddingRight: 12,
        }}
      >
        <Icon name="magnifyingglass" size={14} color="mutedForeground" />
        <TextInput
          autoFocus
          value={query}
          onChangeText={onChange}
          placeholder="Find in chat"
          accessibilityLabel="Find in chat"
          placeholderTextColor={theme.colors.mutedForeground}
          returnKeyType="search"
          submitBehavior="submit"
          autoCorrect={false}
          autoCapitalize="none"
          onSubmitEditing={() => onGo(1)}
          style={[typeStyle(theme, "md"), { flex: 1, color: theme.colors.foreground, height: 44 }]}
        />
        {query.trim() ? (
          <Text size="body" color="mutedForeground" tabular>
            {found ? `${Math.min(at, found - 1) + 1}/${found}` : "No results"}
          </Text>
        ) : null}
        {arrow(-1)}
        {arrow(1)}
        <Pressable
          accessibilityRole="button"
          onPress={onDone}
          hitSlop={6}
          style={{ paddingLeft: 4 }}
        >
          <Text size="md" weight="semibold">
            Done
          </Text>
        </Pressable>
      </Glass>
    </View>
  );
}
