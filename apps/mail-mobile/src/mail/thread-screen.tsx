import { getAccountColor, getAccountDisplayName } from "@otter/client/mail/account-style";
import { pickAdvanceTarget } from "@otter/client/mail/advance-direction";
import type { ListMessagesResult } from "@otter/client/mail/api";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { queryKeys, useLabels, useModifyThread, useThread } from "@otter/client/mail/hooks";
import type { MessageSummary } from "@otter/client/mail/types";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { Glass } from "@otter/ui-native/components/glass";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActionSheetIOS, LayoutAnimation, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CodeCard } from "./code-card.tsx";
import { MailButton } from "../frame/mail-bar.tsx";
import { useFullWidthMessages } from "../settings/preferences.ts";
import {
  confirmDelete,
  hasLabels,
  labelChoices,
  LabelSheet,
  useMailActions,
  type LabelPicker,
  type MailAction,
} from "./mail-actions.tsx";
import { useMailboxes } from "./mailboxes.ts";
import { MessageCard, replyOptions, type ReplyMode } from "./message-card.tsx";
import { mailPointer, sendToAgent, useAgentsInstalled } from "./send-to-agent.ts";
import { useVerificationCode } from "./verification-code.ts";

export function ThreadScreen() {
  const { account, label, thread } = useLocalSearchParams<{
    account: string;
    label: string;
    thread: string;
  }>();
  return (
    <Conversation
      key={JSON.stringify([account, thread])}
      scope={account}
      label={label}
      thread={thread}
    />
  );
}

