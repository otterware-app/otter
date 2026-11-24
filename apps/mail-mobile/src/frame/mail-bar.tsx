import { getAccountDisplayName } from "@otter/client/mail/account-style";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import { syncLabel } from "@otter/client/mail/hooks";
import type { MailLabel, SyncStatus } from "@otter/client/mail/types";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon, type IconName } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { alpha, useTheme } from "@otter/ui-native/theme";
import { useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
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
  const tabs = [
    {
      title: "Inbox",
      icon: "tray.fill",
      run: () => onLabel("INBOX"),
      onHold: () => onRecents("INBOX"),
      dot: unread,
    },
    {
      title: caps.stars ? "Starred" : "Flagged",
      icon: caps.stars ? "star.fill" : "flag.fill",
      run: () => onLabel("STARRED"),
      onHold: () => onRecents("STARRED"),
    },
    { title: "All places", icon: "folder.fill", run: onFolders },
    { title: "Settings", icon: "gearshape.fill", run: onSettings },
  ] as const;
  const selected = label === "INBOX" ? 0 : label === "STARRED" ? 1 : 2;
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
    <View
      pointerEvents="box-none"
      style={[styles.bars, { paddingBottom: insets.bottom + (reading ? 8 : 0) }]}
    >
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
          onLongPress={() => onRecents("DRAFT")}
          style={[styles.dockIcon, { backgroundColor: theme.colors.foreground }]}
        >
          <Icon name="square.and.pencil" size={16} tint={theme.colors.canvas} />
        </Pressable>
      </Glass>
      {!reading && (
        <GestureDetector gesture={slide}>
          <View
            style={styles.tabs}
            onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
          >
            {tabs.map((tab, index) => {
              const lit = (hover ?? selected) === index;
              const hold = "onHold" in tab ? tab.onHold : undefined;
              return (
                <Pressable
                  key={tab.title}
                  accessibilityRole="button"
                  accessibilityLabel={tab.title}
                  accessibilityState={{ selected: lit }}
                  accessibilityActions={hold ? [{ name: "recent", label: "Recent" }] : undefined}
                  onAccessibilityAction={hold}
                  onPress={tab.run}
                  onLongPress={hold}
                  style={styles.tab}
                >
                  <View
                    style={[
                      styles.tabIcon,
                      lit && { backgroundColor: alpha(theme.colors.foreground, 0.07) },
                    ]}
                  >
                    <Icon
                      name={tab.icon}
                      size={18}
                      color={lit ? "foreground" : "mutedForeground"}
                    />
                    {"dot" in tab && tab.dot ? (
                      <View style={[styles.inboxDot, { backgroundColor: theme.colors.primary }]} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </GestureDetector>
      )}
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

export function FolderPicker({
  mailbox,
  labels,
  selected,
  status,
  visible,
  onClose,
  onPick,
  onSync,
}: {
  mailbox: Mailbox;
  labels: MailLabel[];
  selected: string;
  status: SyncStatus | null;
  visible: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
  onSync: () => void;
}) {
  const places = mailPlaces(mailbox.account, labels);
  const rows = (items: typeof places.system) =>
    items.map(({ id, icon, title, label }) => (
      <SheetRow
        key={id}
        title={title}
        icon={icon}
        leading={label?.color ? <Icon name={icon} tint={label.color.backgroundColor} /> : undefined}
        detail={label?.unread}
        selected={id === selected}
        onPress={() => onPick(id)}
      />
    ));
  return (
    <MailSheet title={getAccountDisplayName(mailbox.look)} visible={visible} onClose={onClose}>
      {rows(places.system)}
      {places.folders.length > 0 && (
        <>
          <Text size="sm" color="mutedForeground" style={styles.section}>
            {places.folderTitle}
          </Text>
          {rows(places.folders)}
        </>
      )}
      {places.categories.length > 0 && (
        <>
          <Text size="sm" color="mutedForeground" style={styles.section}>
            Categories
          </Text>
          {rows(places.categories)}
        </>
      )}
      {!mailbox.account.signedOut && (
        <SheetRow
          title="Sync now"
          icon="arrow.clockwise"
          detail={status ? syncLabel(status) : undefined}
          onPress={onSync}
        />
      )}
    </MailSheet>
  );
}

const styles = StyleSheet.create({
  bars: { position: "absolute", left: 0, right: 0, bottom: 0, gap: 4 },
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
  tabs: { minHeight: 40, marginHorizontal: 32, flexDirection: "row", alignItems: "center" },
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
  sheetRow: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    paddingHorizontal: 12,
    borderRadius: 18,
  },
  section: { marginHorizontal: 12, marginTop: 14, marginBottom: 3 },
});
