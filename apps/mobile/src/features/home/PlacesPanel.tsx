import {
  Button,
  Divider,
  HStack,
  Image,
  RNHostView,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  monospacedDigit,
  padding,
  scrollIndicators,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { MailLabel } from "@otter-mail/client-runtime/mail";
import type { SFSymbol } from "expo-symbols";
import { View } from "react-native";

import type { Mailbox } from "../../state/client";
import type { Palette } from "../theme";
import { MailboxAvatar } from "./PlacesBar";
import { folders, ownLabels, placeCount, placeSymbol, placeTitle } from "./places";

const CLEAR = "#00000000";

/**
 * apps/ios's PlacesPanel, in SwiftUI inside the places bar's glass (the bar
 * morphs into it): the mailbox, its folders with their counts, its own labels
 * (folders, for Outlook and IMAP), then Search and Settings.
 */
export function PlacesPanel({
  colors,
  maxHeight,
  mailbox,
  labels,
  labelId,
  onPlace,
  onSearch,
  onSettings,
}: {
  colors: Palette;
  maxHeight: number;
  mailbox: Mailbox | undefined;
  labels: readonly MailLabel[];
  labelId: string;
  onPlace: (labelId: string) => void;
  onSearch: () => void;
  onSettings: () => void;
}) {
  const own = ownLabels(labels);

  const row = (
    key: string,
    title: string,
    symbol: SFSymbol,
    onPress: () => void,
    {
      selected = false,
      count = 0,
      depth = 0,
      tint,
    }: { selected?: boolean; count?: number; depth?: number; tint?: string } = {},
  ) => (
    <Button
      key={key}
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        accessibilityLabel(count > 0 ? `${title}, ${count}` : title),
        accessibilityIdentifier(`place-${key}`),
        ...(selected ? [accessibilityAddTraits(["isSelected"])] : []),
      ]}
    >
      <HStack
        spacing={14}
        modifiers={[
          padding({ leading: 12 + depth * 20, trailing: 12 }),
          frame({ height: 48 }),
          background(
            selected ? colors.selected : CLEAR,
            shapes.roundedRectangle({ cornerRadius: 16 }),
          ),
          contentShape(shapes.rectangle()),
        ]}
      >
        <Image
          systemName={symbol}
          size={17}
          color={tint ?? colors.text}
          modifiers={[frame({ width: 24 })]}
        />
        <Text modifiers={[font({ size: 17 }), foregroundStyle(colors.text), lineLimit(1)]}>
          {title}
        </Text>
        <Spacer minLength={8} />
        {count > 0 ? (
          <Text
            modifiers={[
              font({ size: 13, weight: "medium" }),
              foregroundStyle(colors.secondary),
              monospacedDigit(),
            ]}
          >
            {String(count)}
          </Text>
        ) : null}
      </HStack>
    </Button>
  );

  return (
    <VStack alignment="leading" spacing={0} modifiers={[frame({ maxWidth: 340 })]}>
      <HStack spacing={10} modifiers={[padding({ horizontal: 16 }), frame({ height: 56 })]}>
        <RNHostView matchContents>
          <View pointerEvents="none">
            <MailboxAvatar mailbox={mailbox} size={24} />
          </View>
        </RNHostView>
        <Text
          modifiers={[
            font({ size: 17, weight: "semibold" }),
            foregroundStyle(colors.text),
            lineLimit(1),
            accessibilityAddTraits(["isHeader"]),
          ]}
        >
          {mailbox?.displayName ?? mailbox?.name ?? mailbox?.email ?? "Mailbox"}
        </Text>
        <Spacer minLength={0} />
      </HStack>
      <Divider modifiers={[padding({ horizontal: 12 })]} />
      <ScrollView
        modifiers={[
          scrollIndicators("hidden"),
          frame({ maxHeight }),
          fixedSize({ horizontal: false, vertical: true }),
        ]}
      >
        <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 8 })]}>
          {folders(labels).map((label) =>
            row(
              label.id,
              placeTitle(label.id, labels),
              placeSymbol(label.id),
              () => onPlace(label.id),
              {
                selected: label.id === labelId,
                count: placeCount(label),
              },
            ),
          )}
          {own.length > 0 ? (
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(colors.secondary),
                padding({ leading: 12, top: 12, bottom: 4 }),
                accessibilityAddTraits(["isHeader"]),
              ]}
            >
              {mailbox?.provider === "gmail" || !mailbox?.provider ? "Labels" : "Folders"}
            </Text>
          ) : null}
          {own.map(({ label, name, depth }) =>
            row(label.id, name, "tag", () => onPlace(label.id), {
              selected: label.id === labelId,
              count: placeCount(label),
              depth,
              tint: label.color?.backgroundColor,
            }),
          )}
          {own.length > 0 ? (
            <Divider modifiers={[padding({ vertical: 6, horizontal: 4 })]} />
          ) : null}
          {row("search", "Search", "magnifyingglass", onSearch)}
          {row("settings", "Settings", "gearshape", onSettings)}
        </VStack>
      </ScrollView>
    </VStack>
  );
}
