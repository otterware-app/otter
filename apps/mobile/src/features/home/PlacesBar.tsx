import { Button, Host, Menu, Section } from "@expo/ui/swift-ui";
import { GlassView } from "expo-glass-effect";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Mailbox } from "../../state/client";
import { usePalette } from "../theme";
import { placeSymbol } from "./places";

const mailboxName = (m: Mailbox | undefined) => m?.displayName ?? m?.name ?? m?.email ?? "";

/** apps/ios's MailboxAvatar: its picture, else (or until it loads, or for an SVG) its initial on its color. */
export function MailboxAvatar({ mailbox, size }: { mailbox: Mailbox | undefined; size: number }) {
  const picture = mailbox?.customPicture ?? mailbox?.picture;
  const [failed, setFailed] = useState<string | null>(null);
  if (picture && failed !== picture && !picture.startsWith("data:image/svg")) {
    return (
      <Image
        source={{ uri: picture }}
        onError={() => setFailed(picture)}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        backgroundColor: mailbox?.color ?? "#7C8CF8",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text
        allowFontScaling={false}
        style={{ color: "#FFFFFF", fontWeight: "700", fontSize: size * 0.6 }}
      >
        {mailboxName(mailbox).slice(0, 1).toUpperCase() || "?"}
      </Text>
    </View>
  );
}

/**
 * apps/ios's PlacesBar: one glass capsule with the mailbox's picture (its
 * menu switches mailbox), Inbox, Drafts, Search and ⌃⌄ for every other
 * place, which grows into the places panel; the agent on its own glass button.
 */
export function PlacesBar({
  mailboxes,
  current,
  labelId,
  inboxDot,
  unread,
  panel,
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
  unread: (accountId: string) => number;
  /** The places panel, open: shown in the bar's glass instead of its tabs. */
  panel: ReactNode | null;
  onMailbox: (id: string) => void;
  onAddMailbox: () => void;
  onPlace: (labelId: string) => void;
  onSearch: () => void;
  onMenu: () => void;
  onAgent: () => void;
}) {
  const colors = usePalette();
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
      accessibilityLabel={dot ? `${label}, new mail` : label}
      accessibilityState={{ selected }}
      style={[styles.tab, selected && { backgroundColor: colors.selected }]}
      testID={`tab-${label}`}
    >
      <SymbolView name={symbol} size={20} weight="medium" tintColor={colors.text} />
      {dot ? <View style={[styles.dot, { backgroundColor: colors.focus }]} /> : null}
    </Pressable>
  );
  const pinned = labelId === "INBOX" || labelId === "DRAFT";
  return (
    <View style={[styles.row, { bottom: insets.bottom + 4 }]} pointerEvents="box-none">
      {panel ? (
        <GlassView style={styles.panel} glassEffectStyle="regular">
          {panel}
        </GlassView>
      ) : (
        <GlassView style={styles.capsule} glassEffectStyle="regular" isInteractive>
          <View
            style={styles.avatar}
            accessible
            accessibilityRole="button"
            accessibilityLabel={`Mailbox, ${mailboxName(current)}`}
            accessibilityHint="Switches mailbox"
          >
            <Host style={StyleSheet.absoluteFill}>
              <Menu label="   ">
                <Section>
                  {mailboxes.map((m) => {
                    const count = unread(m.id);
                    return (
                      <Button
                        key={m.id}
                        label={`${mailboxName(m)}${count > 0 ? ` · ${count} unread` : ""}`}
                        systemImage={m.id === current?.id ? "checkmark" : undefined}
                        onPress={() => onMailbox(m.id)}
                      />
                    );
                  })}
                </Section>
                <Button label="Add mailbox…" systemImage="plus" onPress={onAddMailbox} />
              </Menu>
            </Host>
            <View pointerEvents="none" style={styles.avatarFace}>
              <MailboxAvatar mailbox={current} size={30} />
            </View>
          </View>
          {tab(
            placeSymbol("INBOX", labelId === "INBOX"),
            labelId === "INBOX",
            "Inbox",
            () => onPlace("INBOX"),
            inboxDot,
          )}
          {tab(placeSymbol("DRAFT", labelId === "DRAFT"), labelId === "DRAFT", "Drafts", () =>
            onPlace("DRAFT"),
          )}
          {tab("magnifyingglass", false, "Search", onSearch)}
          {tab("chevron.up.chevron.down", !pinned, "All places", onMenu)}
        </GlassView>
      )}
      <GlassView style={styles.agent} glassEffectStyle="regular" isInteractive>
        <Pressable
          onPress={onAgent}
          style={styles.agentButton}
          accessibilityRole="button"
          accessibilityLabel="Agent"
          testID="tab-Agent"
        >
          <Image
            source={require("../../../assets/agent.png")}
            style={{ width: 24, height: 24, tintColor: colors.text }}
          />
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
    gap: 12,
  },
  capsule: { flexDirection: "row", alignItems: "center", padding: 4, borderRadius: 28, height: 56 },
  panel: { flex: 1, maxWidth: 340, borderRadius: 32, overflow: "hidden" },
  avatar: { width: 52, height: 48, alignItems: "center", justifyContent: "center" },
  avatarFace: { position: "absolute" },
  tab: { width: 56, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  dot: { position: "absolute", top: 10, right: 14, width: 9, height: 9, borderRadius: 4.5 },
  agent: { width: 56, height: 56, borderRadius: 28, marginLeft: "auto" },
  agentButton: { flex: 1, alignItems: "center", justifyContent: "center" },
});
