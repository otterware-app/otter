import { validAliasMailboxes, type AliasMailbox } from "@otter/contracts";

import { broadcast } from "../ipc.ts";
import { getAccount, isAccountId, listAccounts } from "./account-store.ts";
import { addressList, type AliasScope, type MailboxScope, type RestScope } from "./mail-store.ts";
import { turnedOffMailboxes } from "./mail-sync.ts";
import type { MailAccount, MessageSummary } from "../types.ts";

export function parseAliasMailboxes(value: unknown): AliasMailbox[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((entry): AliasMailbox[] => {
    const fields = (entry ?? {}) as Record<string, unknown>;
    const text = (key: string) =>
      typeof fields[key] === "string" && fields[key].trim() ? fields[key] : undefined;
    const address = text("address")?.trim();
    if (!address?.includes("@") || seen.has(address.toLowerCase())) return [];
    seen.add(address.toLowerCase());
    const [name, color, signature] = [text("name"), text("color"), text("signature")];
    return [
      {
        address,
        ...(name ? { name } : {}),
        ...(color ? { color } : {}),
        ...(signature ? { signature } : {}),
      },
    ];
  });
}

/** The alias mailbox a message is for: the first of theirs in To, then in Cc, then where it was delivered. */
export function aliasMailboxFor(
  aliases: AliasMailbox[],
  message: Pick<MessageSummary, "to" | "cc" | "deliveredTo">,
): AliasMailbox | undefined {
  const byAddress = new Map(aliases.map((alias) => [alias.address.toLowerCase(), alias]));
  const first = (list: string | undefined) =>
    addressList(list ?? "")
      .map((address) => byAddress.get(address))
      .find(Boolean);
  return (
    first(message.to) ??
    first(message.cc) ??
    message.deliveredTo?.map((address) => byAddress.get(address)).find(Boolean)
  );
}

export function aliasScopeOf(parent: MailAccount | null, alias: string): AliasScope {
  return {
    address: alias.toLowerCase(),
    sendAs: (parent?.sendAs ?? []).map((a) => a.toLowerCase()),
  };
}

export async function aliasScope(accountId: string, alias: string): Promise<AliasScope> {
  return aliasScopeOf(await getAccount(accountId), alias);
}

/**
 * Parents, by address lower-cased, whose tab leaves out their alias mailboxes' mail: the
 * renderer's synced UI preference `mail:alias-mail-apart`.
 */
let apart = new Set<string>();

export function followAliasMailApart(value: string | undefined): void {
  let next: string[] = [];
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    if (Array.isArray(parsed)) next = parsed.filter((e): e is string => typeof e === "string");
  } catch {
    // Unreadable: every parent shows all of its mail.
  }
  const changed = next.length !== apart.size || next.some((key) => !apart.has(key));
  apart = new Set(next);
  if (changed) broadcast("gmail:mail-changed");
}

/**
 * The parent's tab without its alias mailboxes' mail, when it's set apart and has any turned on:
 * a turned-off one's mail stays in the parent, or it would be nowhere.
 */
export async function restScope(accountId: string): Promise<RestScope | undefined> {
  const account = await getAccount(accountId);
  if (!account || !apart.has(account.email.toLowerCase())) return undefined;
  const emails = (await listAccounts()).map((a) => a.email);
  const off = turnedOffMailboxes();
  const aliases = validAliasMailboxes(account, emails)
    .map((a) => a.address.toLowerCase())
    .filter((id) => !off.has(id));
  if (aliases.length === 0) return undefined;
  return { aliases, sendAs: (account.sendAs ?? []).map((a) => a.toLowerCase()) };
}

export async function resolveMailbox(
  id: string,
): Promise<{ accountId: string; scope?: MailboxScope }> {
  const accounts = await listAccounts();
  if (isAccountId(id) || accounts.some((a) => a.id === id)) {
    return { accountId: id, scope: await restScope(id) };
  }
  const emails = accounts.map((a) => a.email);
  const parent = accounts.find((account) =>
    validAliasMailboxes(account, emails).some((alias) => alias.address.toLowerCase() === id),
  );
  return parent ? { accountId: parent.id, scope: aliasScopeOf(parent, id) } : { accountId: id };
}
