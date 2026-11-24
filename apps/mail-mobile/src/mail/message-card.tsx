import { mailApi } from "@otter/client/mail/api";
import { parseAddressEntry, splitAddressList } from "@otter/client/mail/address";
import { formatFullDate } from "@otter/client/mail/format";
import { useMessage } from "@otter/client/mail/hooks";
import { splitPlainQuote } from "@otter/client/mail/reply";
import type { MessageDetail, MessageSummary } from "@otter/client/mail/types";
import { Button } from "@otter/ui-native/components/button";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ActionSheetIOS, Alert, Pressable, StyleSheet, View } from "react-native";

import { decodeEntities, htmlToPlain, plainToHtml } from "./compose-text.ts";
import { shortMailDate } from "./format-date.ts";
import HTMLBody from "./html-body.tsx";
import { mailFailure } from "./mail-actions.tsx";
import { mailPointer, sendToAgent } from "./send-to-agent.ts";
import { SenderAvatar } from "./sender-avatar.tsx";
import { NativeMailTranslation, useTranslationSettings } from "./translation.ts";
import { useEmailLinks } from "./use-email-links.ts";

export type ReplyMode = "reply" | "replyAll" | "forward";

type MessageProps = {
  message: MessageSummary;
  account: string;
  email: string;
  scope: string;
  opened: boolean;
  toggle: () => void;
  agents: boolean;
  fullWidth: boolean;
  onCompose: (mode: ReplyMode | "draft", message: MessageSummary) => void;
};

export function MessageCard(props: MessageProps) {
  if (props.opened) return <MessageBody {...props} />;
  return <MessageHeader account={props.account} message={props.message} onPress={props.toggle} />;
}

