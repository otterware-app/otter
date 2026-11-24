import { senderFirstName, senderLabel } from "@otter/client/mail/address";
import type { MessageSummary } from "@otter/client/mail/types";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { CodeCard } from "./code-card.tsx";
import { decodeEntities } from "./compose-text.ts";
import { shortMailDate } from "./format-date.ts";
import { SenderAvatar } from "./sender-avatar.tsx";
import { useVerificationCode } from "./verification-code.ts";

const pan = Gesture.Pan;

type SwipeAction = { title: string; icon: IconName; run: () => void };

export function MailRow({
  message,
  account,
  label,
  own,
  codeAccount,
  trashCode,
  flagged,
  fullWidth,
  selected,
  onSelect,
  leading,
  trailing,
}: {
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
}) {
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
      ? [
          ...new Set(
            senders.map(({ name, email }) => (mine(email) ? "me" : senderFirstName(name, email))),
          ),
        ].join(", ")
      : mine(lastSender.email)
        ? "me"
        : senderLabel(lastSender.name, lastSender.email);
  const subject = message.subject || "(No subject)";
  const snippet = decodeEntities(message.snippet);
  const code = useVerificationCode(codeAccount, message);
  const selecting = selected !== undefined;
  const drag = useSharedValue(0);
  const width = useSharedValue(0);
  const startSwipe = leading?.run;
  const endSwipe = trailing?.run;
  const swipe = pan()
    .enabled(!selecting && Boolean(leading || trailing))
    .activeOffsetX([-14, 14])
    .failOffsetY([-10, 10])
    .onUpdate(({ translationX }) => {
      "worklet";
      drag.set(
        translationX > 0
          ? startSwipe
            ? translationX
            : translationX * 0.12
          : endSwipe
            ? translationX
            : translationX * 0.12,
      );
    })
    .onEnd(({ velocityX }) => {
      "worklet";
      const threshold = Math.min(120, width.get() * 0.38);
      const projected = drag.get() + velocityX * 0.08;
      if (startSwipe && drag.get() > 36 && projected >= threshold) scheduleOnRN(startSwipe);
      if (endSwipe && drag.get() < -36 && projected <= -threshold) scheduleOnRN(endSwipe);
    })
    .onFinalize(() => {
      "worklet";
      drag.set(withSpring(0, { damping: 24, stiffness: 280 }));
    });
  const position = useAnimatedStyle(() => ({ transform: [{ translateX: drag.get() }] }));
  const leadingStyle = useAnimatedStyle(() => ({ opacity: drag.get() > 0 ? 1 : 0 }));
  const trailingStyle = useAnimatedStyle(() => ({ opacity: drag.get() < 0 ? 1 : 0 }));

  function open() {
    if (selecting) return onSelect?.();
    if (label === "DRAFT" && message.labelIds.includes("DRAFT")) {
      router.push({
        pathname: "/compose",
        params: { account, draft: message.id, thread: message.threadId },
      });
      return;
    }
    router.push({
      pathname: "/mail/[account]/[label]/[thread]",
      params: { account, label, thread: message.threadId },
    });
  }

  return (
    <View
      onLayout={({ nativeEvent }) => {
        width.set(nativeEvent.layout.width);
      }}
      style={styles.shell}
    >
      {leading && !selecting && (
        <Animated.View
          style={[styles.swipeAction, styles.leading, leadingStyle, { backgroundColor: "#5856d6" }]}
        >
          <Icon name={leading.icon} color="primaryForeground" size={20} />
          <Text size="sm" color="primaryForeground">
            {leading.title}
          </Text>
        </Animated.View>
      )}
      {trailing && !selecting && (
        <Animated.View
          style={[
            styles.swipeAction,
            styles.trailing,
            trailingStyle,
            { backgroundColor: theme.colors.error },
          ]}
        >
          <Icon name={trailing.icon} tint={theme.scheme === "dark" ? "#000" : "#fff"} size={20} />
          <Text size="sm" style={{ color: theme.scheme === "dark" ? "#000" : "#fff" }}>
            {trailing.title}
          </Text>
        </Animated.View>
      )}
      <GestureDetector gesture={swipe}>
        <Animated.View
          style={[
            position,
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
              if (nativeEvent.actionName === "leading") leading?.run();
              if (nativeEvent.actionName === "trailing") trailing?.run();
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
                <SenderAvatar email={lastSender.email} name={lastSender.name} />
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
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { overflow: "hidden" },
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
  swipeAction: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 9,
  },
  leading: { justifyContent: "flex-start" },
  trailing: { justifyContent: "flex-end" },
});
