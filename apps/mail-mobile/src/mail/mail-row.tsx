import { senderFirstName, senderLabel } from "@otter/client/mail/address";
import type { MessageSummary } from "@otter/client/mail/types";
import { Icon } from "@otter/ui-native/components/icon";
import { SwipeRow, type SwipeAction } from "@otter/ui-native/components/swipe-row";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { CodeCard } from "./code-card.tsx";
import { decodeEntities } from "./compose-text.ts";
import { shortMailDate } from "./format-date.ts";
import { SenderAvatar } from "./sender-avatar.tsx";
import { useVerificationCode } from "./verification-code.ts";

function writersText(names: string[]): string {
  const writers = [...new Set(names)];
  return (writers.length > 3 ? [writers[0], "…", ...writers.slice(-2)] : writers).join(", ");
}

type RowProps = {
  message: MessageSummary;
  account: string;
  label: string;
  own?: string[];
  codeAccount?: string;
  trashCode?: () => void;
  flagged?: boolean;
  fullWidth?: boolean;
  selected?: boolean;
  onSelect?: () => void;
  leading?: SwipeAction;
  trailing?: SwipeAction;
  /** A `Link`'s, when the row is one: it opens the conversation from the row (its zoom). */
  onPress?: () => void;
};

/** `codeAccount`: the row may show a sign-in code from its message, read from that account. */
export function MailRow(props: RowProps) {
  return props.codeAccount ? (
    <RowWithCode {...props} codeAccount={props.codeAccount} />
  ) : (
    <Row {...props} code={null} />
  );
}

function RowWithCode(props: RowProps & { codeAccount: string }) {
  const code = useVerificationCode(props.codeAccount, props.message);
  return <Row {...props} code={code || null} />;
}

