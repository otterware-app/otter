import { useEffect, useState } from "react";
import { aliasMailboxesOf, type AliasMailboxEntry } from "@otter/client/mail/alias-mailboxes";
import { useAccounts } from "@otter/client/mail/hooks";
import type { MailAccount } from "@otter/client/mail/types";
import { setSyncedPreference, type SyncedKey } from "@otter/client/preferences";

/**
 * Accounts by address, alias mailboxes by id, in the sidebar's order. One not in `order` yet
 * follows the tab before it in the default order (each account followed by its alias
 * mailboxes), so a new alias mailbox starts beside its parent.
 */
export type MailboxArrangement = {
  order: string[];
  off: string[];
};

export type MailboxTab = { id: string; account: MailAccount; alias?: AliasMailboxEntry };

const KEY = "mail:mailboxes";
/** Parents, lower-cased, whose tab leaves out their alias mailboxes' mail. */
const APART_KEY = "mail:alias-mail-apart";
const CHANGE_EVENT = "otter:mailboxes-change";

function readJson<T>(key: SyncedKey, parse: (value: unknown) => T): T {
  try {
    return parse(JSON.parse(localStorage.getItem(key) ?? "null"));
  } catch {
    return parse(null);
  }
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const readArrangement = () =>
  readJson(KEY, (value): MailboxArrangement => {
    const { order, off } = (value ?? {}) as Partial<Record<keyof MailboxArrangement, unknown>>;
    return { order: strings(order), off: strings(off) };
  });

const readApart = () => readJson(APART_KEY, strings);

function write(key: SyncedKey, value: unknown): void {
  setSyncedPreference(key, JSON.stringify(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function useStored<T>(key: SyncedKey, read: () => T): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    const update = () => setValue(read());
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) update();
    };
    window.addEventListener(CHANGE_EVENT, update);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(CHANGE_EVENT, update);
      window.removeEventListener("storage", onStorage);
    };
  }, [key, read]);
  return value;
}

export function setMailboxArrangement(next: MailboxArrangement): void {
  write(KEY, next);
}

export function useMailboxArrangement(): MailboxArrangement {
  return useStored(KEY, readArrangement);
}

/** Whether `parent`'s tab shows its alias mailboxes' mail too (the default). */
export function useAliasMailInParent(parent: MailAccount): [boolean, (on: boolean) => void] {
  const apart = useStored(APART_KEY, readApart);
  const key = parent.email.toLowerCase();
  return [
    !apart.includes(key),
    (on) => write(APART_KEY, on ? apart.filter((k) => k !== key) : [...apart, key]),
  ];
}

function arrangeBy<T>(items: T[], keyOf: (item: T) => string, { order }: MailboxArrangement): T[] {
  const rank = (item: T) => {
    const i = order.indexOf(keyOf(item));
    return i === -1 ? order.length : i;
  };
  return items
    .map((item, added) => ({ item, added }))
    .sort((x, y) => rank(x.item) - rank(y.item) || x.added - y.added)
    .map((x) => x.item);
}

export const arrangementKey = (tab: MailboxTab): string => tab.alias?.id ?? tab.account.email;

/** `accounts`: all of them, turned off too. */
export function arrangeMailboxes(
  accounts: MailAccount[],
  arrangement: MailboxArrangement,
): MailboxTab[] {
  const byDefault = arrangeBy(accounts, (a) => a.email, arrangement).flatMap((account) => [
    { id: account.id, account },
    ...arrangeBy(aliasMailboxesOf(account, accounts), (a) => a.id, arrangement).map((alias) => ({
      id: alias.id,
      account,
      alias,
    })),
  ]);
  let previous = -1;
  return byDefault
    .map((tab, i) => {
      const at = arrangement.order.indexOf(arrangementKey(tab));
      if (at !== -1) previous = at;
      return { tab, rank: previous, i };
    })
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.tab);
}

/** Puts `key` before or after `target`; the tabs turned off keep their places. */
export function moveMailbox(
  accounts: MailAccount[],
  arrangement: MailboxArrangement,
  key: string,
  target: string,
  after: boolean,
): MailboxArrangement {
  const order = arrangeMailboxes(accounts, arrangement)
    .map(arrangementKey)
    .filter((k) => k !== key);
  order.splice(order.indexOf(target) + (after ? 1 : 0), 0, key);
  return { ...arrangement, order };
}

export function useMailboxes(): {
  accounts: MailAccount[];
  tabs: MailboxTab[];
  aliases: AliasMailboxEntry[];
  isLoading: boolean;
  /** Tab ids: puts `id` before or after `target`. */
  move: (id: string, target: string, after: boolean) => void;
} {
  const query = useAccounts();
  const arrangement = useMailboxArrangement();
  const all = arrangeMailboxes(query.data ?? [], arrangement);
  const tabs = all.filter(
    (tab) =>
      !arrangement.off.includes(tab.account.email) &&
      !(tab.alias && arrangement.off.includes(tab.alias.id)),
  );
  const keyOf = (id: string) => {
    const tab = all.find((t) => t.id === id);
    return tab ? arrangementKey(tab) : id;
  };
  return {
    accounts: tabs.flatMap((tab) => (tab.alias ? [] : [tab.account])),
    tabs,
    aliases: tabs.flatMap((tab) => (tab.alias ? [tab.alias] : [])),
    isLoading: query.isLoading,
    move: (id, target, after) =>
      setMailboxArrangement(
        moveMailbox(query.data ?? [], arrangement, keyOf(id), keyOf(target), after),
      ),
  };
}
