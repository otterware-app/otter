import { useAtomValue } from "@effect/atom-react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";

import type { RootStack } from "../../App";
import { threadAtom, threadKey } from "../../state/mail";
import { palette, relativeDate } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Thread">;

export function ThreadScreen({ route }: Props) {
  const colors = palette(useColorScheme());
  const result = useAtomValue(threadAtom(threadKey(route.params.accountId, route.params.threadId)));
  const messages = AsyncResult.getOrElse(result, () => []);
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      testID="thread"
    >
      <Text style={[styles.subject, { color: colors.text }]}>{route.params.subject}</Text>
      {AsyncResult.isFailure(result) ? (
        <Text style={{ color: colors.secondary }}>{String(result.cause)}</Text>
      ) : null}
      {messages.map((message) => (
        <View key={message.id} style={[styles.message, { backgroundColor: colors.card }]}>
          <View style={styles.head}>
            <Text style={[styles.from, { color: colors.text }]} numberOfLines={1}>
              {message.fromName || message.fromEmail}
            </Text>
            <Text style={{ color: colors.secondary }}>{relativeDate(message.date)}</Text>
          </View>
          <Text style={[styles.body, { color: colors.text }]} selectable>
            {(message.bodyText ?? message.snippet ?? "").trim()}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  subject: { fontSize: 22, fontWeight: "700", marginBottom: 4 },
  message: { borderRadius: 16, padding: 14, gap: 8 },
  head: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  from: { flex: 1, fontSize: 16, fontWeight: "600" },
  body: { fontSize: 15, lineHeight: 21 },
});
