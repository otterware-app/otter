import { aliasMailboxLook, aliasMailboxesOf } from "@otter/client/mail/alias-mailboxes";
import { useAccounts } from "@otter/client/mail/hooks";
import type { MailAccount } from "@otter/client/mail/types";

import { useMailboxArrangement } from "../settings/preferences.ts";

export type Mailbox = { look: MailAccount; account: MailAccount; alias?: string; enabled: boolean };

export function useMailboxes() {
  const accounts = useAccounts();
  const arrangement = useMailboxArrangement();
  const all = accounts.data ?? [];
  const positions = new Map(arrangement.order.map((id, index) => [id, index]));
  const isEnabled = (id: string) => !arrangement.off.includes(id);
  const sort = (a: string, b: string) =>
    (positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity);
  const mailboxes: Mailbox[] = [...all]
    .sort((a, b) => sort(a.id, b.id))
    .flatMap((account) => [
      { account, look: account, enabled: isEnabled(account.id) },
      ...aliasMailboxesOf(account, all)
        .sort((a, b) => sort(a.id, b.id))
        .map((entry) => ({
          account,
          look: aliasMailboxLook(entry),
          alias: entry.alias.address,
          enabled: isEnabled(account.id) && isEnabled(entry.id),
        })),
    ]);
  return { ...accounts, mailboxes };
}
