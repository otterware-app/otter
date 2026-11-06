import { StyleSheet, Text, View, useColorScheme } from "react-native";

import { palette } from "../theme";

export function ChatScreen() {
  const colors = palette(useColorScheme());
  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Text style={{ color: colors.secondary }}>The agent's chats come next.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center" },
});
