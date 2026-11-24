import { Glass } from "@otter/ui-native/components/glass";
import { Text } from "@otter/ui-native/components/text";
import { Pressable, View } from "react-native";

function Action({
  title,
  width,
  disabled,
  destructive = false,
  onPress,
}: {
  title: string;
  width: number;
  disabled: boolean;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Glass
        interactive
        style={{ width, height: 50, alignItems: "center", justifyContent: "center" }}
      >
        <Text weight="medium" color={destructive ? "error" : "foreground"}>
          {title}
        </Text>
      </Glass>
    </Pressable>
  );
}

/** What selected chats can have done to them at once, where the bars were (ChatsScreen.swift's `selectionBar`). */
export function SelectionBar({
  disabled,
  canRead,
  settle,
  read,
  remove,
}: {
  disabled: boolean;
  canRead: boolean;
  settle: () => void;
  read: () => void;
  remove: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Action title="Settle" width={110} disabled={disabled} onPress={settle} />
      <Action title="Read" width={90} disabled={disabled || !canRead} onPress={read} />
      <Action title="Delete…" width={110} disabled={disabled} destructive onPress={remove} />
    </View>
  );
}
