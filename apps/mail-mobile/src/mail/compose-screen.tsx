import { useAccounts, useMessage, useSendMessage } from "@otter/client/mail/hooks";
import { computeReply, prefixSubject } from "@otter/client/mail/reply";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, TextInput, View } from "react-native";

export function ComposeScreen() {
  const { account, replyTo, thread } = useLocalSearchParams<{
    account: string;
    replyTo?: string;
    thread?: string;
  }>();
  const mailbox = useAccounts().data?.find((entry) => entry.id === account);
  const related = useMessage(account, replyTo ?? null);
  if (replyTo && !related.data) {
    return (
      <Text style={{ padding: 16 }}>
        {related.isError ? "Couldn't load the message to reply to." : "Loading message…"}
      </Text>
    );
  }
  const message = related.data;
  const recipient = message ? computeReply(message, [account, ...(mailbox?.sendAs ?? [])]).to : "";
  const subject = message ? prefixSubject("Re", message.subject) : "";
  return (
    <Composer
      account={account}
      thread={thread}
      replyTo={replyTo}
      recipient={recipient}
      subject={subject}
    />
  );
}

function Composer({
  account,
  thread,
  replyTo,
  recipient,
  subject,
}: {
  account: string;
  thread?: string;
  replyTo?: string;
  recipient: string;
  subject: string;
}) {
  const [to, setTo] = useState(recipient);
  const [title, setTitle] = useState(subject);
  const [body, setBody] = useState("");
  const theme = useTheme();
  const router = useRouter();
  const send = useSendMessage();
  const field = [
    typeStyle(theme, "base", "regular"),
    {
      color: theme.colors.foreground,
      paddingVertical: 12,
    },
  ];
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 16, gap: 8 }}
    >
      <Stack.Screen options={{ title: replyTo ? "Reply" : "New message" }} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon="arrow.up"
          accessibilityLabel="Send"
          disabled={!to.trim() || send.isPending}
          onPress={() =>
            send.mutate(
              {
                accountId: account,
                threadId: thread,
                replyToMessageId: replyTo,
                to: to.trim(),
                subject: title,
                body,
              },
              { onSuccess: () => router.back() },
            )
          }
        />
      </Stack.Toolbar>
      <View style={{ paddingHorizontal: 12, borderRadius: 14, backgroundColor: theme.colors.card }}>
        <TextInput
          accessibilityLabel="To"
          placeholder="To"
          placeholderTextColor={theme.colors.mutedForeground}
          value={to}
          onChangeText={setTo}
          autoCapitalize="none"
          keyboardType="email-address"
          style={field}
        />
        <TextInput
          accessibilityLabel="Subject"
          placeholder="Subject"
          placeholderTextColor={theme.colors.mutedForeground}
          value={title}
          onChangeText={setTitle}
          style={field}
        />
      </View>
      <TextInput
        autoFocus={Boolean(replyTo)}
        accessibilityLabel="Message"
        placeholder="Message"
        placeholderTextColor={theme.colors.mutedForeground}
        value={body}
        onChangeText={setBody}
        multiline
        style={[...field, { minHeight: 180, paddingHorizontal: 12, textAlignVertical: "top" }]}
      />
      {send.isError ? (
        <Text color="error" size="sm">
          {send.error.message}
        </Text>
      ) : null}
    </ScrollView>
  );
}
