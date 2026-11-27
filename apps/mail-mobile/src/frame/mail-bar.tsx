import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { syncLabel, useLabels, useSyncStatus } from "@otter/client/mail/hooks";
import { ALL_MAIL_LABEL_ID } from "@otter/client/mail/label-names";
import type { MailLabel, MessageSummary } from "@otter/client/mail/types";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type EntryExitAnimationFunction,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Mailbox } from "../mail/mailboxes.ts";
import { MailboxAvatar, mailPlaces } from "./mail-places.tsx";

const pan = Gesture.Pan;

export function MailButton({
  title,
  icon,
  onPress,
  selected,
  onLongPress,
  disabled,
  children,
}: {
  title: string;
  icon?: IconName;
  onPress: () => void;
  selected?: boolean;
  onLongPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.button,
        selected && { backgroundColor: alpha(theme.colors.primary, 0.13) },
        { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      {children ??
        (icon && <Icon name={icon} size={21} color={selected ? "primary" : "foreground"} />)}
    </Pressable>
  );
}

export function MailBar({
  mailbox,
  label,
  reading,
  unread,
  onMailbox,
  onLabel,
  onFolders,
  onSearch,
  onCompose,
  onSettings,
  onRecents,
}: {
  mailbox: Mailbox;
  label: string;
  reading: boolean;
  unread: boolean;
  onMailbox: () => void;
  onLabel: (label: string) => void;
  onFolders: () => void;
  onSearch: () => void;
  onCompose: () => void;
  onSettings: () => void;
  onRecents: (label: string) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const mailboxName = getAccountDisplayName(mailbox.look);
  const caps = capabilitiesOf(mailbox.account);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (hover !== null) haptics.tap();
  }, [hover]);
  const hold = (label: string) => {
    haptics.impact();
    onRecents(label);
  };
  const tabs = [
    {
      title: "Inbox",
      icon: "tray.fill",
      run: () => onLabel("INBOX"),
      onHold: () => hold("INBOX"),
      dot: unread,
    },
    {
      title: caps.stars ? "Starred" : "Flagged",
      icon: caps.stars ? "star.fill" : "flag.fill",
      run: () => onLabel("STARRED"),
      onHold: () => hold("STARRED"),
    },
    { title: "All places", icon: "folder.fill", run: onFolders },
    { title: "Settings", icon: "gearshape.fill", run: onSettings },
  ] as const;
  const selected = label === "INBOX" ? 0 : label === "STARRED" ? 1 : 2;
  const lit = hover ?? selected;
  const pill = useSharedValue(lit);
  const shown = useSharedValue(reading ? 0 : 1);
  useEffect(() => {
    pill.set(withSpring(lit, { duration: 250, dampingRatio: 0.8 }));
  }, [lit, pill]);
  useEffect(() => {
    shown.set(withSpring(reading ? 0 : 1, { duration: 300, dampingRatio: 0.9 }));
  }, [reading, shown]);
  const cell = width / tabs.length;
  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pill.get() * cell + (cell - TAB_WIDTH) / 2 }],
  }));
  // The tabs tuck under the pill while you read on, and the pill settles down to the edge.
  const tuck = useAnimatedStyle(() => ({ height: TUCKED + (TABS_HEIGHT - TUCKED) * shown.get() }));
  const tabsStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateY: (1 - shown.get()) * 24 }],
  }));
  const perform = (index: number) => tabs[index]?.run();
  const indexAt = (x: number) => {
    "worklet";
    return Math.max(0, Math.min(3, Math.floor(x / (width / 4))));
  };
  const slide = pan()
    .enabled(width > 0)
    .activeOffsetX([-12, 12])
    .failOffsetY([-8, 8])
    .onUpdate(({ x }) => {
      "worklet";
      scheduleOnRN(setHover, indexAt(x));
    })
    .onEnd(({ x, translationX }) => {
      "worklet";
      const end = indexAt(x);
      if (end !== indexAt(x - translationX)) scheduleOnRN(perform, end);
    })
    .onFinalize(() => {
      "worklet";
      scheduleOnRN(setHover, null);
    });
  return (
    <View pointerEvents="box-none" style={[styles.bars, { paddingBottom: insets.bottom }]}>
      <View
        pointerEvents="none"
        style={[styles.barBacking, { backgroundColor: theme.colors.canvas }]}
      />
      <Glass interactive style={styles.pill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mailbox, ${mailboxName}`}
          accessibilityHint="Switches mailbox"
          onPress={onMailbox}
          style={styles.dockIcon}
        >
          <MailboxAvatar mailbox={mailbox.look} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search"
          onPress={onSearch}
          style={styles.search}
        >
          <Icon name="magnifyingglass" size={15} color="mutedForeground" />
          <Text size="lg" color="mutedForeground" numberOfLines={1} style={{ flex: 1 }}>
            Search {mailboxName}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Compose"
          onPress={onCompose}
          accessibilityActions={[{ name: "drafts", label: "Recent drafts" }]}
          onAccessibilityAction={() => onRecents("DRAFT")}
          onLongPress={() => hold("DRAFT")}
          style={[styles.dockIcon, { backgroundColor: theme.colors.foreground }]}
        >
          <Icon name="square.and.pencil" size={16} tint={theme.colors.canvas} />
        </Pressable>
      </Glass>
      <Animated.View pointerEvents={reading ? "none" : "box-none"} style={tuck}>
        <GestureDetector gesture={slide}>
          <Animated.View
            style={[styles.tabs, tabsStyle]}
            onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
          >
            {width > 0 && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.tabPill,
                  { backgroundColor: alpha(theme.colors.foreground, 0.07) },
                  pillStyle,
                ]}
              />
            )}
            {tabs.map((tab, index) => {
              const onHold = "onHold" in tab ? tab.onHold : undefined;
              return (
                <Pressable
                  key={tab.title}
                  accessibilityRole="button"
                  accessibilityLabel={tab.title}
                  accessibilityState={{ selected: lit === index }}
                  accessibilityActions={onHold ? [{ name: "recent", label: "Recent" }] : undefined}
                  onAccessibilityAction={onHold}
                  onPress={tab.run}
                  onLongPress={onHold}
                  style={styles.tab}
                >
                  <View style={styles.tabIcon}>
                    <Icon
                      name={tab.icon}
                      size={18}
                      color={lit === index ? "foreground" : "mutedForeground"}
                    />
                    {"dot" in tab && tab.dot ? (
                      <View style={[styles.inboxDot, { backgroundColor: theme.colors.primary }]} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </Animated.View>
        </GestureDetector>
      </Animated.View>
    </View>
  );
}

export function MailSheet({
  title,
  visible,
  onClose,
  children,
}: {
  title: string;
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} accessible={false} onPress={onClose} />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              backgroundColor: theme.colors.canvas,
              borderColor: theme.colors.border,
              marginBottom: insets.bottom + 8,
              marginTop: insets.top + 12,
            },
          ]}
        >
          <View style={styles.sheetHeader}>
            <Text size="lg" weight="semibold" accessibilityRole="header">
              {title}
            </Text>
            <MailButton title="Close" icon="xmark" onPress={onClose} />
          </View>
          <ScrollView
            bounces={false}
            contentContainerStyle={styles.sheetRows}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function SheetRow({
  title,
  icon,
  leading,
  detail,
  selected,
  onPress,
}: {
  title: string;
  icon?: IconName;
  leading?: ReactNode;
  detail?: string | number;
  selected?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.sheetRow,
        { backgroundColor: pressed ? theme.colors.card : "transparent" },
      ]}
    >
      {leading ?? (icon && <Icon name={icon} />)}
      <View style={{ flex: 1 }}>
        <Text size="base" numberOfLines={1}>
          {title}
        </Text>
        {typeof detail === "string" && (
          <Text size="sm" color="mutedForeground" numberOfLines={1}>
            {detail}
          </Text>
        )}
      </View>
      {typeof detail === "number" && detail > 0 && (
        <Text size="sm" color="mutedForeground">
          {detail}
        </Text>
      )}
      {selected && <Icon name="checkmark" color="primary" size={15} />}
    </Pressable>
  );
}

export function MailboxPicker({
  mailboxes,
  current,
  visible,
  onClose,
  onPick,
}: {
  mailboxes: Mailbox[];
  current: string;
  visible: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  return (
    <MailSheet title="Mailboxes" visible={visible} onClose={onClose}>
      {mailboxes.map(({ look, account }) => (
        <SheetRow
          key={look.id}
          title={getAccountDisplayName(look)}
          detail={account.signedOut ? `${look.email} · Signed out` : look.email}
          leading={<MailboxAvatar mailbox={look} />}
          selected={look.id === current}
          onPress={() => onPick(look.id)}
        />
      ))}
    </MailSheet>
  );
}

const spring = { duration: 400, dampingRatio: 0.85 };
const TABS_HEIGHT = 44;
const TUCKED = 8;
const TAB_WIDTH = 58;

/** Grows from the bar and back into it, as `.transition(.scale(scale: 0.6, anchor:))`. */
const cardIn: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.6 }] },
    animations: { opacity: withSpring(1, spring), transform: [{ scale: withSpring(1, spring) }] },
  };
};
const cardOut: EntryExitAnimationFunction = () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ scale: 1 }] },
    animations: {
      opacity: withSpring(0, spring),
      transform: [{ scale: withSpring(0.6, spring) }],
    },
  };
};

/** The bar's height over the safe area: the pill, and the tabs unless they're tucked away. */
export const barHeight = (reading: boolean) => (reading ? 56 : 92);

/** A card over the list, above the bar, at one end of it; tapping elsewhere closes it. */
export function MailPopover({
  visible,
  reading,
  align,
  onClose,
  children,
}: {
  visible: boolean;
  reading: boolean;
  align: "left" | "right";
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {visible && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
      )}
      {visible && (
        <Animated.View
          accessibilityViewIsModal
          entering={cardIn}
          exiting={cardOut}
          style={[
            styles.popover,
            {
              bottom: insets.bottom + barHeight(reading) + 20,
              alignItems: align === "left" ? "flex-start" : "flex-end",
              transformOrigin: `bottom ${align}`,
            },
          ]}
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}

function CardRow({
  title,
  detail,
  leading,
  count,
  dot,
  selected,
  indent = 0,
  compact,
  onPress,
}: {
  title: string;
  detail?: string;
  leading: ReactNode;
  count?: number;
  dot?: boolean;
  selected?: boolean;
  indent?: number;
  compact?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      accessibilityValue={count ? { text: `${count}` } : undefined}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.compactRow : styles.cardRow,
        { paddingLeft: (compact ? 10 : 12) + indent * 20 },
        selected && { backgroundColor: alpha(theme.colors.foreground, 0.08) },
        pressed && { opacity: 0.6 },
      ]}
    >
      {leading}
      <View style={{ flex: 1 }}>
        <Text
          size={compact || detail ? "md" : "lg"}
          weight={detail && selected ? "semibold" : "regular"}
          numberOfLines={1}
        >
          {title}
        </Text>
        {detail ? (
          <Text size="xs" color="mutedForeground" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {count ? (
        <Text size="body" weight="medium" color="mutedForeground" tabular>
          {count}
        </Text>
      ) : null}
      {dot ? <View style={[styles.unreadDot, { backgroundColor: theme.colors.primary }]} /> : null}
    </Pressable>
  );
}

function CardDivider() {
  const theme = useTheme();
  return <View style={[styles.cardDivider, { backgroundColor: theme.colors.border }]} />;
}

function MailboxChoice({
  mailbox: { look, account, alias },
  current,
  onPick,
}: {
  mailbox: Mailbox;
  current: boolean;
  onPick: () => void;
}) {
  const labels = useLabels(account.id, alias);
  return (
    <CardRow
      title={getAccountDisplayName(look)}
      detail={account.signedOut ? `${look.email} · Signed out` : look.email}
      leading={<MailboxAvatar mailbox={look} size={26} />}
      count={labels.data?.find(({ id }) => id === "INBOX")?.unread}
      selected={current}
      onPress={onPick}
    />
  );
}

/** The mailboxes to switch between, with what's unread in each inbox; Settings' list at the end. */
export function MailboxesCard({
  mailboxes,
  current,
  onPick,
  onManage,
}: {
  mailboxes: Mailbox[];
  current: string;
  onPick: (id: string) => void;
  onManage: () => void;
}) {
  return (
    <Glass shape={{ radius: 24 }} style={[styles.card, { width: 280 }]}>
      {mailboxes.map((mailbox) => (
        <MailboxChoice
          key={mailbox.look.id}
          mailbox={mailbox}
          current={mailbox.look.id === current}
          onPick={() => onPick(mailbox.look.id)}
        />
      ))}
      <CardDivider />
      <CardRow
        compact
        title="Mailboxes"
        leading={<Icon name="gearshape" size={15} style={styles.cardIcon} />}
        onPress={onManage}
      />
    </Glass>
  );
}

/** Drafts count what's in them; All Mail nothing; the rest what's unread. */
function placeCount(id: string, label: MailLabel | undefined) {
  if (id === "DRAFT") return label?.total;
  if (id === ALL_MAIL_LABEL_ID) return undefined;
  return label?.unread;
}

/** Every place in the mailbox, under its picture and name. */
export function PlacesCard({
  mailbox,
  labels,
  selected,
  onPick,
  onSync,
}: {
  mailbox: Mailbox;
  labels: MailLabel[];
  selected: string;
  onPick: (id: string) => void;
  onSync: () => void;
}) {
  const status = useSyncStatus(mailbox.account.id);
  const places = mailPlaces(mailbox.account, labels);
  const rows = (items: typeof places.system, nested = false) =>
    items.map(({ id, icon, title, label }) => (
      <CardRow
        key={id}
        title={nested ? (title.split("/").at(-1) ?? title) : title}
        indent={nested ? title.split("/").length - 1 : 0}
        leading={<Icon name={icon} tint={label?.color?.backgroundColor} style={styles.placeIcon} />}
        count={placeCount(id, label)}
        selected={id === selected}
        onPress={() => onPick(id)}
      />
    ));
  return (
    <Glass shape={{ radius: 28 }} style={styles.placesCard}>
      <View style={styles.placesHeader}>
        <MailboxAvatar mailbox={mailbox.look} size={24} />
        <Text size="lg" weight="semibold" numberOfLines={1} accessibilityRole="header">
          {getAccountDisplayName(mailbox.look)}
        </Text>
      </View>
      <CardDivider />
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <View style={{ padding: 8, gap: 2 }}>
          {rows(places.system)}
          {places.folders.length > 0 && (
            <Text size="body" color="mutedForeground" style={styles.section}>
              {places.folderTitle}
            </Text>
          )}
          {rows(places.folders, true)}
          {places.categories.length > 0 && (
            <Text size="body" color="mutedForeground" style={styles.section}>
              Categories
            </Text>
          )}
          {rows(places.categories)}
          {!mailbox.account.signedOut && (
            <>
              <CardDivider />
              <CardRow
                title="Sync now"
                detail={status ? syncLabel(status) : undefined}
                leading={<Icon name="arrow.clockwise" style={styles.placeIcon} />}
                onPress={onSync}
              />
            </>
          )}
        </View>
      </ScrollView>
    </Glass>
  );
}

/** What's newest in Inbox, Starred or Drafts, and a new message. */
export function RecentsCard({
  folder,
  messages,
  onOpen,
  onCompose,
}: {
  folder: string;
  messages: MessageSummary[];
  onOpen: (message: MessageSummary) => void;
  onCompose: () => void;
}) {
  return (
    <Glass shape={{ radius: 22 }} style={[styles.card, { width: 250 }]}>
      {messages.slice(0, 5).map((message) => (
        <CardRow
          key={message.threadId}
          compact
          title={message.subject || "(No subject)"}
          leading={
            <Icon
              name={folder === "DRAFT" ? "doc" : "envelope"}
              size={13}
              style={styles.recentIcon}
            />
          }
          dot={message.threadUnread ?? message.unread}
          onPress={() => onOpen(message)}
        />
      ))}
      <CardRow
        compact
        title="New message"
        leading={<Icon name="square.and.pencil" size={14} style={styles.recentIcon} />}
        onPress={onCompose}
      />
    </Glass>
  );
}

const styles = StyleSheet.create({
  bars: { position: "absolute", left: 0, right: 0, bottom: 0 },
  barBacking: { position: "absolute", left: 0, right: 0, top: 24, bottom: 0 },
  pill: { flexDirection: "row", alignItems: "center", padding: 5, gap: 4, marginHorizontal: 16 },
  dockIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  search: {
    flex: 1,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 6,
    gap: 8,
  },
  tabs: {
    height: 40,
    marginTop: 4,
    marginHorizontal: 32,
    flexDirection: "row",
    alignItems: "center",
  },
  tabPill: { position: "absolute", left: 0, width: TAB_WIDTH, height: 34, borderRadius: 17 },
  tab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center" },
  tabIcon: {
    width: 58,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  inboxDot: { position: "absolute", width: 8, height: 8, borderRadius: 4, top: 5, right: 15 },
  button: {
    minWidth: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
  },
  scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0006", paddingHorizontal: 10 },
  sheet: {
    maxHeight: "82%",
    borderRadius: 32,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  sheetHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 18,
    paddingRight: 6,
  },
  sheetRows: { paddingHorizontal: 8, paddingBottom: 12 },
  popover: { position: "absolute", left: 16, right: 16 },
  card: { padding: 5 },
  cardRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingRight: 12,
    borderRadius: 16,
    borderCurve: "continuous",
  },
  compactRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 10,
  },
  cardDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 10, marginVertical: 4 },
  cardIcon: { width: 26 },
  recentIcon: { width: 18 },
  placeIcon: { width: 24 },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  placesCard: { width: "100%", maxWidth: 340, maxHeight: 520, overflow: "hidden" },
  placesHeader: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
  },
  sheetRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 12,
    borderRadius: 18,
  },
  section: { marginHorizontal: 12, marginTop: 12, marginBottom: 4 },
});
