import { useModifyThread, useUntrashThread } from "@otter/client/mail/hooks";
import { onUndoableAction, quietParams, takeUndo, type UndoAction } from "@otter/client/mail/undo";
import { showNotice, useNotices } from "@otter/mobile/notices";
import { Toast } from "@otter/ui-native/components/toast";
import { useEffect } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ICON = {
  info: "info.circle",
  success: "checkmark.circle",
  warning: "exclamationmark.circle",
  error: "exclamationmark.triangle",
} as const;

export function MailNotices() {
  const { mutateAsync: modify } = useModifyThread();
  const { mutateAsync: untrash } = useUntrashThread();
  const notices = useNotices();
  const insets = useSafeAreaInsets();

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
      if (!title.startsWith("Archived") && !title.includes(" to Trash")) return;
      showNotice({
        title,
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
      style={{ position: "absolute", top: insets.top + 52, left: 0, right: 0, gap: 6 }}
    >
      {notices.map((notice) => (
        <Toast
          key={notice.id}
          text={notice.body ? `${notice.title} · ${notice.body}` : notice.title}
          icon={ICON[notice.tone]}
          onPress={notice.close}
          action={
            notice.action
              ? {
                  label: notice.action.label,
                  run: () => {
                    notice.action?.run();
                    notice.close();
                  },
                }
              : undefined
          }
        />
      ))}
    </View>
  );
}
