import type { MailCapabilities } from "@otter-mail/contracts";
import type { MailLabel } from "../mail.ts";

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
