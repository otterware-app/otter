import { useModifyThread, useUntrashThread } from "@otter/client/mail/hooks";
import { onUndoableAction, quietParams, takeUndo, type UndoAction } from "@otter/client/mail/undo";
import { showNotice, useNotices } from "@otter/mobile/notices";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { barHeight } from "./mail-bar.tsx";

export function MailNotices() {
  const { mutateAsync: modify } = useModifyThread();
  const { mutateAsync: untrash } = useUntrashThread();
  const notices = useNotices();
  const insets = useSafeAreaInsets();
  const theme = useTheme();

  useEffect(() => {
    async function undo(action: UndoAction) {
      if (action.kind === "batch") {
        for (const row of action.actions) await undo(row);
      } else if (action.kind === "modifyThread") {
        await modify(quietParams(action.params));
      } else if (action.kind === "untrashThread") {
        await untrash(action.params);
      }
    }
    return onUndoableAction((title, action) => {
      const archived = title.startsWith("Archived");
      if (!archived && !title.includes(" to Trash")) return;
      const count = action.kind === "batch" ? action.actions.length : 1;
      showNotice({
        title: `${count === 1 ? "Conversation" : `${count} conversations`} ${archived ? "archived" : "trashed"}`,
        tone: "success",
        timeout: 6000,
        action: {
          label: "Undo",
          run: () => {
            if (!takeUndo(action)) return;
            void undo(action).then(
              () => showNotice({ title: "Undone", tone: "success" }),
              () => showNotice({ title: "Couldn't undo", tone: "error" }),
            );
          },
        },
      });
    });
  }, [modify, untrash]);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.notices, { bottom: insets.bottom + barHeight(false) + 20 }]}
    >
      {notices.map((notice) => (
        <Pressable
          key={notice.id}
          accessibilityLiveRegion="polite"
          onPress={notice.close}
          style={[
            styles.notice,
            { backgroundColor: theme.colors.surfaceRaised, borderColor: theme.colors.border },
          ]}
        >
          <Text size="md" numberOfLines={2} style={{ flex: 1 }}>
            {notice.body ? `${notice.title} · ${notice.body}` : notice.title}
          </Text>
          {notice.action ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={12}
              onPress={() => {
                notice.action?.run();
                notice.close();
              }}
            >
              <Text size="lg" weight="semibold">
                {notice.action.label}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  notices: { position: "absolute", left: 16, right: 16, gap: 8 },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderCurve: "continuous",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
