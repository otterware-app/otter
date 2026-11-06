import {
  Button,
  Divider,
  GlassEffectContainer,
  HStack,
  Host,
  Image as SwiftImage,
  Menu,
  Namespace,
  Spacer,
  Text as SwiftText,
  ZStack,
} from "@expo/ui/swift-ui";
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  padding,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import type { MessageSummary } from "@otter-mail/client-runtime/mail";
import { beginUndoGroup } from "@otter-mail/client-runtime/operations";
import type { SFSymbol } from "expo-symbols";
import { useId } from "react";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { glassSurface, useReduceTransparency } from "../glass";
import type { Palette } from "../theme";
import { bulkTagVerb, leaf } from "./labels";
import type { threadActions } from "./threadActions";

const labelsOf = (row: MessageSummary) => row.threadLabelIds ?? row.labelIds;

/**
 * apps/ios's bottom bar while selecting (More › Select messages): how many,
 * with Select all; Archive (Move to Inbox in Trash, Junk and Archive); read,
 * unread and labels; Trash.
 */
export function SelectionBar({
  rows,
  selected,
  labelId,
  actions,
  colors,
  onSelect,
  onDone,
}: {
  rows: readonly MessageSummary[];
  selected: ReadonlySet<string>;
  labelId: string;
  actions: ReturnType<typeof threadActions>;
  colors: Palette;
  onSelect: (ids: ReadonlySet<string>) => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const namespace = useId();
  const solid = useReduceTransparency();
  const picked = rows.filter((r) => selected.has(r.threadId));
  const none = picked.length === 0;
  const all = selected.size === rows.length && rows.length > 0;

  /** Each picked conversation, as one undo and one toast. */
  const bulk =
    (run: (row: MessageSummary) => void, rowsToRun = picked) =>
    () => {
      beginUndoGroup(rowsToRun.length);
      for (const row of rowsToRun) run(row);
      onDone();
    };

  const glass = (label: string, shape: "circle" | "capsule" = "circle") =>
    glassSurface({ shape }, label, namespace, { interactive: true, solid, fill: colors.raised });
  const face = (symbol: SFSymbol) => (
    <ZStack modifiers={[frame({ width: 48, height: 48 }), contentShape(shapes.circle())]}>
      <SwiftImage systemName={symbol} size={19} color={colors.text} />
    </ZStack>
  );
  const button = (symbol: SFSymbol, label: string, onPress: () => void, off = none) => (
    <Button
      key={label}
      onPress={onPress}
      modifiers={[
        buttonStyle("plain"),
        disabled(off),
        accessibilityLabel(label),
        accessibilityIdentifier(`select-${label}`),
        ...glass(label),
      ]}
    >
      {face(symbol)}
    </Button>
  );

  const putBack = labelId === "TRASH" || labelId === "SPAM" || labelId === "ARCHIVE";
  const { tags, tagsTitle, folders } = actions.choices;
  const tagged = (id: string) => picked.map((r) => labelsOf(r).includes(id));

  return (
    <Host
      matchContents={{ vertical: true }}
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + 4 }]}
    >
      <Namespace id={namespace}>
        <GlassEffectContainer spacing={10} modifiers={[padding({ horizontal: 16 })]}>
          <HStack spacing={10}>
            <Menu
              label={
                <ZStack
                  modifiers={[
                    frame({ height: 48 }),
                    padding({ horizontal: 18 }),
                    contentShape(shapes.capsule()),
                  ]}
                >
                  <SwiftText
                    modifiers={[
                      font({ size: 16, weight: "semibold" }),
                      foregroundStyle(colors.text),
                    ]}
                  >
                    {`${selected.size} selected`}
                  </SwiftText>
                </ZStack>
              }
              modifiers={[accessibilityIdentifier("select-count"), ...glass("count", "capsule")]}
            >
              <Button
                label={all ? "Deselect all" : "Select all"}
                onPress={() => onSelect(all ? new Set() : new Set(rows.map((r) => r.threadId)))}
              />
            </Menu>
            <Spacer minLength={0} />
            {putBack
              ? button("tray.and.arrow.down", "Move to Inbox", bulk(actions.moveToInbox))
              : button(
                  "archivebox",
                  "Archive",
                  bulk(actions.archive, picked.filter(actions.canArchive)),
                  !picked.some(actions.canArchive),
                )}
            <Menu
              label={face("tag")}
              modifiers={[
                disabled(none),
                accessibilityLabel("Message actions"),
                accessibilityIdentifier("select-Message actions"),
                ...glass("actions"),
              ]}
            >
              <Button
                label="Mark as read"
                systemImage="envelope.open"
                onPress={bulk((r) => (r.threadUnread ?? r.unread) && actions.toggleRead(r))}
              />
              <Button
                label="Mark as unread"
                systemImage="envelope.badge"
                onPress={bulk((r) => !(r.threadUnread ?? r.unread) && actions.toggleRead(r))}
              />
              {tags.length || folders.length ? <Divider /> : null}
              {tags.length ? (
                <Menu label={tagsTitle} systemImage="tag">
                  {tags.map((l) => {
                    const verb = bulkTagVerb(tagged(l.id));
                    const has = verb === "Remove";
                    return (
                      <Button
                        key={l.id}
                        label={`${verb} ${leaf(l.name)}`}
                        onPress={bulk(
                          (r) => actions.toggleLabel(r, l.id),
                          picked.filter((r) => labelsOf(r).includes(l.id) === has),
                        )}
                      />
                    );
                  })}
                </Menu>
              ) : null}
              {folders.length ? (
                <Menu label="Move to" systemImage="folder">
                  {folders.map((l) => (
                    <Button
                      key={l.id}
                      label={`Move to ${leaf(l.name)}`}
                      onPress={bulk((r) => actions.moveTo(r, l.id))}
                    />
                  ))}
                </Menu>
              ) : null}
            </Menu>
            {labelId !== "TRASH" ? button("trash", "Move to Trash", bulk(actions.trash)) : null}
          </HStack>
        </GlassEffectContainer>
      </Namespace>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 0, right: 0 },
});
