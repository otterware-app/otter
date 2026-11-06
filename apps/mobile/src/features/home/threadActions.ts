import type { MailLabel, MessageSummary } from "@otter-mail/client-runtime/mail";
import { archiveFrom } from "@otter-mail/client-runtime/operations";
import { ActionSheetIOS } from "react-native";

import { operations, threadLists, type Mailbox } from "../../state/client";
import { core } from "../../state/core";

/**
 * What can be done to a conversation in a list, through client-runtime's
 * operations: each shows at once (an overlay on the lists), registers its
 * undo, and settles when core has written it.
 */
export function threadActions(
  mailbox: Mailbox | undefined,
  labels: readonly MailLabel[],
  listLabelId: string,
) {
  const accountId = mailbox?.id ?? "";
  const labelsOf = (row: MessageSummary) => row.threadLabelIds ?? row.labelIds;
  const listLabel = labels.find((l) => l.id === listLabelId);
  const modify = (row: MessageSummary, add: string[], remove: string[]) =>
    void operations
      .modifyThread({ accountId, threadId: row.threadId, addLabelIds: add, removeLabelIds: remove })
      .catch(() => {});

  const archiveLabel = (row: MessageSummary) =>
    mailbox?.capabilities
      ? archiveFrom(labelsOf(row), listLabel, mailbox.capabilities)
      : labelsOf(row).includes("INBOX")
        ? "INBOX"
        : null;
  const inTrash = (row: MessageSummary) =>
    labelsOf(row).includes("TRASH") || listLabelId === "TRASH";
  const inJunk = (row: MessageSummary) => labelsOf(row).includes("SPAM") || listLabelId === "SPAM";

  const actions = {
    canArchive: (row: MessageSummary) =>
      archiveLabel(row) !== null && !inTrash(row) && !inJunk(row),
    archive(row: MessageSummary) {
      const from = archiveLabel(row);
      if (from) void operations.archiveThread(accountId, row.threadId, from).catch(() => {});
    },
    canMoveToInbox: (row: MessageSummary) =>
      inTrash(row) || inJunk(row) || !labelsOf(row).includes("INBOX"),
    moveToInbox(row: MessageSummary) {
      // Gmail's untrash leaves the conversation in no folder, so it's put back in Inbox too.
      if (inTrash(row)) {
        void operations
          .untrashThread(accountId, row.threadId)
          .then(() =>
            mailbox && (mailbox.provider ?? "gmail") === "gmail"
              ? operations.modifyThread(
                  { accountId, threadId: row.threadId, addLabelIds: ["INBOX"] },
                  { quiet: true },
                )
              : undefined,
          )
          .catch(() => {});
      } else if (inJunk(row)) modify(row, ["INBOX"], ["SPAM"]);
      else modify(row, ["INBOX"], listLabelId === "ARCHIVE" ? ["ARCHIVE"] : []);
    },
    trash: (row: MessageSummary) =>
      void operations.trashThread(accountId, row.threadId).catch(() => {}),
    deleteForever(row: MessageSummary) {
      threadLists.update(accountId, (r) => r.threadId === row.threadId);
      void core
        .invoke("gmail:deleteThreadsForever", { accountId, threadIds: [row.threadId] })
        .finally(() => threadLists.invalidate(accountId));
    },
    reportJunk: (row: MessageSummary) => modify(row, ["SPAM"], ["INBOX"]),
    toggleRead(row: MessageSummary) {
      if (row.threadUnread ?? row.unread) modify(row, [], ["UNREAD"]);
      else modify(row, ["UNREAD"], []);
    },
    toggleStar(row: MessageSummary) {
      if (row.threadStarred ?? row.starred) modify(row, [], ["STARRED"]);
      else modify(row, ["STARRED"], []);
    },
    toggleLabel(row: MessageSummary, labelId: string) {
      if (labelsOf(row).includes(labelId)) modify(row, [], [labelId]);
      else modify(row, [labelId], []);
    },
  };

  /** VoiceOver's actions for a row, beyond its swipes. */
  const accessibilityActions = (row: MessageSummary) => [
    {
      title: (row.threadUnread ?? row.unread) ? "Mark as read" : "Mark as unread",
      perform: () => actions.toggleRead(row),
    },
    {
      title: (row.threadStarred ?? row.starred) ? "Unstar" : "Star",
      perform: () => actions.toggleStar(row),
    },
  ];

  /** The Swift app's ThreadActions, as an action sheet (long press). */
  function showMenu(row: MessageSummary): void {
    const unread = row.threadUnread ?? row.unread;
    const starred = row.threadStarred ?? row.starred;
    const own = labels.filter((l) => l.type === "user");
    const items: [string, () => void][] = [
      [unread ? "Mark as read" : "Mark as unread", () => actions.toggleRead(row)],
      [starred ? "Unstar" : "Star", () => actions.toggleStar(row)],
      ...(own.length > 0 ? [["Labels…", () => showLabels(row, own)] as [string, () => void]] : []),
      ...(actions.canArchive(row)
        ? [["Archive", () => actions.archive(row)] as [string, () => void]]
        : []),
      ...(actions.canMoveToInbox(row)
        ? [["Move to Inbox", () => actions.moveToInbox(row)] as [string, () => void]]
        : []),
      ...(!inJunk(row)
        ? [["Report junk", () => actions.reportJunk(row)] as [string, () => void]]
        : []),
      inTrash(row)
        ? ["Delete forever", () => actions.deleteForever(row)]
        : ["Trash", () => actions.trash(row)],
    ];
    const options = [...items.map(([title]) => title), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: row.subject || "(no subject)",
        options,
        destructiveButtonIndex: items.length - 1,
        cancelButtonIndex: items.length,
      },
      (index) => items[index]?.[1](),
    );
  }

  function showLabels(row: MessageSummary, own: readonly MailLabel[]): void {
    const on = new Set(labelsOf(row));
    const options = [...own.map((l) => `${on.has(l.id) ? "✓ " : ""}${l.name}`), "Cancel"];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: "Labels", options, cancelButtonIndex: own.length },
      (index) => {
        const label = own[index];
        if (label) actions.toggleLabel(row, label.id);
      },
    );
  }

  return { ...actions, accessibilityActions, showMenu };
}
