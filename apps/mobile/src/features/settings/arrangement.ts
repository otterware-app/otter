import { aliasMailboxName, validAliasMailboxes, type AliasMailbox } from "@otter-mail/contracts";

/**
 * `mail:mailboxes`, as the Mac, the web and the Swift app keep it: every mailbox's
 * place, alias mailboxes among the rest (by address, lower-cased), and the
 * ones turned off. `mail:alias-mail-apart`: parents whose list leaves out
 * their alias mailboxes' mail.
 */
export type Arrangement = { order: string[]; off: string[] };

export type ArrangedMailbox = {
  email: string;
  provider?: string;
  capabilities?: { sendAs?: "server" | "device" };
  sendAs?: string[];
  aliasMailboxes?: AliasMailbox[];
};

/** A row: a mailbox, or one of its alias mailboxes (`alias`, with its parent as `mailbox`). */
export type Scope<M extends ArrangedMailbox> = {
  key: string;
  mailbox: M;
  alias?: { address: string; name: string; color?: string };
};

const strings = (v: unknown) =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];

export function parseArrangement(value: string | undefined): Arrangement {
  try {
    const parsed = JSON.parse(value ?? "{}") as { order?: unknown; off?: unknown } | null;
    return { order: strings(parsed?.order), off: strings(parsed?.off) };
  } catch {
    return { order: [], off: [] };
  }
}

export function parseApart(value: string | undefined): string[] {
  try {
    return strings(JSON.parse(value ?? "[]"));
  } catch {
    return [];
  }
}

/** core's validAliasMailboxes: still in its Send from, not a mailbox, not an earlier mailbox's. */
export function aliasesOf<M extends ArrangedMailbox>(mailbox: M, all: M[]): Scope<M>[] {
  if (mailbox.capabilities?.sendAs !== "device") return [];
  const earlier = new Set(
    all
      .slice(
        0,
        all.findIndex((m) => m.email === mailbox.email),
      )
      .flatMap((m) =>
        m.capabilities?.sendAs === "device"
          ? validAliasMailboxes(
              m,
              all.map((a) => a.email),
            ).map((a) => a.address.toLowerCase())
          : [],
      ),
  );
  return validAliasMailboxes(
    mailbox,
    all.map((m) => m.email),
  )
    .filter((alias) => !earlier.has(alias.address.toLowerCase()))
    .map((alias) => ({
      key: alias.address.toLowerCase(),
      mailbox,
      alias: { address: alias.address, name: aliasMailboxName(alias), color: alias.color },
    }));
}

function arrangeBy<T>(items: T[], keyOf: (item: T) => string, order: string[]): T[] {
  const rank = (item: T) => {
    const i = order.indexOf(keyOf(item));
    return i === -1 ? order.length : i;
  };
  return items
    .map((item, added) => ({ item, added }))
    .sort((x, y) => rank(x.item) - rank(y.item) || x.added - y.added)
    .map((x) => x.item);
}

/**
 * Every row in the menu's order. One not in `order` yet follows the row before it in the default
 * order (each mailbox, then its alias mailboxes), so a new alias mailbox starts beside its parent.
 */
export function arrangeScopes<M extends ArrangedMailbox>(
  mailboxes: M[],
  { order }: Arrangement,
): Scope<M>[] {
  const byDefault = arrangeBy(mailboxes, (m) => m.email, order).flatMap((mailbox) => [
    { key: mailbox.email, mailbox } as Scope<M>,
    ...arrangeBy(aliasesOf(mailbox, mailboxes), (s) => s.key, order),
  ]);
  let previous = -1;
  return byDefault
    .map((scope, i) => {
      const at = order.indexOf(scope.key);
      if (at !== -1) previous = at;
      return { scope, rank: previous, i };
    })
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.scope);
}

/** Settings' list when not editing: each mailbox with its alias mailboxes under it. */
export function groupScopes<M extends ArrangedMailbox>(scopes: Scope<M>[]): Scope<M>[] {
  return scopes
    .filter((s) => !s.alias)
    .flatMap((parent) => [
      parent,
      ...scopes.filter((s) => s.alias && s.mailbox.email === parent.mailbox.email),
    ]);
}

/** Shown: on, and an alias mailbox's parent on too. */
export const isShown = <M extends ArrangedMailbox>(scope: Scope<M>, { off }: Arrangement) =>
  !off.includes(scope.key) && !off.includes(scope.mailbox.email);

/** Moves the row at `from` to `to` (both in `arrangeScopes`' order). */
export function moveScope<M extends ArrangedMailbox>(
  mailboxes: M[],
  arrangement: Arrangement,
  from: number,
  to: number,
): Arrangement {
  const order = arrangeScopes(mailboxes, arrangement).map((s) => s.key);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved!);
  return { ...arrangement, order };
}

/** Turns a row on or off; `off` stays in the menu's order. */
export function setScopeOn<M extends ArrangedMailbox>(
  mailboxes: M[],
  arrangement: Arrangement,
  key: string,
  on: boolean,
): Arrangement {
  const off = new Set(arrangement.off);
  if (on) off.delete(key);
  else off.add(key);
  const keys = arrangeScopes(mailboxes, arrangement).map((s) => s.key);
  return {
    ...arrangement,
    off: [...keys.filter((k) => off.has(k)), ...[...off].filter((k) => !keys.includes(k))],
  };
}
