import { formatFullDate } from "@otter/client/mail/format";
import { useMessage, useModifyThread, useThread } from "@otter/client/mail/hooks";
import type { MessageSummary } from "@otter/client/mail/types";
import { Avatar } from "@otter/ui-native/components/avatar";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";

export function ThreadScreen() {
  const { account, label, thread } = useLocalSearchParams<{
    account: string;
    label: string;
    thread: string;
  }>();
  const result = useThread(account, thread);
  const modify = useModifyThread();
  const router = useRouter();
  const messages = result.data ?? [];
  const latest = messages.at(-1);
  const starred = messages.some((message) => message.starred);
  const inInbox = messages.some((message) => message.labelIds.includes("INBOX"));
  const canReply = latest && !latest.labelIds.includes("DRAFT");
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "" }} />
      {latest ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={starred ? "star.fill" : "star"}
            accessibilityLabel={starred ? "Unstar conversation" : "Star conversation"}
            onPress={() =>
              modify.mutate({
                accountId: account,
                threadId: thread,
                ...(starred ? { removeLabelIds: ["STARRED"] } : { addLabelIds: ["STARRED"] }),
              })
            }
          />
          <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Conversation actions">
            {inInbox ? (
              <Stack.Toolbar.MenuAction
                icon="archivebox"
                onPress={() =>
                  modify.mutate(
                    {
                      accountId: account,
                      threadId: thread,
                      removeLabelIds: ["INBOX"],
                      from: label,
                    },
                    { onSuccess: () => router.back() },
                  )
                }
              >
                Archive
              </Stack.Toolbar.MenuAction>
            ) : null}
            <Stack.Toolbar.MenuAction
              icon="envelope"
              onPress={() =>
                modify.mutate({ accountId: account, threadId: thread, addLabelIds: ["UNREAD"] })
              }
            >
              Mark unread
            </Stack.Toolbar.MenuAction>
            {canReply ? (
              <Stack.Toolbar.MenuAction
                icon="arrowshape.turn.up.left"
                onPress={() =>
                  router.push({
                    pathname: "/compose",
                    params: { account, replyTo: latest.id, thread },
                  })
                }
              >
                Reply
              </Stack.Toolbar.MenuAction>
            ) : null}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: 18, paddingVertical: 16, gap: 12 }}
      >
        {result.isPending ? <Spinner /> : null}
        {result.isError ? (
          <EmptyState
            icon="envelope"
            title="Couldn't load conversation"
            description={result.error.message}
          />
        ) : null}
        {latest ? (
          <Text size="2xl" weight="semibold" accessibilityRole="header">
            {latest.subject || "(No subject)"}
          </Text>
        ) : null}
        {messages.map((message) => (
          <MessageCard key={message.id} account={account} message={message} />
        ))}
      </ScrollView>
    </View>
  );
}

function MessageCard({ account, message }: { account: string; message: MessageSummary }) {
  const theme = useTheme();
  const detail = useMessage(account, message.id);
  const sender = message.fromName || message.fromEmail;
  const body = detail.data?.bodyText?.trim() || message.snippet;
  return (
    <View
      style={{
        borderRadius: 18,
        borderCurve: "continuous",
        backgroundColor: theme.colors.card,
        gap: 11,
        padding: 14,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 9 }}>
        <Avatar size={34} initials={Array.from(sender)[0]?.toLocaleUpperCase()} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text size="md" weight="semibold" numberOfLines={1}>
            {sender}
          </Text>
          <Text size="sm" color="mutedForeground">
            {formatFullDate(message.date)}
          </Text>
        </View>
      </View>
      {detail.isError ? (
        <Text size="sm" color="mutedForeground">
          Couldn't load the full message.
        </Text>
      ) : null}
      <Text size="base" selectable>
        {body}
      </Text>
      {detail.data?.attachments.map((attachment) => (
        <Text key={attachment.id} size="sm" color="mutedForeground">
          {attachment.filename}
        </Text>
      ))}
    </View>
  );
}
