import type { MailCapabilities } from "@otter-mail/contracts";
import { isAssignableLabel } from "@otter-mail/client-runtime/label-tree";
import type { MailLabel } from "@otter-mail/client-runtime/mail";

/**
 * What a conversation can be filed under, per provider (the web's label
 * picker): Gmail's labels, several at once; Outlook's categories, several at
 * once, and its folders, one at a time; IMAP's folders, one at a time.
 */
export function labelChoices(labels: readonly MailLabel[], capabilities?: MailCapabilities) {
  const own = labels.filter(isAssignableLabel);
  const split = capabilities?.foldersAndCategories === true;
  const several = capabilities ? capabilities.multipleLabels : true;
  return {
    /** Toggled one by one. */
    tags: split ? own.filter((l) => !l.id.startsWith("folder:")) : several ? own : [],
    tagsTitle: split ? "Categories" : "Labels",
    /** Moved into. */
    folders: split ? own.filter((l) => l.id.startsWith("folder:")) : several ? [] : own,
  };
}

/** A move into `folderId`: out of every other folder it's in (the web's moveToFolder). */
export function moveToFolder(
  labelIds: readonly string[],
  folderId: string,
  folders: readonly MailLabel[],
) {
  const ids = new Set(["INBOX", "ARCHIVE", "SNOOZED", ...folders.map((l) => l.id)]);
  return {
    addLabelIds: [folderId],
    removeLabelIds: labelIds.filter((id) => id !== folderId && ids.has(id)),
  };
}

/** apps/ios's bulk Labels: "Remove" when every selected conversation has it, else "Add". */
export const bulkTagVerb = (applied: readonly boolean[]) =>
  applied.length > 0 && applied.every(Boolean) ? "Remove" : "Add";

export const leaf = (name: string) => name.split("/").at(-1) ?? name;