function MessageHeader({
  account,
  message,
  to,
  onPress,
  onMenu,
}: {
  account: string;
  message: MessageSummary;
  to?: string;
  onPress: () => void;
  onMenu?: () => void;
}) {
  const sender = message.fromName || message.fromEmail;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sender}, ${formatFullDate(message.date)}${to ? `, to ${to}` : ""}`}
      accessibilityState={{ expanded: to !== undefined }}
      accessibilityActions={onMenu ? [{ name: "actions", label: "Message actions" }] : undefined}
      onAccessibilityAction={onMenu}
      onPress={onPress}
      onLongPress={onMenu}
      style={styles.sender}
    >
      <SenderAvatar account={account} email={message.fromEmail} name={sender} size={34} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.senderTitle}>
          <Text weight="semibold" size="md" numberOfLines={1} style={{ flex: 1 }}>
            {sender}
          </Text>
          <Text size="body" color="mutedForeground" tabular>
            {shortMailDate(message.date)}
          </Text>
        </View>
        <Text color="mutedForeground" size="md" numberOfLines={1}>
          {to === undefined ? decodeEntities(message.snippet) : to ? `to ${to}` : ""}
        </Text>
      </View>
    </Pressable>
  );
}

function MessageBody({
  message,
  account,
  email,
  scope,
  agents,
  fullWidth,
  onCompose,
  toggle,
}: MessageProps) {
  const theme = useTheme();
  const detail = useMessage(account, message.id);
  const [showAddress, setShowAddress] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [selection, setSelection] = useState("");
  const [busyAttachment, setBusyAttachment] = useState<string>();
  const openLink = useEmailLinks(scope);
  const attachments = detail.data?.attachments;
  const translationSettings = useTranslationSettings().data;
  const [translationOpen, setTranslationOpen] = useState(false);
  const [translated, setTranslated] = useState<{
    text: string;
    source: string;
    languages: string[];
  }>();
  const [showOriginal, setShowOriginal] = useState(false);
  const sourceText = detail.data?.bodyText || htmlToPlain(detail.data?.bodyHtml ?? "");
  const changedLanguage =
    translated?.languages.join() !== translationSettings?.readLanguages.join();
  const translation =
    translated?.source === sourceText && !changedLanguage && translationSettings?.autoTranslate
      ? translated.text
      : undefined;
  const inline = useQuery({
    queryKey: ["mobile:inlineImages", account, message.id],
    enabled: Boolean(detail.data?.bodyHtml && attachments?.some(({ contentId }) => contentId)),
    queryFn: async () =>
      Object.fromEntries(
        (
          await Promise.allSettled(
            (attachments ?? [])
              .filter(({ contentId }) => contentId)
              .map(async ({ id, mimeType, contentId }) => {
                const { base64 } = await mailApi.getAttachmentData({
                  accountId: account,
                  messageId: message.id,
                  attachmentId: id,
                });
                return [
                  contentId!.replace(/^<|>$/g, "").toLowerCase(),
                  `data:${mimeType};base64,${base64}`,
                ] as const;
              }),
          )
        ).flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : [])),
      ),
    staleTime: 5 * 60_000,
  });
  const unsubscribe = useQuery({
    queryKey: ["gmail:unsubscribe", account, message.id],
    queryFn: () => mailApi.getUnsubscribe(account, message.id, message.fromEmail),
    enabled: detail.isSuccess,
  });
  const onSelection = useCallback(async (text: string) => {
    setSelection(text);
  }, []);

  function unsubscribeConfirm() {
    Alert.alert("Unsubscribe?", `Unsubscribe from mail from ${message.fromEmail}?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unsubscribe",
        onPress: () => {
          void mailApi
            .unsubscribe(account, message.id)
            .then(async (result) => {
              if ("openUrl" in result) await openLink(result.openUrl);
              else Alert.alert("Unsubscribed");
              await unsubscribe.refetch();
            })
            .catch(mailFailure);
        },
      },
    ]);
  }

  function messageMenu() {
    const draft = message.labelIds.includes("DRAFT");
    const options: { title: string; run: () => void }[] = draft
      ? [{ title: "Edit draft", run: () => onCompose("draft", message) }]
      : [
          { title: "Reply", run: () => onCompose("reply", message) },
          { title: "Reply all", run: () => onCompose("replyAll", message) },
          { title: "Forward", run: () => onCompose("forward", message) },
        ];
    options.push({
      title: showAddress ? "Hide details" : "Show details",
      run: () => setShowAddress(!showAddress),
    });
    if (sourceText.trim())
      options.push({ title: "Translate", run: () => setTranslationOpen(true) });
    if (agents)
      options.push({
        title: selection ? "Send selection to agent" : "Send to agent",
        run: () => sendToAgent([mailPointer(email, message, selection)]),
      });
    if (unsubscribe.data && !unsubscribe.data.unsubscribed)
      options.push({ title: "Unsubscribe", run: unsubscribeConfirm });
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Message actions",
        options: [...options.map(({ title }) => title), "Cancel"],
        cancelButtonIndex: options.length,
      },
      (index) => options[index]?.run(),
    );
  }

  async function attachmentFile(file: MessageDetail["attachments"][number], share: boolean) {
    if (busyAttachment) return;
    setBusyAttachment(file.id);
    try {
      const request = {
        accountId: account,
        messageId: message.id,
        attachmentId: file.id,
        filename: file.filename,
      };
      if (share) await mailApi.getAttachment({ ...request, mimeType: file.mimeType });
      else await mailApi.openAttachment(request);
    } catch (error) {
      mailFailure(error);
    } finally {
      setBusyAttachment(undefined);
    }
  }

  const recipients = splitAddressList(detail.data?.to ?? message.to).map(parseAddressEntry);
  const to = recipients
    .map((recipient) =>
      recipient.email.toLowerCase() === email.toLowerCase()
        ? "me"
        : recipient.name || recipient.email,
    )
    .join(", ");
  const header = (
    <MessageHeader
      account={account}
      message={message}
      to={to}
      onPress={message.labelIds.includes("DRAFT") ? () => onCompose("draft", message) : toggle}
      onMenu={messageMenu}
    />
  );
  if (detail.isPending)
    return (
      <View>
        {header}
        <Spinner />
      </View>
    );
  if (detail.isError)
    return (
      <View>
        {header}
        <Button
          title="Retry loading message"
          variant="ghost"
          onPress={() => void detail.refetch()}
        />
      </View>
    );
  if (!detail.data)
    return (
      <View>
        {header}
        <Text size="body" color="mutedForeground" style={{ paddingHorizontal: 20 }}>
          This message is no longer in the mailbox.
        </Text>
      </View>
    );
  const body = detail.data;
  const [text, quote] = splitPlainQuote((body.bodyText ?? "").replace(/\r\n/g, "\n"));
  const files = body.attachments.filter(
    (file) =>
      !file.contentId ||
      !body.bodyHtml
        ?.toLowerCase()
        .includes(`cid:${file.contentId.replace(/^<|>$/g, "").toLowerCase()}`),
  );

  return (
    <View>
      {header}
      {showAddress && (
        <View style={{ paddingBottom: 8, paddingHorizontal: 20, gap: 4 }}>
          <Text size="sm" selectable>
            From {body.fromEmail}
          </Text>
          <Text size="sm" selectable>
            To {body.to}
          </Text>
          {body.cc ? (
            <Text size="sm" selectable>
              Cc {body.cc}
            </Text>
          ) : null}
          {body.bcc ? (
            <Text size="sm" selectable>
              Bcc {body.bcc}
            </Text>
          ) : null}
        </View>
      )}
      <View style={{ marginTop: 12, paddingHorizontal: fullWidth ? 0 : 20 }}>
        {translation && !showOriginal ? (
          <Text selectable size="lg" style={{ lineHeight: 23 }}>
            {translation}
          </Text>
        ) : body.bodyHtml || agents ? (
          <HTMLBody
            html={
              body.bodyHtml ??
              plainToHtml(showQuote ? (body.bodyText ?? text) : text || body.snippet)
            }
            light={theme.scheme === "light"}
            colors={{
              foreground: theme.colors.foreground,
              link: theme.colors.primary,
              border: theme.colors.border,
            }}
            inlineImages={inline.data ?? emptyImages}
            onLink={openLink}
            onSelection={agents ? onSelection : undefined}
            dom={{
              matchContents: true,
              scrollEnabled: false,
              automaticallyAdjustContentInsets: false,
              allowFileAccess: false,
              allowFileAccessFromFileURLs: false,
              dataDetectorTypes: ["phoneNumber", "link"],
            }}
          />
        ) : (
          <Text selectable size="lg" style={{ lineHeight: 23 }}>
            {text || body.snippet}
          </Text>
        )}
        {translation && (
          <Button
            title={showOriginal ? "Show translation" : "Translated · Show original"}
            variant="ghost"
            size="sm"
            onPress={() => setShowOriginal((value) => !value)}
          />
        )}
        {(translationOpen || (translationSettings?.autoTranslate && !body.bodyHtml)) && (
          <NativeMailTranslation
            style={styles.translationAnchor}
            pointerEvents="none"
            text={sourceText}
            presented={translationOpen}
            automatic={Boolean(translationSettings?.autoTranslate && !body.bodyHtml)}
            languages={translationSettings?.readLanguages ?? []}
            onDismiss={() => setTranslationOpen(false)}
            onTranslated={({ nativeEvent }) => setTranslated(nativeEvent)}
          />
        )}
        {!body.bodyHtml && quote ? (
          <>
            <Button
              title={showQuote ? "Hide quoted text" : "Show quoted text"}
              variant="ghost"
              size="sm"
              onPress={() => setShowQuote(!showQuote)}
            />
            {showQuote && !agents ? (
              <Text selectable size="body" color="mutedForeground">
                {quote}
              </Text>
            ) : null}
          </>
        ) : null}
      </View>
      {selection && agents ? (
        <Button
          title="Send selection to agent"
          icon="sparkles"
          size="sm"
          variant="ghost"
          onPress={() => sendToAgent([mailPointer(email, message, selection)])}
        />
      ) : null}
      {files.length > 0 && (
        <View style={styles.files}>
          {files.map((file) => (
            <Pressable
              key={file.id}
              accessibilityRole="button"
              accessibilityLabel={file.filename}
              accessibilityHint="Opens preview. Touch and hold to share."
              accessibilityActions={[{ name: "share", label: "Share attachment" }]}
              onAccessibilityAction={() => void attachmentFile(file, true)}
              onLongPress={() => void attachmentFile(file, true)}
              onPress={() => void attachmentFile(file, false)}
              style={[styles.file, { borderColor: theme.colors.border }]}
            >
              {busyAttachment === file.id ? (
                <Spinner />
              ) : (
                <Icon name="paperclip" color="mutedForeground" />
              )}
              <Text size="sm" numberOfLines={1} style={{ flexShrink: 1 }}>
                {file.filename}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const emptyImages: Record<string, string> = {};

export const replyOptions: { id: ReplyMode; title: string; icon: IconName }[] = [
  { id: "reply", title: "Reply", icon: "arrowshape.turn.up.left" },
  { id: "replyAll", title: "Reply all", icon: "arrowshape.turn.up.left.2" },
  { id: "forward", title: "Forward", icon: "arrowshape.turn.up.right" },
];

const styles = StyleSheet.create({
  sender: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20,
  },
  senderTitle: { flexDirection: "row", alignItems: "baseline", gap: 7 },
  translationAnchor: { position: "absolute", width: 1, height: 1 },
  files: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 17, marginHorizontal: 20 },
  file: {
    maxWidth: "100%",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
