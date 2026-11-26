import { actedFrom, archiveFrom, moveToFolder } from "@otter/client/mail/archive";
import { capabilitiesOf } from "@otter/client/mail/capabilities";
import {
  useDeleteThreadsForever,
  useDiscardThreadDrafts,
  useModifyThread,
  useTrashThread,
  useUntrashThread,
} from "@otter/client/mail/hooks";
import { isAssignableLabel } from "@otter/client/mail/label-tree";
import { rowLabels } from "@otter/client/mail/rows";
import type { MailAccount, MailLabel, MessageSummary } from "@otter/client/mail/types";
import { beginUndoGroup } from "@otter/client/mail/undo";
import { useQueryClient } from "@tanstack/react-query";
import { showNotice } from "@otter/mobile/notices";
import { Icon } from "@otter/ui-native/components/icon";
import { Text } from "@otter/ui-native/components/text";
import { Alert } from "react-native";

import { MailSheet, SheetRow } from "../frame/mail-bar.tsx";
import { mailPlaces } from "../frame/mail-places.tsx";

export type MailAction =
  | "archive"
  | "trash"
  | "restore"
  | "junk"
  | "read"
  | "unread"
  | "star"
  | "unstar"
  | "delete"
  | "discard";
export type LabelPicker = "move" | "label";

