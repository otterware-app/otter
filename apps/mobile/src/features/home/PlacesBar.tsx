import {
  Button,
  Capsule,
  Circle,
  GlassEffectContainer,
  HStack,
  Host,
  Image as SwiftImage,
  Menu,
  Namespace,
  Rectangle,
  RNHostView,
  Section,
  Spacer,
  VStack,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityHint,
  accessibilityIdentifier,
  accessibilityLabel,
  animation,
  buttonStyle,
  contentShape,
  foregroundStyle,
  frame,
  offset,
  onTapGesture,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { SFSymbol } from "expo-symbols";
import { useId, useState, type ReactNode } from "react";
import { Image, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Mailbox } from "../../state/client";
import { glassSpring, glassSurface, useReduceMotion, useReduceTransparency } from "../glass";
import { usePalette } from "../theme";
import { placeSymbol } from "./places";

const mailboxName = (m: Mailbox | undefined) => m?.displayName ?? m?.name ?? m?.email ?? "";

/** The Swift app's MailboxAvatar: its picture, else (or until it loads, or for an SVG) its initial on its color. */
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
 * The Swift app's PlacesBar, in SwiftUI: one glass container holding the bar's
 * capsule (the mailbox's menu, Inbox, Drafts, Search and ⌃⌄) and the agent's
 * button. The capsule shares its glass with the places panel, so ⌃⌄ morphs it
 * into the panel and back; the selection slides between tabs; scrolling the
 * list down shrinks it to the current place beside the agent (they merge),
 * and scrolling up or a tap brings it back.
 */
export function PlacesBar({
  mailboxes,
  current,
  labelId,
  inboxDot,
  unread,
  panel,
  collapsed,
  onMailbox,
  onAddMailbox,
  onPlace,
  onSearch,
  onMenu,
  onClose,
  onExpand,
  onAgent,
}: {
  mailboxes: readonly Mailbox[];
  current: Mailbox | undefined;
  labelId: string;
  inboxDot: boolean;
  unread: (accountId: string) => number;
  /** The places panel (SwiftUI), open: the bar's glass becomes it. */
  panel: ReactNode | null;
  /** Minimized while the list scrolls down. */
  collapsed: boolean;
  onMailbox: (id: string) => void;
  onAddMailbox: () => void;
  onPlace: (labelId: string) => void;
  onSearch: () => void;
  onMenu: () => void;
  onClose: () => void;
  onExpand: () => void;
  onAgent: () => void;
}) {
  const colors = usePalette();
  const insets = useSafeAreaInsets();
  const screenHeight = useWindowDimensions().height;
  const namespace = useId();
  const spring = glassSpring(useReduceMotion());
  const solid = useReduceTransparency();
  const surface = (shape: Parameters<typeof glassSurface>[0], id: string, interactive = false) =>
    glassSurface(shape, id, namespace, { interactive, solid, fill: colors.raised });

  const pinned = labelId === "INBOX" || labelId === "DRAFT";
  const compact = collapsed && !panel;
  const selected = labelId === "INBOX" ? 0 : labelId === "DRAFT" ? 1 : 3;
  // One value for the spring to follow: the bar's form and which tab is lit.
  const motion = (panel ? 10 : compact ? 20 : 0) + selected;
  // @expo/ui hands each view its own props, so every view whose content changes carries the spring.
  const animated = spring ? [animation(spring, motion)] : [];

  const icon = (symbol: SFSymbol) => (
    <SwiftImage systemName={symbol} size={19} color={colors.text} />
  );

  const tab = (symbol: SFSymbol, lit: boolean, label: string, onPress: () => void, dot = false) => (
    <Button
      key={label}
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(dot ? `${label}, new mail` : label),
        accessibilityIdentifier(`tab-${label}`),
        ...(lit ? [accessibilityAddTraits(["isSelected"])] : []),
      ]}
    >
      <ZStack modifiers={[frame({ width: 56, height: 48 }), contentShape(shapes.capsule())]}>
        {icon(symbol)}
        {dot ? (
          <Circle
            modifiers={[
              foregroundStyle(colors.focus),
              frame({ width: 9, height: 9 }),
              offset({ x: 11, y: -9 }),
            ]}
          />
        ) : null}
      </ZStack>
    </Button>
  );

  const avatar = (size: number, width: number) => (
    <RNHostView>
      <View pointerEvents="none" style={[styles.avatar, { width }]}>
        <MailboxAvatar mailbox={current} size={size} />
      </View>
    </RNHostView>
  );

  const bar = (
    <ZStack
      alignment="leading"
      modifiers={[padding({ all: 4 }), ...surface({ shape: "capsule" }, "places", true)]}
    >
      {/* One selection behind the tabs, so it slides from tab to tab (past the 52-point avatar). */}
      <Capsule
        modifiers={[
          foregroundStyle(colors.selected),
          frame({ width: 56, height: 48 }),
          offset({ x: 52 + selected * 56, y: 0 }),
          ...animated,
        ]}
      />
      <HStack spacing={0}>
        <Menu
          label={avatar(30, 52)}
          modifiers={[
            frame({ width: 52, height: 48 }),
            accessibilityLabel(`Mailbox, ${mailboxName(current)}`),
            accessibilityHint("Switches mailbox"),
          ]}
        >
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
      </HStack>
    </ZStack>
  );

  // The bar shrunk to where you are: the place's symbol on its glass, next to the agent.
  const minimized = (
    <Button
      onPress={onExpand}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel("Show the places bar"),
        accessibilityIdentifier("tab-expand"),
        ...surface({ shape: "circle" }, "places", true),
      ]}
    >
      <ZStack modifiers={[frame({ width: 56, height: 56 }), contentShape(shapes.circle())]}>
        {icon(placeSymbol(labelId, true))}
      </ZStack>
    </Button>
  );

  const agent = (
    <Button
      onPress={onAgent}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel("Agent"),
        accessibilityIdentifier("tab-Agent"),
        ...surface({ shape: "circle" }, "agent", true),
      ]}
    >
      <ZStack modifiers={[frame({ width: 56, height: 56 }), contentShape(shapes.circle())]}>
        <RNHostView matchContents>
          <View pointerEvents="none">
            <Image
              source={require("../../../assets/agent.png")}
              style={{ width: 24, height: 24, tintColor: colors.text }}
            />
          </View>
        </RNHostView>
      </ZStack>
    </Button>
  );

  return (
    <Host
      matchContents={{ vertical: true }}
      alignment="bottom"
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom }]}
    >
      <Namespace id={namespace}>
        {/* The host keeps touches beside its glass, so the open panel brings its own backdrop: a tap beside it closes it. */}
        <ZStack alignment="bottom">
          {panel ? (
            <Rectangle
              modifiers={[
                foregroundStyle("#00000001"),
                frame({ height: screenHeight - insets.bottom }),
                contentShape(shapes.rectangle()),
                onTapGesture(onClose),
                accessibilityLabel("Close places"),
                accessibilityIdentifier("places-backdrop"),
              ]}
            />
          ) : null}
          <GlassEffectContainer
            spacing={10}
            modifiers={[...animated, padding({ horizontal: 20, bottom: 4 })]}
          >
            <HStack alignment="bottom" spacing={compact ? 4 : 12} modifiers={animated}>
              {compact ? <Spacer minLength={0} /> : null}
              {panel ? (
                <VStack
                  spacing={0}
                  modifiers={surface({ shape: "roundedRectangle", cornerRadius: 32 }, "places")}
                >
                  {panel}
                </VStack>
              ) : compact ? (
                minimized
              ) : (
                bar
              )}
              {compact ? null : <Spacer minLength={0} />}
              {agent}
            </HStack>
          </GlassEffectContainer>
        </ZStack>
      </Namespace>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0 },
  avatar: { height: 48, alignItems: "center", justifyContent: "center" },
});
