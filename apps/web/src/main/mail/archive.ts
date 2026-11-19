import { isFolderLabel, type MailCapabilities } from "@otter/contracts";
import { ALL_MAIL_LABEL_ID } from "./label-names";
import type { MailLabel } from "./types";

export function archiveFrom(
  labelIds: readonly string[],
  listLabel: MailLabel | undefined,
  capabilities: MailCapabilities,
): string | null {
  if (
    capabilities.archiveFolder &&
    listLabel?.type === "user" &&
    !listLabel.id.startsWith("category:") &&
    labelIds.includes(listLabel.id)
  ) {
    return listLabel.id;
  }
  return labelIds.includes("INBOX") ? "INBOX" : null;
}

/**
 * The folder a list shows, when it shows one: where Archive is a folder (Outlook, IMAP),
 * moving a conversation from that list takes only what's in it (contracts' `inThreadChange`).
 */
export function actedFrom(viewLabelIds: Iterable<string>): string | undefined {
  const folders = [...viewLabelIds].filter((id) => id !== ALL_MAIL_LABEL_ID && isFolderLabel(id));
  return folders.length === 1 ? folders[0] : undefined;
}
