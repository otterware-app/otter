import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
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
import { HtmlView } from "@otter-mail/mobile-html-view";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useId, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { RootStack } from "../../App";
import { messageCards } from "../../extensions/registry";
import { operations } from "../../state/client";
import { core } from "../../state/core";
import {
  messageAtom,
  messageKey,
  threadAtom,
  threadKey,
  type MessageDetail,
} from "../../state/mail";
import { glassSurface, useReduceTransparency } from "../glass";
import { palette, relativeDate } from "../theme";

type Props = NativeStackScreenProps<RootStack, "Thread">;

const REMOTE_IMAGE = /<img[^>]+src\s*=\s*["']?https?:/i;

/**
 * A conversation, as apps/ios's ThreadView: its messages from the cache at
 * once, each body filling in as it arrives (in WebKit, otter-html-view),
 * remote images held back until asked for; compact glass
 * buttons instead of the bar, in one glass container: Archive and Trash, Reply
 * (a tap replies; holding it offers Reply All and Forward).
 */
export function ThreadScreen({ navigation, route }: Props) {
  const colors = palette(useColorScheme());
  const insets = useSafeAreaInsets();
  const { accountId, threadId, subject, labelId } = route.params;
  const result = useAtomValue(threadAtom(threadKey(accountId, threadId)));
  const messages = AsyncResult.getOrElse(result, () => [] as MessageSummary[]);
  const [showImages, setShowImages] = useState(false);
  // The bodies with remote images, as each arrives.
  const [remote, setRemote] = useState<ReadonlySet<string>>(new Set());
  const blocked = !showImages && remote.size > 0;
  const last = messages.at(-1);
  const namespace = useId();
  const solid = useReduceTransparency();

  useEffect(() => {
    if (messages.some((m) => m.unread)) {
      void operations
        .modifyThread({ accountId, threadId, removeLabelIds: ["UNREAD"] }, { quiet: true })
        .catch(() => {});
    }
  }, [messages, accountId, threadId]);

  const leave = (run: () => Promise<unknown>) => {
    navigation.goBack();
    void run().catch(() => {});
  };

  const reply = (mode: "reply" | "replyAll" | "forward") =>
    last && navigation.navigate("Compose", { accountId, mode, messageId: last.id, threadId });

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

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        testID="thread"
      >
        <Text style={[styles.subject, { color: colors.text }]} selectable>
          {subject}
        </Text>
        {blocked ? (
          <Pressable
            onPress={() => setShowImages(true)}
            style={[styles.banner, { backgroundColor: colors.card }]}
            testID="show-images"
          >
            <SymbolView name="photo" size={16} tintColor={colors.secondary} />
            <Text style={{ color: colors.secondary, flex: 1 }}>
              Images from the web are hidden.
            </Text>
            <Text style={{ color: colors.accent, fontWeight: "600" }}>Show</Text>
          </Pressable>
        ) : null}
        {AsyncResult.isFailure(result) ? (
          <Text style={{ color: colors.secondary }}>{String(result.cause)}</Text>
        ) : null}
        {messages.map((message) => (
          <Message
            key={message.id}
            accountId={accountId}
            summary={message}
            remoteImages={showImages}
            onRemoteImages={() => setRemote((ids) => new Set(ids).add(message.id))}
            onTrash={() => leave(() => operations.trashMessage(accountId, message.id))}
          />
        ))}
      </ScrollView>
      <Host
        matchContents={{ vertical: true }}
        pointerEvents="box-none"
        style={[styles.actions, { bottom: insets.bottom + 4 }]}
      >
        <Namespace id={namespace}>
          <GlassEffectContainer spacing={10} modifiers={[padding({ horizontal: 20 })]}>
            <HStack spacing={10}>
              {labelId !== "TRASH"
                ? button("archivebox", "Archive", () =>
                    leave(() =>
                      operations.archiveThread(
                        accountId,
                        threadId,
                        labelId && labelId !== "INBOX" ? labelId : "INBOX",
                      ),
                    ),
                  )
                : null}
              {button("trash", "Trash", () =>
                leave(() => operations.trashThread(accountId, threadId)),
              )}
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
                  label="Reply All"
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

function Message({
  accountId,
  summary,
  remoteImages,
  onRemoteImages,
  onTrash,
}: {
  accountId: string;
  summary: MessageSummary;
  remoteImages: boolean;
  onRemoteImages: () => void;
  onTrash: () => void;
}) {
  const colors = palette(useColorScheme());
  const atom = messageAtom(messageKey(accountId, summary.id));
  const result = useAtomValue(atom);
  const retry = useAtomRefresh(atom);
  // Gone from the server since it was cached: its snippet is all there is.
  const message: MessageDetail | null = AsyncResult.isSuccess(result)
    ? (result.value ?? summary)
    : null;
  const hasRemote = Boolean(message?.bodyHtml && REMOTE_IMAGE.test(message.bodyHtml));
  useEffect(() => {
    if (hasRemote) onRemoteImages();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- reported once per body
  }, [hasRemote]);
  return (
    <View style={[styles.message, { borderColor: colors.border }]}>
      <View style={styles.head}>
        <Text style={[styles.from, { color: colors.text }]} numberOfLines={1}>
          {summary.fromName || summary.fromEmail}
        </Text>
        <Text style={{ color: colors.secondary }}>{relativeDate(summary.date)}</Text>
      </View>
      {summary.to ? (
        <Text style={[styles.to, { color: colors.secondary }]} numberOfLines={1}>
          To {summary.to}
        </Text>
      ) : null}
      {message ? (
        <MessageBody
          accountId={accountId}
          message={message}
          remoteImages={remoteImages}
          onTrash={onTrash}
        />
      ) : AsyncResult.isFailure(result) ? (
        <View style={styles.pending}>
          <Text style={[styles.snippet, { color: colors.secondary }]}>
            Couldn't load this message.
          </Text>
          <Pressable onPress={retry} hitSlop={10} accessibilityRole="button" testID="message-retry">
            <Text style={{ color: colors.accent, fontWeight: "600" }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.pending} accessibilityLabel="Loading the message">
          <Text style={[styles.snippet, { color: colors.secondary }]} numberOfLines={3}>
            {summary.snippet}
          </Text>
          <ActivityIndicator size="small" color={colors.secondary} />
        </View>
      )}
    </View>
  );
}

function MessageBody({
  accountId,
  message,
  remoteImages,
  onTrash,
}: {
  accountId: string;
  message: MessageDetail;
  remoteImages: boolean;
  onTrash: () => void;
}) {
  const colors = palette(useColorScheme());
  const byCid = new Map(
    (message.attachments ?? [])
      .filter((a) => a.contentId)
      .map((a) => [a.contentId!.toLowerCase(), a]),
  );
  return (
    <>
      {messageCards.map((Card, i) => (
        <Card
          key={i}
          accountId={accountId}
          summary={{ id: message.id, threadId: message.threadId, subject: message.subject }}
          detail={message}
          onTrash={onTrash}
        />
      ))}
      {message.bodyHtml ? (
        <View style={styles.html}>
          <HtmlView
            html={message.bodyHtml}
            remoteImages={remoteImages}
            onLink={(url) => void Linking.openURL(url)}
            loadImage={async (cid) => {
              const attachment = byCid.get(cid.toLowerCase());
              if (!attachment) return null;
              const data = await core.invoke<{ base64: string }>("gmail:getAttachmentData", {
                accountId,
                messageId: message.id,
                attachmentId: attachment.id,
              });
              return { base64: data.base64, mimeType: attachment.mimeType };
            }}
          />
        </View>
      ) : (
        <Text style={[styles.body, { color: colors.text }]} selectable dataDetectorType="all">
          {(message.bodyText ?? message.snippet ?? "").trim()}
        </Text>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 120 },
  subject: { fontSize: 24, fontWeight: "700", marginBottom: 2 },
  banner: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: 14 },
  message: { borderBottomWidth: StyleSheet.hairlineWidth, paddingBottom: 14, gap: 6 },
  head: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  from: { flex: 1, fontSize: 16, fontWeight: "600" },
  to: { fontSize: 13 },
  html: { borderRadius: 14, overflow: "hidden", backgroundColor: "#FFFFFF" },
  body: { fontSize: 16, lineHeight: 22 },
  pending: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  snippet: { flex: 1, fontSize: 15, lineHeight: 21 },
  actions: { position: "absolute", left: 0, right: 0 },
});
