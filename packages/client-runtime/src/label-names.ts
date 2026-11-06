import type { MailCapabilities } from "@otter-mail/contracts";
import type { MailLabel } from "./mail.ts";

export const ALL_MAIL_LABEL_ID = "ALL_MAIL";

export { ARCHIVE_LABEL_ID, SNOOZED_LABEL_ID } from "@otter-mail/contracts";

export const SYSTEM_LABEL_NAMES: Record<string, string> = {
  INBOX: "Inbox",
  SENT: "Sent",
  DRAFT: "Drafts",
  SPAM: "Spam",
  TRASH: "Trash",
  ARCHIVE: "Archive",
  SNOOZED: "Snoozed",
  UNREAD: "Unread",
  STARRED: "Starred",
  IMPORTANT: "Important",
  CATEGORY_PERSONAL: "Personal",
  CATEGORY_SOCIAL: "Social",
  CATEGORY_PROMOTIONS: "Promotions",
  CATEGORY_UPDATES: "Updates",
  CATEGORY_FORUMS: "Forums",
  CHAT: "Chat",
};

export const SYSTEM_LABEL_ORDER = Object.keys(SYSTEM_LABEL_NAMES);

export function folderName(labelId: string, capabilities: MailCapabilities): string | undefined {
  if (labelId === "STARRED") return capabilities.stars ? "Starred" : "Flagged";
  if (labelId === "SPAM") return "Junk";
  if (labelId === ALL_MAIL_LABEL_ID) return "All Mail";
  return SYSTEM_LABEL_NAMES[labelId];
}

export function labelDisplayName(label: MailLabel): string {
  if (label.type === "system") {
    return SYSTEM_LABEL_NAMES[label.id] ?? label.name;
  }
  return label.name;
}
