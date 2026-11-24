import { aliasMailboxName, validAliasMailboxes, type AliasMailbox } from "@otter/contracts";
import { getAccountColor } from "./account-style.ts";
import { capabilitiesOf } from "./capabilities.ts";
import type { MailAccount } from "./types.ts";

export type AliasMailboxEntry = {
  id: string;
  alias: AliasMailbox;
  parent: MailAccount;
  name: string;
  color: string;
};

export const aliasMailboxId = (address: string): string => address.toLowerCase();

/** `accounts`: all of them, turned off too. */
export function aliasMailboxesOf(
  account: MailAccount,
  accounts: MailAccount[],
): AliasMailboxEntry[] {
  if (capabilitiesOf(account).sendAs !== "device") return [];
  return validAliasMailboxes(
    account,
    accounts.map((a) => a.email),
  ).map((alias) => {
    const id = aliasMailboxId(alias.address);
    const color = getAccountColor({ id, color: alias.color || undefined });
    return { id, alias, parent: account, name: aliasMailboxName(alias), color };
  });
}

export function aliasMailboxLook(entry: AliasMailboxEntry): MailAccount {
  return {
    id: entry.id,
    email: entry.alias.address,
    name: entry.name,
    color: entry.color,
    customPicture: entry.parent.aliasPictures?.[entry.id],
  };
}

export function withAliasMailbox(
  account: MailAccount,
  address: string,
  patch: Partial<AliasMailbox> | null,
): AliasMailbox[] {
  const aliases = account.aliasMailboxes ?? [];
  const id = aliasMailboxId(address);
  if (patch === null) return aliases.filter((a) => aliasMailboxId(a.address) !== id);
  // An empty field is the default again, as core stores it.
  const set = (alias: AliasMailbox): AliasMailbox => {
    const { name, color, signature } = { ...alias, ...patch };
    return {
      address: alias.address,
      ...(name ? { name } : {}),
      ...(color ? { color } : {}),
      ...(signature ? { signature } : {}),
    };
  };
  return aliases.some((a) => aliasMailboxId(a.address) === id)
    ? aliases.map((a) => (aliasMailboxId(a.address) === id ? set(a) : a))
    : [...aliases, set({ address })];
}

export function signatureFor(
  account: MailAccount,
  address: string | undefined,
): string | undefined {
  const id = address ? aliasMailboxId(address) : null;
  const alias = account.aliasMailboxes?.find((a) => aliasMailboxId(a.address) === id);
  return alias?.signature || account.signature;
}
