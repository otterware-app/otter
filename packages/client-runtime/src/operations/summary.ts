import { ARCHIVE_LABEL_ID } from "@otter-mail/contracts";

import type { ActionSummary } from "./undo.ts";

export function summarizeLabelChange(
  add: string[],
  remove: string[],
  noun: ActionSummary["noun"],
  labelName: (labelId: string) => string | undefined,
  archiveFolder = false,
): ActionSummary {
  const s = (verb: string, suffix?: string): ActionSummary => ({ verb, suffix, noun });
  const quoted = (id: string) => `“${labelName(id) ?? id}”`;
  const isUser = (id: string) => labelName(id) !== undefined;

  if (add.includes("TRASH")) return s("Moved", " to Trash");
  if (remove.includes("TRASH")) return s("Restored", " from Trash");
  if (add.includes("SPAM")) return s("Marked", " as junk");
  if (remove.includes("SPAM")) return s("Marked", " as not junk");

  const addedLabel = add.find(isUser);
  if (addedLabel) {
    return remove.length > 0
      ? s("Moved", ` to ${quoted(addedLabel)}`)
      : s("Labeled", ` ${quoted(addedLabel)}`);
  }
  if (add.includes("INBOX")) return s("Moved", " to Inbox");
  if (remove.includes("INBOX") || add.includes(ARCHIVE_LABEL_ID)) return s("Archived");
  if (remove.includes(ARCHIVE_LABEL_ID)) return s("Moved", " to Inbox");
  const removedLabel = remove.find(isUser);
  if (removedLabel && archiveFolder && !removedLabel.startsWith("category:")) return s("Archived");
  if (removedLabel) return s("Removed", ` from ${quoted(removedLabel)}`);
  if (add.includes("STARRED")) return s("Flagged");
  if (remove.includes("STARRED")) return s("Unflagged");
  if (add.includes("UNREAD")) return s("Marked", " as unread");
  if (remove.includes("UNREAD")) return s("Marked", " as read");
  if (add.includes("IMPORTANT")) return s("Marked", " as important");
  if (remove.includes("IMPORTANT")) return s("Marked", " as not important");
  return s("Updated");
}
