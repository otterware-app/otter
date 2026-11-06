import { Atom, type AtomRegistry } from "effect/reactivity";

import type { CoreBridge } from "../connection/index.ts";
import type { MailboxInfo, MailLabel } from "../mail.ts";

export type Loadable<A> = { value: A; loading: boolean; error: string | null };

const pending = <A>(value: A): Loadable<A> => ({ value, loading: true, error: null });

export type Mailboxes<M extends MailboxInfo = MailboxInfo> = ReturnType<typeof makeMailboxes<M>>;

/**
 * The mailboxes (`gmail:listAccounts`, again on `gmail:accounts-changed`) and
 * each one's labels (`gmail:listLabels`), as atoms.
 */
export function makeMailboxes<M extends MailboxInfo = MailboxInfo>(
  registry: AtomRegistry.AtomRegistry,
  core: CoreBridge,
) {
  const accountsAtom = Atom.make<Loadable<M[]>>(pending([])).pipe(Atom.keepAlive);
  const labelsAtom = Atom.family((_accountId: string) =>
    Atom.make<Loadable<MailLabel[]>>(pending([])).pipe(Atom.keepAlive),
  );

  async function fill<A>(atom: Atom.Writable<Loadable<A>>, load: () => Promise<A>) {
    registry.set(atom, { ...registry.get(atom), loading: true });
    try {
      registry.set(atom, { value: await load(), loading: false, error: null });
    } catch (error) {
      registry.set(atom, {
        ...registry.get(atom),
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const refreshAccounts = () => fill(accountsAtom, () => core.invoke<M[]>("gmail:listAccounts"));
  const refreshLabels = (accountId: string) =>
    fill(labelsAtom(accountId), () => core.invoke<MailLabel[]>("gmail:listLabels", { accountId }));

  /** Loads the mailboxes and follows their changes; returns how to stop. */
  function start(): () => void {
    void refreshAccounts();
    return core.on("gmail:accounts-changed", () => void refreshAccounts());
  }

  return {
    accountsAtom: accountsAtom as Atom.Atom<Loadable<M[]>>,
    labelsAtom: (accountId: string) => labelsAtom(accountId) as Atom.Atom<Loadable<MailLabel[]>>,
    mailboxAtom: Atom.family((accountId: string) =>
      Atom.make((get) => get(accountsAtom).value.find((m) => m.id === accountId) ?? null),
    ),
    start,
    refreshAccounts,
    refreshLabels,
  };
}
