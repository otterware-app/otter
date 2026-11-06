import { Button, Host, Menu } from "@expo/ui/swift-ui";
import { GlassView } from "expo-glass-effect";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Image, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Mailbox } from "../../state/client";
import { palette } from "../theme";

export function MailboxAvatar({ mailbox, size }: { mailbox: Mailbox | undefined; size: number }) {
  const picture = mailbox?.customPicture ?? mailbox?.picture;
  const initial = (mailbox?.displayName ?? mailbox?.name ?? mailbox?.email ?? "?")
    .slice(0, 1)
    .toUpperCase();
  if (picture) {
    return (
      <Image
        source={{ uri: picture }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: mailbox?.color ?? "#7C8CF8",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#FFFFFF", fontWeight: "700", fontSize: size * 0.45 }}>{initial}</Text>
    </View>
  );
}

/**
 * apps/ios's PlacesBar: one glass capsule with the mailbox's picture (its
 * menu switches mailbox), Inbox, Drafts, Search and ⌃⌄ for every other
 * place; the agent on a round glass button of its own.
 */
export function PlacesBar({
  mailboxes,
  current,
  labelId,
  inboxDot,
  onMailbox,
  onAddMailbox,
  onPlace,
  onSearch,
  onMenu,
  onAgent,
}: {
  mailboxes: readonly Mailbox[];
  current: Mailbox | undefined;
  labelId: string;
  inboxDot: boolean;
  onMailbox: (id: string) => void;
  onAddMailbox: () => void;
  onPlace: (labelId: string) => void;
  onSearch: () => void;
  onMenu: () => void;
  onAgent: () => void;
}) {
  const scheme = useColorScheme();
  const colors = palette(scheme);
  const insets = useSafeAreaInsets();
  const tab = (
    symbol: SFSymbol,
    selected: boolean,
    label: string,
    onPress: () => void,
    dot = false,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[
        styles.tab,
        selected && { backgroundColor: scheme === "dark" ? "#FFFFFF1A" : "#0000000F" },
      ]}
      testID={`tab-${label}`}
    >
      <SymbolView
        name={symbol}
        type={selected ? "monochrome" : "monochrome"}
        size={21}
        tintColor={colors.text}
      />
      {dot ? <View style={[styles.dot, { backgroundColor: colors.focus }]} /> : null}
    </Pressable>
  );
  const pinned = labelId === "INBOX" || labelId === "DRAFT";
  return (
    <View style={[styles.row, { bottom: insets.bottom + 4 }]} pointerEvents="box-none">
      <GlassView style={styles.capsule} glassEffectStyle="regular" isInteractive>
        <Host style={styles.avatar}>
          <Menu label="   ">
            {mailboxes.map((m) => (
              <Button
                key={m.id}
                label={m.displayName ?? m.name ?? m.email}
                systemImage={m.id === current?.id ? "checkmark" : undefined}
                onPress={() => onMailbox(m.id)}
              />
            ))}
            <Button label="Add mailbox…" systemImage="plus" onPress={onAddMailbox} />
          </Menu>
        </Host>
        <View pointerEvents="none" style={styles.avatarFace}>
          <MailboxAvatar mailbox={current} size={30} />
        </View>
        {tab(
          labelId === "INBOX" ? "tray.fill" : "tray",
          labelId === "INBOX",
          "Inbox",
          () => onPlace("INBOX"),
          inboxDot,
        )}
        {tab(labelId === "DRAFT" ? "doc.fill" : "doc", labelId === "DRAFT", "Drafts", () =>
          onPlace("DRAFT"),
        )}
        {tab("magnifyingglass", false, "Search", onSearch)}
        {tab("chevron.up.chevron.down", !pinned, "All places", onMenu)}
      </GlassView>
      <GlassView style={styles.agent} glassEffectStyle="regular" isInteractive>
        <Pressable
          onPress={onAgent}
          style={styles.agentButton}
          accessibilityLabel="Agent"
          testID="tab-Agent"
        >
          <SymbolView name="sparkles" size={22} tintColor={colors.text} />
        </Pressable>
      </GlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: "absolute",
    left: 20,
    right: 20,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    padding: 4,
    borderRadius: 28,
    height: 56,
  },
  avatar: { width: 52, height: 48 },
  avatarFace: { position: "absolute", left: 4 + 11, top: 4 + 9 },
  tab: { width: 56, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 10, right: 14, width: 9, height: 9, borderRadius: 4.5 },
  agent: { width: 56, height: 56, borderRadius: 28 },
  agentButton: { flex: 1, alignItems: "center", justifyContent: "center" },
});
