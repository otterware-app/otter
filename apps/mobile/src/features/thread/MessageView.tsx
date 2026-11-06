import { HtmlView } from "@otter-mail/mobile-html-view";
import { files } from "@otter-mail/mobile-files";
import { translation } from "@otter-mail/mobile-translation";
import * as Clipboard from "expo-clipboard";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { messageCards } from "../../extensions/registry";
import { core } from "../../state/core";
import type { MessageDetail } from "../../state/mail";
import type { TranslationSettings } from "../../state/translation";
import { SenderAvatar } from "../home/SenderAvatar";
import { relativeDate, type Palette } from "../theme";
import { fileSize, htmlText, recipientsLine, sameLanguage, splitQuote } from "./reader";

type Attachment = NonNullable<MessageDetail["attachments"]>[number];

/** Translation detects at this confidence or better (the web's). */
const MIN_CONFIDENCE = 0.6;

const isWords = (text: string) => /\p{L}/u.test(text);

/** A plain-text message, line by line, its quote marks kept (the web's translatePlain). */
async function translatePlain(text: string, source: string, target: string) {
  const lines = text.split("\n");
  const slots = lines.flatMap((line, i) => {
    const [, prefix = "", rest = line] = /^(\s*(?:>\s*)*)(.*)$/.exec(line) ?? [];
    return isWords(rest) ? [{ i, prefix, text: rest.trim() }] : [];
  });
  const unique = [...new Set(slots.map((s) => s.text))];
  if (!unique.length) return null;
  const result = await core.invoke<{ status: string; texts: string[] }>("translation:translate", {
    segments: unique,
    source,
    target,
  });
  if (result.status !== "ok") return null;
  const byText = new Map(unique.map((t, i) => [t, result.texts[i] ?? t]));
  for (const slot of slots) lines[slot.i] = slot.prefix + (byText.get(slot.text) ?? slot.text);
  return lines.join("\n");
}

/** The files to list: everything but the images an HTML body shows inline. */
export function listedAttachments(message: MessageDetail): Attachment[] {
  const html = message.bodyHtml?.toLowerCase() ?? "";
  return (message.attachments ?? []).filter(
    (a) => !a.contentId || !html.includes(`cid:${a.contentId.toLowerCase()}`),
  );
}

/**
 * One message of a conversation (the Swift app's MessageView). Folded, it's who
 * and a line of it; open, the whole message: its HTML (remote images load,
 * as in the Swift app), or its text with the quote behind "…"; translated when
 * Settings › Translation says so; its files to open, share or save. Holding
 * its header offers Translate and Copy.
 */