function Conversation({ scope, label, thread }: { scope: string; label: string; thread: string }) {
  const router = useRouter();
  const queries = useQueryClient();
  const theme = useTheme();
  const buttonTint = alpha(theme.colors.canvas, 0.75);
  const insets = useSafeAreaInsets();
  const { mailboxes } = useMailboxes();
  const mailbox = mailboxes.find(({ look }) => look.id === scope);
  const account = mailbox?.account;
  const alias = mailbox?.alias;
  const result = useThread(account?.id ?? null, thread, alias);
  const labels = useLabels(account?.id ?? null, alias);
  const { mutate: modify } = useModifyThread();
  const currentLabels = labels.data ?? [];
  const actions = useMailActions(account, label, currentLabels);
  const agents = useAgentsInstalled();
  const fullWidth = useFullWidthMessages();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [labelPicker, setLabelPicker] = useState<LabelPicker | null>(null);
  const markedRead = useRef(false);
  const messages = result.data ?? [];
  const latest = messages.at(-1);
  const replyTo = messages.findLast((message) => !message.labelIds.includes("DRAFT"));
  const verification = useVerificationCode(account?.id, replyTo);
  const starred = messages.some((message) => message.starred);
  const caps = capabilitiesOf(account);
  const flag = caps.stars ? "star" : "flag";
  const bin = label === "TRASH" || label === "SPAM";
  const removable = label === "TRASH" || label === "SPAM" || label === "DRAFT";
  const summary = latest
    ? {
        ...latest,
        threadLabelIds: [...new Set(messages.flatMap((message) => message.labelIds))],
        threadUnread: messages.some((message) => message.unread),
        threadStarred: starred,
      }
    : null;

  useEffect(() => {
    if (!account || !result.data?.length || markedRead.current) return;
    markedRead.current = true;
    if (result.data.some((message) => message.unread)) {
      modify({ accountId: account.id, threadId: thread, removeLabelIds: ["UNREAD"] });
    }
  }, [account, modify, result.data, thread]);

  function compose(mode: ReplyMode | "draft", message: MessageSummary) {
    router.push({
      pathname: "/compose",
      params:
        mode === "draft"
          ? { account: scope, draft: message.id, thread }
          : { account: scope, replyTo: message.id, mode, thread },
    });
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/mail/[account]/[label]", params: { account: scope, label } });
  }

  function act(action: MailAction, leaves = false) {
    if (!account || !summary) return;
    const rows =
      queries
        .getQueryData<InfiniteData<ListMessagesResult>>(
          queryKeys.messages(account.id, label, alias),
        )
        ?.pages.flatMap((page) => page.messages) ?? [];
    const index = rows.findIndex(({ threadId }) => threadId === thread);
    const next = leaves && index >= 0 ? pickAdvanceTarget(rows, index) : null;
    const run = () =>
      void actions.run(action, [summary]).then((ok) => {
        if (!ok || !leaves) return;
        if (next)
          router.replace({
            pathname: "/mail/[account]/[label]/[thread]",
            params: { account: scope, label, thread: next.threadId },
          });
        else goBack();
      });
    if (action === "delete" || action === "discard") confirmDelete(1, action === "discard", run);
    else run();
  }

  function replyMenu() {
    if (!replyTo) return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...replyOptions.map(({ title }) => title), "Cancel"],
        cancelButtonIndex: replyOptions.length,
      },
      (index) => {
        const option = replyOptions[index];
        if (option) compose(option.id, replyTo);
      },
    );
  }

  return (
    <View style={styles.fill}>
      <Stack.Screen
        options={{ title: "", headerBackButtonDisplayMode: "minimal", headerShadowVisible: false }}
      />
      {summary && (
        <>
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon={starred ? (caps.stars ? "star.fill" : "flag.fill") : flag}
              tintColor={theme.colors.primary}
              accessibilityLabel={
                starred ? (caps.stars ? "Unstar" : "Unflag") : caps.stars ? "Star" : "Flag"
              }
              onPress={() => act(starred ? "unstar" : "star")}
            />
            <Stack.Toolbar.Menu
              icon="ellipsis"
              tintColor={theme.colors.primary}
              accessibilityLabel="More"
            >
              <Stack.Toolbar.Menu inline>
                {replyTo ? (
                  <Stack.Toolbar.MenuAction
                    icon="arrowshape.turn.up.left.2"
                    onPress={() => compose("replyAll", replyTo)}
                  >
                    Reply all
                  </Stack.Toolbar.MenuAction>
                ) : null}
                {replyTo ? (
                  <Stack.Toolbar.MenuAction
                    icon="arrowshape.turn.up.right"
                    onPress={() => compose("forward", replyTo)}
                  >
                    Forward
                  </Stack.Toolbar.MenuAction>
                ) : null}
              </Stack.Toolbar.Menu>
              <Stack.Toolbar.Menu inline>
                <Stack.Toolbar.MenuAction
                  icon={summary.threadUnread ? "envelope.open" : "envelope.badge"}
                  onPress={() => act(summary.threadUnread ? "read" : "unread")}
                >
                  {summary.threadUnread ? "Mark as read" : "Mark as unread"}
                </Stack.Toolbar.MenuAction>
                <Stack.Toolbar.MenuAction
                  icon={starred ? `${flag}.slash` : flag}
                  onPress={() => act(starred ? "unstar" : "star")}
                >
                  {starred ? (caps.stars ? "Unstar" : "Unflag") : caps.stars ? "Star" : "Flag"}
                </Stack.Toolbar.MenuAction>
                {hasLabels(account, currentLabels) ? (
                  <Stack.Toolbar.Menu
                    title={caps.foldersAndCategories ? "Categories" : "Labels"}
                    icon="tag"
                  >
                    {labelChoices("label", account, currentLabels).map(({ id, title }) => (
                      <Stack.Toolbar.MenuAction
                        key={id}
                        isOn={summary.threadLabelIds.includes(id)}
                        onPress={() => void actions.changeLabel("label", id, [summary])}
                      >
                        {title}
                      </Stack.Toolbar.MenuAction>
                    ))}
                  </Stack.Toolbar.Menu>
                ) : null}
                {caps.archiveFolder ? (
                  <Stack.Toolbar.MenuAction icon="folder" onPress={() => setLabelPicker("move")}>
                    Move to
                  </Stack.Toolbar.MenuAction>
                ) : null}
              </Stack.Toolbar.Menu>
              <Stack.Toolbar.Menu inline>
                {actions.canArchive(summary) ? (
                  <Stack.Toolbar.MenuAction icon="archivebox" onPress={() => act("archive", true)}>
                    Archive
                  </Stack.Toolbar.MenuAction>
                ) : null}
                {bin || label === "ARCHIVE" ? (
                  <Stack.Toolbar.MenuAction
                    icon="tray.and.arrow.down"
                    onPress={() => act("restore", true)}
                  >
                    Move to Inbox
                  </Stack.Toolbar.MenuAction>
                ) : null}
                {!bin && label !== "DRAFT" ? (
                  <Stack.Toolbar.MenuAction icon="xmark.bin" onPress={() => act("junk", true)}>
                    Report junk
                  </Stack.Toolbar.MenuAction>
                ) : null}
                <Stack.Toolbar.MenuAction
                  icon="trash"
                  destructive
                  onPress={() =>
                    act(removable ? (label === "DRAFT" ? "discard" : "delete") : "trash", true)
                  }
                >
                  {label === "DRAFT"
                    ? "Discard draft"
                    : label === "TRASH"
                      ? "Delete forever"
                      : "Trash"}
                </Stack.Toolbar.MenuAction>
              </Stack.Toolbar.Menu>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.content,
          { paddingHorizontal: 0, paddingBottom: insets.bottom + 74 },
        ]}
      >
        {result.isPending && <Spinner />}
        {result.isError ? (
          <EmptyState
            icon="envelope"
            title="Couldn't load conversation"
            description={result.error.message}
            actions={<Button title="Try again" onPress={() => void result.refetch()} />}
          />
        ) : null}
        {result.isSuccess && !latest ? (
          <EmptyState icon="envelope" title="Conversation unavailable" />
        ) : null}
        {latest && account && (
          <>
            <Text
              accessibilityRole="header"
              size="2xl"
              weight="semibold"
              lineBreakStrategyIOS="push-out"
              selectable
              style={styles.subject}
            >
              {messages[0]?.subject || "(No subject)"}
            </Text>
            {mailbox && summary && (
              <View style={styles.threadLabels}>
                <View
                  style={[styles.mailboxDot, { backgroundColor: getAccountColor(mailbox.look) }]}
                />
                <Text size="body" color="mutedForeground">
                  {getAccountDisplayName(mailbox.look)}
                </Text>
                {currentLabels
                  .filter(
                    (label) => label.type === "user" && summary.threadLabelIds.includes(label.id),
                  )
                  .map(({ id, name, color }) => (
                    <Text
                      key={id}
                      size="xs"
                      weight="medium"
                      style={[
                        styles.label,
                        {
                          backgroundColor: alpha(
                            color?.backgroundColor ?? theme.colors.mutedForeground,
                            0.18,
                          ),
                        },
                      ]}
                    >
                      {name.split("/").at(-1)}
                    </Text>
                  ))}
              </View>
            )}
            {verification && (
              <View style={{ marginHorizontal: 20 }}>
                <CodeCard
                  code={verification}
                  onTrash={bin ? undefined : () => act("trash", true)}
                />
              </View>
            )}
            {messages.map((message) => (
              <MessageCard
                key={message.id}
                message={message}
                account={account.id}
                email={account.email}
                scope={scope}
                agents={agents}
                fullWidth={fullWidth}
                opened={expanded[message.id] ?? message.id === latest.id}
                toggle={() => {
                  LayoutAnimation.configureNext(
                    LayoutAnimation.create(200, "easeInEaseOut", "opacity"),
                  );
                  setExpanded((current) => ({
                    ...current,
                    [message.id]: !(current[message.id] ?? message.id === latest.id),
                  }));
                }}
                onCompose={compose}
              />
            ))}
          </>
        )}
      </ScrollView>
      {latest && summary && (
        <View pointerEvents="box-none" style={[styles.bottom, { bottom: insets.bottom + 6 }]}>
          {actions.canArchive(summary) ? (
            <Glass shape="circle" interactive tint={buttonTint}>
              <MailButton title="Archive" icon="archivebox" onPress={() => act("archive", true)} />
            </Glass>
          ) : bin || label === "ARCHIVE" ? (
            <Glass shape="circle" interactive tint={buttonTint}>
              <MailButton
                title="Move to Inbox"
                icon="tray.and.arrow.down"
                onPress={() => act("restore", true)}
              />
            </Glass>
          ) : null}
          <Glass shape="circle" interactive tint={buttonTint}>
            <MailButton
              title={removable ? (label === "DRAFT" ? "Discard draft" : "Delete forever") : "Trash"}
              icon="trash"
              onPress={() =>
                act(removable ? (label === "DRAFT" ? "discard" : "delete") : "trash", true)
              }
            />
          </Glass>
          <View style={{ flex: 1 }} />
          {agents && account && (
            <Glass shape="circle" interactive tint={buttonTint}>
              <MailButton
                title="Send to agent"
                icon="sparkles"
                onPress={() => sendToAgent([mailPointer(account.email, summary)])}
              />
            </Glass>
          )}
          {latest.labelIds.includes("DRAFT") ? (
            <Glass shape="circle" interactive tint={buttonTint}>
              <MailButton
                title="Edit draft"
                icon="square.and.pencil"
                onPress={() => compose("draft", latest)}
              />
            </Glass>
          ) : (
            replyTo && (
              <Glass shape="circle" interactive tint={buttonTint}>
                <MailButton
                  title="Reply"
                  icon="arrowshape.turn.up.left"
                  onPress={() => compose("reply", replyTo)}
                  onLongPress={replyMenu}
                />
              </Glass>
            )
          )}
        </View>
      )}
      <LabelSheet
        kind={labelPicker}
        account={account}
        labels={currentLabels}
        threads={summary ? [summary] : []}
        onClose={() => setLabelPicker(null)}
        onChange={(kind, id) => {
          if (!summary) return;
          void actions.changeLabel(kind, id, [summary]).then((ok) => {
            if (ok && kind === "move" && id !== label) goBack();
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: 8, gap: 8 },
  subject: { marginHorizontal: 20 },
  threadLabels: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  mailboxDot: { width: 7, height: 7, borderRadius: 4 },
  label: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 9, overflow: "hidden" },
  bottom: {
    position: "absolute",
    left: 16,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
});
