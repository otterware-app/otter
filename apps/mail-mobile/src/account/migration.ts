import type { AliasMailbox, ImapSettings } from "@otter/contracts";
import type { MailAccount, Platform } from "@otter/core";
import { native } from "@otter/mobile/native";

type SwiftMailbox = {
  email: string;
  name: string;
  displayName?: string;
  color?: string;
  signature?: string;
  picture?: string;
  customPicture?: string;
  aliasPictures?: Record<string, string>;
  imap?: ImapSettings;
  outlook?: boolean;
  parent?: string;
};

type SwiftAddresses = {
  sendAs?: Record<string, string[]>;
  aliasMailboxes?: Record<string, AliasMailbox[]>;
};

function readSaved<T>(value?: string): T | undefined {
  try {
    return value ? (JSON.parse(value) as T) : undefined;
  } catch {
    return undefined;
  }
}

export async function importSwiftMailboxes({ files }: Platform): Promise<void> {
  const path = "accounts.json";
  const settings = native.existingMailSettings();
  const saved = readSaved<SwiftMailbox[]>(settings["otter:mailboxes"]);
  if (!Array.isArray(saved) || (await files.read(path)) !== null) return;

  const addresses = readSaved<SwiftAddresses>(settings["otter:addresses"]);
  const accounts = new Map<string, MailAccount>();
  for (const mailbox of saved) {
    if (typeof mailbox?.email !== "string" || !mailbox.email.includes("@") || mailbox.parent)
      continue;
    const email = mailbox.email.toLowerCase();
    accounts.set(email, {
      id: email,
      email,
      name: mailbox.name || email,
      displayName: mailbox.displayName,
      color: mailbox.color,
      signature: mailbox.signature,
      picture: mailbox.picture,
      customPicture: mailbox.customPicture,
      aliasPictures: mailbox.aliasPictures,
      provider: mailbox.imap ? "imap" : mailbox.outlook ? "outlook" : "gmail",
      imap: mailbox.imap,
      sendAs: addresses?.sendAs?.[email],
      aliasMailboxes: addresses?.aliasMailboxes?.[email],
    });
  }
  await files.write(path, JSON.stringify([...accounts.values()]));
}