export function MessageView({
  accountId,
  message,
  open,
  mine,
  colors,
  fullWidth,
  translationSettings,
  onTap,
  onTrash,
}: {
  accountId: string;
  message: MessageDetail;
  open: boolean;
  mine: ReadonlySet<string>;
  colors: Palette;
  fullWidth: boolean;
  translationSettings: TranslationSettings;
  onTap: () => void;
  onTrash: () => void;
}) {
  const [showQuote, setShowQuote] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const draft = message.labelIds.includes("DRAFT");
  const plain = (message.bodyText ?? message.snippet ?? "").trim();
  const text = message.bodyHtml ? htmlText(message.bodyHtml) : plain;
  const fromMe = mine.has(message.fromEmail.toLowerCase());
  const { autoTranslate, readLanguages } = translationSettings;

  // The Swift app translates plain-text messages by themselves; HTML ones on asking (Translate).
  useEffect(() => {
    if (!open || !autoTranslate || message.bodyHtml || translated || plain.length < 12) return;
    let cancelled = false;
    void (async () => {
      const found = await core.invoke<{ language: string | null; confidence: number }>(
        "translation:detect",
        { text: `${message.subject}\n${plain}`.slice(0, 3000) },
      );
      const source = found.language;
      if (!source || found.confidence < MIN_CONFIDENCE) return;
      if (readLanguages.some((l) => sameLanguage(l, source))) return;
      const result = await translatePlain(plain, source, readLanguages[0]!);
      if (!cancelled && result) setTranslated(result);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, autoTranslate, readLanguages, message, plain, translated]);

  const actions = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ["Translate", "Copy", "Cancel"], cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) void translation.present(text).catch(() => {});
        else if (i === 1) void Clipboard.setStringAsync(text);
      },
    );

  const openAttachment = async (attachment: Attachment, share: boolean) => {
    if (opening) return;
    setOpening(attachment.id);
    try {
      const data = await core.invoke<{ base64: string }>("gmail:getAttachmentData", {
        accountId,
        messageId: message.id,
        attachmentId: attachment.id,
      });
      await (share ? files.share : files.preview)(attachment.filename, data.base64);
    } catch (error) {
      Alert.alert(
        "Couldn't open attachment",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setOpening(null);
    }
  };

  const inset = fullWidth ? 0 : 20;
  const quote = message.bodyHtml ? null : splitQuote(plain);
  const listed = listedAttachments(message);

  return (
    <View style={styles.message} testID={`message-${message.id}`}>
      <Pressable
        onPress={onTap}
        onLongPress={actions}
        style={styles.header}
        accessibilityRole="button"
        accessibilityHint={open ? "Touch and hold for Translate or Copy" : "Shows the message"}
      >
        <SenderAvatar
          accountId={accountId}
          email={message.fromEmail}
          name={message.fromName}
          size={34}
        />
        <View style={styles.lines}>
          <View style={styles.top}>
            <Text style={[styles.from, { color: colors.text }]} numberOfLines={1}>
              {fromMe ? "Me" : message.fromName || message.fromEmail}
            </Text>
            {draft ? <Text style={[styles.draft, { color: colors.error }]}>Draft</Text> : null}
            <Text style={[styles.date, { color: colors.secondary }]}>
              {relativeDate(message.date)}
            </Text>
          </View>
          <Text style={[styles.sub, { color: colors.secondary }]} numberOfLines={1}>
            {open ? recipientsLine(message.to, message.cc, mine) : message.snippet}
          </Text>
        </View>
      </Pressable>
      {open ? (
        <>
          {messageCards.map((Card, i) => (
            <View key={i} style={{ paddingHorizontal: 20 }}>
              <Card
                accountId={accountId}
                summary={{ id: message.id, threadId: message.threadId, subject: message.subject }}
                detail={message}
                onTrash={onTrash}
              />
            </View>
          ))}
          {translated && !showOriginal ? (
            <Text style={[styles.body, { color: colors.text, marginHorizontal: inset }]} selectable>
              {translated}
            </Text>
          ) : message.bodyHtml ? (
            <View
              style={[styles.html, { marginHorizontal: inset, borderRadius: fullWidth ? 0 : 14 }]}
            >
              <HtmlView
                html={message.bodyHtml}
                remoteImages
                onLink={(url) => void Linking.openURL(url)}
                loadImage={async (cid) => {
                  const attachment = message.attachments?.find(
                    (a) => a.contentId?.toLowerCase() === cid.toLowerCase(),
                  );
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
            <>
              <Text
                style={[styles.body, { color: colors.text, marginHorizontal: inset }]}
                selectable
                dataDetectorType="all"
              >
                {showQuote || !quote?.quote ? plain : quote.body}
              </Text>
              {quote?.quote && !showQuote ? (
                <Pressable
                  onPress={() => setShowQuote(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Show quoted text"
                  style={[
                    styles.quote,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  testID="show-quote"
                >
                  <SymbolView name="ellipsis" size={14} tintColor={colors.secondary} />
                </Pressable>
              ) : null}
            </>
          )}
          {translated ? (
            <Pressable onPress={() => setShowOriginal((s) => !s)} style={styles.translated}>
              <Text style={{ color: colors.secondary, fontSize: 13 }}>
                {showOriginal ? "Show translation" : "Translated · Show original"}
              </Text>
            </Pressable>
          ) : null}
          {listed.length ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.attachments}
            >
              {listed.map((a) => (
                <AttachmentChip
                  key={a.id}
                  attachment={a}
                  colors={colors}
                  loading={opening === a.id}
                  onPress={() => void openAttachment(a, false)}
                  onLongPress={() =>
                    ActionSheetIOS.showActionSheetWithOptions(
                      {
                        title: a.filename,
                        options: ["Share or Save", "Cancel"],
                        cancelButtonIndex: 1,
                      },
                      (i) => i === 0 && void openAttachment(a, true),
                    )
                  }
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const symbolFor = (mimeType: string): SFSymbol =>
  mimeType.startsWith("image/")
    ? "photo"
    : mimeType === "application/pdf"
      ? "doc.richtext"
      : mimeType === "text/calendar"
        ? "calendar"
        : mimeType === "text/csv"
          ? "tablecells"
          : "doc";

/** the Swift app's AttachmentChip: its kind, name and size. */
export function AttachmentChip({
  attachment,
  colors,
  loading = false,
  onPress,
  onLongPress,
  onRemove,
}: {
  attachment: { filename: string; mimeType: string; size: number };
  colors: Palette;
  loading?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  onRemove?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${attachment.filename}, ${fileSize(attachment.size)}`}
      accessibilityHint={onLongPress ? "Touch and hold to share or save" : undefined}
      style={[styles.chip, { borderColor: colors.border }]}
    >
      <View style={[styles.chipIcon, { backgroundColor: colors.surface }]}>
        {loading ? (
          <ActivityIndicator />
        ) : (
          <SymbolView
            name={symbolFor(attachment.mimeType)}
            size={18}
            tintColor={colors.secondary}
          />
        )}
      </View>
      <View style={styles.chipText}>
        <Text style={[styles.chipName, { color: colors.text }]} numberOfLines={1}>
          {attachment.filename}
        </Text>
        <Text style={{ color: colors.secondary, fontSize: 12 }}>{fileSize(attachment.size)}</Text>
      </View>
      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={8}
          accessibilityLabel={`Remove ${attachment.filename}`}
        >
          <SymbolView name="xmark.circle.fill" size={18} tintColor={colors.secondary} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  message: { gap: 12 },
  header: { flexDirection: "row", gap: 12, paddingHorizontal: 20, alignItems: "flex-start" },
  lines: { flex: 1, gap: 2 },
  top: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  from: { flexShrink: 1, fontSize: 15, fontWeight: "600" },
  draft: { fontSize: 15 },
  date: { marginLeft: "auto", fontSize: 13, fontVariant: ["tabular-nums"] },
  sub: { fontSize: 15 },
  html: { overflow: "hidden", backgroundColor: "#FFFFFF" },
  body: { fontSize: 16, lineHeight: 22 },
  quote: {
    marginHorizontal: 20,
    width: 36,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  translated: { paddingHorizontal: 20 },
  attachments: { gap: 8, paddingHorizontal: 20 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 6,
    paddingRight: 14,
    maxWidth: 260,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: { flexShrink: 1, gap: 1 },
  chipName: { fontSize: 15, fontWeight: "500" },
});
