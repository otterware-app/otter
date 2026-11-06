import { useAtomValue } from "@effect/atom-react";
import {
  Button,
  GlassEffectContainer,
  HStack,
  Host,
  Image as SwiftImage,
  Menu,
  Namespace,
  Spacer,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  frame,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import type { SFSymbol } from "expo-symbols";
import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { RootStack } from "../../App";
import { appAtomRegistry, mailboxes, operations, threadLists } from "../../state/client";
import { core } from "../../state/core";
import { threadAtom, threadKey, type MessageDetail } from "../../state/mail";
import { flag, uiPreferencesAtom } from "../../state/preferences";
import { useTranslationSettings } from "../../state/translation";
import { glassSurface, useReduceTransparency } from "../glass";
import { leaf } from "../home/labels";
import { threadActions } from "../home/threadActions";
import { usePalette } from "../theme";
import { MessageView } from "./MessageView";
import { advanceDirection, advanceTarget, isOpen } from "./reader";

type Props = NativeStackScreenProps<RootStack, "Thread">;

type Unsubscribe = { method: "oneClick" | "mailto" | "web"; target: string } | null;

const listRows = (accountId: string, labelId: string | undefined): MessageSummary[] =>
  labelId
    ? appAtomRegistry
        .get(threadLists.listAtom({ accountId, labelId }))
        .pages.flatMap((p) => p.messages)
    : [];

/**
 * A conversation, as apps/ios's ThreadView: its subject and labels, then each
 * message (earlier ones folded, MessageView). Star and More (Reply all,
 * Forward, Unsubscribe and the conversation's actions) in the bar, the agent
 * beside them; Archive, Trash and Reply at the bottom in one glass container.
 * Archiving or trashing goes on to the next conversation (Settings › After
 * archive).
 */
export function ThreadScreen({ navigation, route }: Props) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const { accountId, threadId, subject, labelId } = route.params;
  const result = useAtomValue(threadAtom(threadKey(accountId, threadId)));
  const messages = AsyncResult.getOrElse(result, () => [] as MessageDetail[]);
  const mailbox = useAtomValue(mailboxes.accountsAtom).value.find((m) => m.id === accountId);
  const labels = useAtomValue(mailboxes.labelsAtom(accountId)).value;
  const ui = useAtomValue(uiPreferencesAtom);
  const translationSettings = useTranslationSettings();
  const listView = useAtomValue(threadLists.listAtom({ accountId, labelId: labelId ?? "INBOX" }));
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [siblings] = useState(() => listRows(accountId, labelId));
  const [unsubscribe, setUnsubscribe] = useState<Unsubscribe>(null);
  const namespace = useId();
  const solid = useReduceTransparency();
  const last = messages.at(-1);
  const lastReceived = messages.findLast((m) => !m.labelIds.includes("DRAFT")) ?? last;

  const mine = useMemo(
    () =>
      new Set(
        [mailbox?.email ?? accountId, ...(mailbox?.sendAs ?? [])].map((a) => a.toLowerCase()),
      ),
    [mailbox, accountId],
  );

  /** The conversation as the list has it (with the overlays of what was just done), else from its messages. */
  const row = useMemo((): MessageSummary | null => {
    const listed = listView.pages.flatMap((p) => p.messages).find((r) => r.threadId === threadId);
    if (listed) return listed;
    if (!last) return null;
    return {
      ...last,
      threadLabelIds: [...new Set(messages.flatMap((m) => m.labelIds))],
      threadStarred: messages.some((m) => m.starred),
      threadUnread: false,
    };
  }, [listView, threadId, last, messages]);

  const actions = threadActions(mailbox, labels, labelId ?? "INBOX");

  useEffect(() => {
    if (messages.some((m) => m.unread)) {
      void operations
        .modifyThread({ accountId, threadId, removeLabelIds: ["UNREAD"] }, { quiet: true })
        .catch(() => {});
    }
  }, [messages, accountId, threadId]);

  useEffect(() => {
    if (!lastReceived) return;
    void core
      .invoke<Unsubscribe>("gmail:getUnsubscribe", { accountId, messageId: lastReceived.id })
      .then(setUnsubscribe, () => setUnsubscribe(null));
  }, [accountId, lastReceived]);

  /** Where archiving or trashing leaves the reader: the next conversation, or the list. */
  const leave = () => {
    const remaining = new Set(listRows(accountId, labelId).map((r) => r.threadId));
    const next = advanceTarget(
      siblings,
      threadId,
      remaining,
      advanceDirection(ui["gmail:advance-direction"]),
    );
    if (next) {
      navigation.replace("Thread", {
        accountId,
        threadId: next.threadId,
        subject: next.subject || "(no subject)",
        labelId,
      });
    } else navigation.goBack();
  };

  const reply = (mode: "reply" | "replyAll" | "forward") =>
    lastReceived &&
    navigation.navigate("Compose", { accountId, mode, messageId: lastReceived.id, threadId });

  const runUnsubscribe = async () => {
    if (!lastReceived) return;
    try {
      const done = await core.invoke<{ done: true } | { openUrl: string }>("gmail:unsubscribe", {
        accountId,
        messageId: lastReceived.id,
      });
      if ("openUrl" in done) await Linking.openURL(done.openUrl);
      else Alert.alert("Unsubscribed", `You won't get more mail from ${lastReceived.fromEmail}.`);
    } catch (error) {
      Alert.alert("Couldn't unsubscribe", error instanceof Error ? error.message : String(error));
    }
  };

  const askAgent = () =>
    lastReceived &&
    navigation.navigate("Chat", {
      context: {
        account: mailbox?.email ?? accountId,
        threadId,
        subject,
        from: lastReceived.fromEmail,
        messageIds: messages.map((m) => m.id),
        labelIds: row?.threadLabelIds ?? lastReceived.labelIds,
      },
    });

  useLayoutEffect(() => {
    const starred = row ? (row.threadStarred ?? row.starred) : false;
    const sf = (name: string) => ({ type: "sfSymbol" as const, name: name as never });
    navigation.setOptions({
      unstable_headerRightItems: () =>
        row
          ? [
              {
                type: "button",
                label: "Ask the agent",
                icon: { type: "image", source: require("../../../assets/agent.png") },
                onPress: askAgent,
              },
              { type: "spacing", spacing: 8 },
              {
                type: "button",
                label: starred ? actions.marks.undo : actions.marks.verb,
                icon: sf(starred ? `${actions.marks.symbol}.fill` : actions.marks.symbol),
                onPress: () => actions.toggleStar(row),
              },
              {
                type: "menu",
                label: "More",
                icon: sf("ellipsis"),
                menu: {
                  items: [
                    {
                      type: "action",
                      label: "Reply all",
                      icon: sf("arrowshape.turn.up.left.2"),
                      onPress: () => reply("replyAll"),
                    },
                    {
                      type: "action",
                      label: "Forward",
                      icon: sf("arrowshape.turn.up.right"),
                      onPress: () => reply("forward"),
                    },
                    ...(unsubscribe
                      ? [
                          {
                            type: "action" as const,
                            label: "Unsubscribe",
                            icon: sf("hand.raised"),
                            onPress: () => void runUnsubscribe(),
                          },
                        ]
                      : []),
                    {
                      type: "submenu",
                      label: "",
                      inline: true,
                      items: actions.menuItems(row, leave),
                    },
                  ],
                },
              },
            ]
          : [],
    });
  });

  const glass = (label: string) =>
    glassSurface({ shape: "circle" }, label, namespace, {
      interactive: true,
      solid,
      fill: colors.raised,
    });
  const face = (symbol: SFSymbol) => (
    <ZStack modifiers={[frame({ width: 48, height: 48 }), contentShape(shapes.circle())]}>
      <SwiftImage systemName={symbol} size={19} color={colors.text} />
    </ZStack>
  );
  const button = (symbol: SFSymbol, label: string, onPress: () => void) => (
    <Button
      key={label}
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(label),
        accessibilityIdentifier(`reader-${label}`),
        ...glass(label),
      ]}
    >
      {face(symbol)}
    </Button>
  );
  const act = (run: (row: MessageSummary) => void) => () => {
    if (!row) return;
    run(row);
    leave();
  };

  const threadLabels = new Set(row?.threadLabelIds ?? row?.labelIds ?? []);
  const own = labels.filter((l) => l.type === "user" && threadLabels.has(l.id));
  const archives = row ? actions.canArchive(row) : false;
  const trashed = threadLabels.has("TRASH") || labelId === "TRASH";
  const unarchives = !archives && (threadLabels.has("ARCHIVE") || trashed);
  const fullWidth = flag(ui, "otter:full-width-messages", false);

  return (
    <View style={[styles.fill, { backgroundColor: colors.canvas }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        testID="thread"
      >
        <Text style={[styles.subject, { color: colors.text }]} selectable>
          {subject}
        </Text>
        <View style={styles.labels}>
          <View style={[styles.dot, { backgroundColor: mailbox?.color ?? colors.accent }]} />
          <Text style={[styles.mailbox, { color: colors.secondary }]}>
            {mailbox?.displayName ?? mailbox?.name ?? mailbox?.email ?? ""}
          </Text>
          {own.map((l) => (
            <View
              key={l.id}
              style={[
                styles.label,
                {
                  backgroundColor: `${(l.color?.backgroundColor ?? colors.secondary).slice(0, 7)}2E`,
                },
              ]}
            >
              <Text style={[styles.labelText, { color: colors.text }]}>{leaf(l.name)}</Text>
            </View>
          ))}
        </View>
        {AsyncResult.isFailure(result) ? (
          <Text style={{ color: colors.secondary, paddingHorizontal: 20 }}>
            {String(result.cause)}
          </Text>
        ) : null}
        {messages.map((message) => {
          const open = isOpen(message, last?.id, expanded);
          return (
            <MessageView
              key={message.id}
              accountId={accountId}
              message={message}
              open={open}
              mine={mine}
              colors={colors}
              fullWidth={fullWidth}
              translationSettings={translationSettings}
              onTap={() => {
                if (message.labelIds.includes("DRAFT")) {
                  navigation.navigate("Compose", {
                    accountId,
                    mode: "draft",
                    messageId: message.id,
                    threadId,
                  });
                } else if (!open) setExpanded((e) => new Set([...e, message.id]));
              }}
              onTrash={() => {
                void operations.trashMessage(accountId, message.id).catch(() => {});
                leave();
              }}
            />
          );
        })}
      </ScrollView>
      <Host
        matchContents={{ vertical: true }}
        pointerEvents="box-none"
        style={[styles.actions, { bottom: insets.bottom + 4 }]}
      >
        <Namespace id={namespace}>
          <GlassEffectContainer spacing={10} modifiers={[padding({ horizontal: 20 })]}>
            <HStack spacing={10}>
              {archives
                ? button("archivebox", "Archive", act(actions.archive))
                : unarchives
                  ? button("tray.and.arrow.down", "Move to Inbox", act(actions.moveToInbox))
                  : null}
              {trashed
                ? button("trash", "Delete forever", act(actions.deleteForever))
                : button("trash", "Trash", act(actions.trash))}
              <Spacer minLength={0} />
              <Menu
                label={face("arrowshape.turn.up.left")}
                onPrimaryAction={() => reply("reply")}
                modifiers={[
                  accessibilityLabel("Reply"),
                  accessibilityIdentifier("reader-Reply"),
                  ...glass("Reply"),
                ]}
              >
                <Button
                  label="Reply"
                  systemImage="arrowshape.turn.up.left"
                  onPress={() => reply("reply")}
                />
                <Button
                  label="Reply all"
                  systemImage="arrowshape.turn.up.left.2"
                  onPress={() => reply("replyAll")}
                />
                <Button
                  label="Forward"
                  systemImage="arrowshape.turn.up.right"
                  onPress={() => reply("forward")}
                />
              </Menu>
            </HStack>
          </GlassEffectContainer>
        </Namespace>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingTop: 8, gap: 20, paddingBottom: 120 },
  subject: { fontSize: 22, fontWeight: "600", paddingHorizontal: 20, marginBottom: -12 },
  labels: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 20,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  mailbox: { fontSize: 13, marginRight: 2 },
  label: { paddingHorizontal: 7, height: 20, borderRadius: 10, justifyContent: "center" },
  labelText: { fontSize: 11, fontWeight: "500" },
  actions: { position: "absolute", left: 0, right: 0 },
});