function Row({
  message,
  account,
  label,
  own,
  code,
  trashCode,
  flagged,
  fullWidth,
  selected,
  onSelect,
  leading,
  trailing,
  onPress,
}: RowProps & { code: string | null }) {
  const theme = useTheme();
  const router = useRouter();
  const unread = message.threadUnread ?? message.unread;
  const draft = message.labelIds.includes("DRAFT") && label === "DRAFT";
  const senders = message.threadSenders;
  const mine = (email: string) =>
    own?.some((address) => address.toLowerCase() === email.toLowerCase());
  const lastSender = senders?.at(-1) ?? { email: message.fromEmail, name: message.fromName };
  const from = draft
    ? "Draft"
    : senders && senders.length > 1
      ? writersText(
          senders.map(({ name, email }) => (mine(email) ? "me" : senderFirstName(name, email))),
        )
      : mine(lastSender.email)
        ? "me"
        : senderLabel(lastSender.name, lastSender.email);
  const subject = message.subject || "(No subject)";
  const snippet = decodeEntities(message.snippet);
  const selecting = selected !== undefined;

  function open() {
    if (selecting) return onSelect?.();
    if (label === "DRAFT" && message.labelIds.includes("DRAFT")) {
      router.push({
        pathname: "/compose",
        params: { account, draft: message.id, thread: message.threadId },
      });
      return;
    }
    if (onPress) return onPress();
    router.push({
      pathname: "/mail/[account]/[label]/[thread]",
      params: { account, label, thread: message.threadId },
    });
  }

  return (
    <SwipeRow
      item={message.threadId}
      square={fullWidth}
      leading={selecting ? undefined : leading}
      trailing={selecting ? undefined : trailing}
    >
      <View
        style={[
          fullWidth && styles.fullWidth,
          { backgroundColor: theme.colors.canvas, borderBottomColor: theme.colors.border },
        ]}
      >
        <View
          pointerEvents="none"
          style={[
            styles.rowShade,
            fullWidth && styles.fullShade,
            {
              backgroundColor: alpha(
                theme.colors.foreground,
                selected ? 0.14 : unread && !draft ? 0.1 : 0,
              ),
            },
          ]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityState={selecting ? { selected } : undefined}
          accessibilityLabel={[unread ? "Unread" : "", from, subject, snippet]
            .filter(Boolean)
            .join(", ")}
          accessibilityActions={[
            ...(onSelect && !selecting ? [{ name: "select", label: "Select conversation" }] : []),
            ...(leading && !selecting ? [{ name: "leading", label: leading.title }] : []),
            ...(trailing && !selecting ? [{ name: "trailing", label: trailing.title }] : []),
          ]}
          onAccessibilityAction={({ nativeEvent }) => {
            if (nativeEvent.actionName === "select") onSelect?.();
            if (nativeEvent.actionName === "leading") leading?.onPerform();
            if (nativeEvent.actionName === "trailing") trailing?.onPerform();
          }}
          onPress={open}
          onLongPress={selecting ? undefined : onSelect}
          style={({ pressed }) => [styles.row, pressed && { opacity: 0.65 }]}
        >
          {selecting && (
            <View style={styles.select}>
              <Icon
                name={selected ? "checkmark.circle.fill" : "circle"}
                size={20}
                color={selected ? "primary" : "mutedForeground"}
              />
            </View>
          )}
          <View style={styles.avatar}>
            {unread && !draft && (
              <View style={[styles.dot, { backgroundColor: theme.colors.primary }]} />
            )}
            {draft ? (
              <View
                style={[styles.draft, { backgroundColor: alpha(theme.colors.foreground, 0.06) }]}
              >
                <Icon name="square.and.pencil" size={14} color="mutedForeground" />
              </View>
            ) : (
              <SenderAvatar
                account={message.accountId ?? account}
                email={lastSender.email}
                name={lastSender.name}
              />
            )}
          </View>
          <View style={styles.lines}>
            <View style={styles.top}>
              <Text
                style={[styles.sender, !unread && { color: alpha(theme.colors.foreground, 0.7) }]}
                size="md"
                weight={unread ? "medium" : "regular"}
                numberOfLines={1}
              >
                {from}
              </Text>
              {(message.threadStarred ?? message.starred) && (
                <Icon name={flagged ? "flag.fill" : "star.fill"} size={11} />
              )}
              {message.hasAttachments && (
                <Icon name="paperclip" size={11} color="mutedForeground" />
              )}
              {(message.threadCount ?? 0) > 1 && (
                <Text size="body" color="mutedForeground" tabular>
                  {message.threadCount}
                </Text>
              )}
              <Text size="body" color="mutedForeground" tabular>
                {shortMailDate(message.date)}
              </Text>
            </View>
            <Text
              size="md"
              style={!unread && { color: alpha(theme.colors.foreground, 0.6) }}
              numberOfLines={1}
            >
              {subject}
            </Text>
            {snippet && !code ? (
              <Text size="md" color="mutedForeground" numberOfLines={1}>
                {draft ? "Draft · " : ""}
                {snippet}
              </Text>
            ) : null}
          </View>
        </Pressable>
        {code ? (
          <View style={styles.code}>
            <CodeCard key={code} code={code} onTrash={trashCode} />
          </View>
        ) : null}
      </View>
    </SwipeRow>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, paddingLeft: 24, paddingRight: 16, paddingVertical: 10 },
  code: { marginLeft: 72, marginRight: 16, marginBottom: 10 },
  fullWidth: { borderBottomWidth: StyleSheet.hairlineWidth },
  rowShade: { position: "absolute", left: 4, right: 4, top: 1, bottom: 1, borderRadius: 8 },
  fullShade: { ...StyleSheet.absoluteFill, borderRadius: 0 },
  avatar: { paddingTop: 2, width: 36, alignItems: "center" },
  dot: { position: "absolute", top: 17, left: -13, width: 6, height: 6, borderRadius: 3 },
  draft: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  select: { width: 24, alignItems: "center", justifyContent: "center" },
  lines: { flex: 1, gap: 2 },
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  sender: { flex: 1 },
});