export function useMailActions(
  account: MailAccount | undefined,
  label: string,
  labels: MailLabel[],
) {
  const modify = useModifyThread();
  const trash = useTrashThread();
  const restore = useUntrashThread();
  const remove = useDeleteThreadsForever();
  const discard = useDiscardThreadDrafts();
  const queries = useQueryClient();
  const capabilities = capabilitiesOf(account);
  const from = actedFrom([label]);
  const origin = labels.find((entry) => entry.id === label);
  const canArchive = (message: MessageSummary) =>
    archiveFrom(rowLabels(message), origin, capabilities) !== null;

  async function run(action: MailAction, messages: MessageSummary[]) {
    if (!account || messages.length === 0) return false;
    const accountId = account.id;
    const sendChange = (
      message: MessageSummary,
      change: { addLabelIds?: string[]; removeLabelIds?: string[] },
      source?: string,
    ) => modify.mutateAsync({ accountId, threadId: message.threadId, ...change, from: source });

    try {
      if (action === "delete") {
        await remove.mutateAsync({
          accountId,
          threadIds: messages.map((message) => message.threadId),
        });
        return true;
      }
      const targets = action === "archive" ? messages.filter(canArchive) : messages;
      if (action === "archive" || action === "trash" || action === "junk")
        beginUndoGroup(targets.length);
      const results = await Promise.allSettled(
        targets.map((message) => {
          const thread = { accountId, threadId: message.threadId };
          switch (action) {
            case "archive":
              return sendChange(
                message,
                { removeLabelIds: [archiveFrom(rowLabels(message), origin, capabilities)!] },
                from,
              );
            case "trash":
              return trash.mutateAsync({ ...thread, from });
            case "discard":
              return discard.mutateAsync(thread);
            case "junk":
              return sendChange(
                message,
                { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
                from,
              );
            case "restore":
              if (label === "TRASH") return restore.mutateAsync(thread);
              return sendChange(
                message,
                { addLabelIds: ["INBOX"], removeLabelIds: [label === "SPAM" ? "SPAM" : "ARCHIVE"] },
                from,
              );
            case "read":
              return sendChange(message, { removeLabelIds: ["UNREAD"] });
            case "unread":
              return sendChange(message, { addLabelIds: ["UNREAD"] });
            case "star":
              return sendChange(message, { addLabelIds: ["STARRED"] });
            case "unstar":
              return sendChange(message, { removeLabelIds: ["STARRED"] });
          }
        }),
      );
      if (results.every((result) => result.status === "fulfilled")) return targets.length > 0;
      void queries.invalidateQueries({ queryKey: ["gmail:messages", accountId] });
      return false;
    } catch {
      return false;
    }
  }

  async function changeLabel(kind: LabelPicker, id: string, messages: MessageSummary[]) {
    if (!account || messages.length === 0) return false;
    const removeLabel = messages.every((message) => rowLabels(message).includes(id));
    const targets =
      kind === "move" || removeLabel
        ? messages
        : messages.filter((message) => !rowLabels(message).includes(id));
    beginUndoGroup(targets.length);
    const results = await Promise.allSettled(
      targets.map((message) => {
        const change =
          kind === "move"
            ? moveToFolder(
                rowLabels(message),
                id,
                labels.filter((entry) => !entry.id.startsWith("category:")),
              )
            : removeLabel
              ? { removeLabelIds: [id] }
              : { addLabelIds: [id] };
        return modify.mutateAsync({
          accountId: account.id,
          threadId: message.threadId,
          ...change,
          from: kind === "move" ? from : undefined,
        });
      }),
    );
    if (results.every((result) => result.status === "fulfilled")) return true;
    void queries.invalidateQueries({ queryKey: ["gmail:messages", account.id] });
    return false;
  }

  return { run, changeLabel, canArchive };
}

export function confirmDelete(count: number, discard: boolean, run: () => void) {
  const what =
    count === 1
      ? discard
        ? "this draft"
        : "this conversation"
      : discard
        ? `${count} drafts`
        : `${count} conversations`;
  Alert.alert(discard ? "Discard draft?" : "Delete forever?", `Permanently delete ${what}?`, [
    { text: "Cancel", style: "cancel" },
    { text: discard ? "Discard" : "Delete", style: "destructive", onPress: run },
  ]);
}

export function hasLabels(account: MailAccount | undefined, labels: MailLabel[]) {
  const caps = capabilitiesOf(account);
  return (
    caps.multipleLabels &&
    labels.some(
      (label) =>
        isAssignableLabel(label) &&
        (!caps.foldersAndCategories || label.id.startsWith("category:")),
    )
  );
}

/** Where a conversation can move to, or the labels (Outlook's categories) it can carry. */
export function labelChoices(
  kind: LabelPicker,
  account: MailAccount | undefined,
  labels: MailLabel[],
) {
  const places = mailPlaces(account, labels);
  if (kind === "move")
    return [
      ...places.system.filter(({ id }) => id === "INBOX" || id === "ARCHIVE"),
      ...places.folders.filter(({ label }) => isAssignableLabel(label)),
    ];
  return capabilitiesOf(account).foldersAndCategories ? places.categories : places.folders;
}

export function LabelSheet({
  kind,
  account,
  labels,
  threads,
  onClose,
  onChange,
}: {
  kind: LabelPicker | null;
  account: MailAccount | undefined;
  labels: MailLabel[];
  threads: MessageSummary[];
  onClose: () => void;
  onChange: (kind: LabelPicker, id: string) => void;
}) {
  const caps = capabilitiesOf(account);
  const choices = kind ? labelChoices(kind, account, labels) : [];
  return (
    <MailSheet
      title={kind === "move" ? "Move to" : caps.foldersAndCategories ? "Categories" : "Labels"}
      visible={kind !== null}
      onClose={onClose}
    >
      {choices.map(({ id, title, icon, label }) => (
        <SheetRow
          key={id}
          title={title}
          icon={icon}
          leading={
            label?.color ? <Icon name={icon} tint={label.color.backgroundColor} /> : undefined
          }
          selected={threads.length > 0 && threads.every((thread) => rowLabels(thread).includes(id))}
          onPress={() => {
            if (kind) onChange(kind, id);
            onClose();
          }}
        />
      ))}
      {choices.length === 0 && (
        <Text color="mutedForeground" style={{ padding: 14 }}>
          No folders
        </Text>
      )}
    </MailSheet>
  );
}

export function mailFailure(error: unknown) {
  showNotice({ title: error instanceof Error ? error.message : String(error), tone: "error" });
}
