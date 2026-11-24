// Compare both account lists with the previous snapshot to distinguish remote additions from local removals.

import type { ImapSettings } from "@otter/contracts";
import type {
  AliasPictures,
  ListAccountsResponse,
  PutAccountRequest,
  RelayAccount,
} from "@otter/contracts/relay";

import { logger } from "../logger.ts";
import { broadcast } from "../ipc.ts";
import * as accountStore from "./account-store.ts";
import { platform } from "../platform.ts";
import { isSignedIn } from "../providers/index.ts";
import * as mailStore from "./mail-store.ts";
import { getImapPassword, setAsideImapPassword } from "./imap-passwords.ts";
import { getOtterUser, relayRequest, RelayError } from "./otter-account.ts";
import { syncedAliasMailboxes, syncedSendAs, syncedSignature } from "./preferences.ts";
import type { MailAccount } from "../types.ts";

export type LocalAccount = Pick<
  MailAccount,
  | "email"
  | "name"
  | "picture"
  | "displayName"
  | "color"
  | "customPicture"
  | "aliasPictures"
  | "imap"
> & {
  signedIn: boolean;
};

export type ReconcilePlan = {
  link: string[];
  unlink: string[];
  add: RelayAccount[];
  remove: string[];
  update: RelayAccount[];
  moved: string[];
};

const key = (email: string) => email.toLowerCase();

const sameServers = (a: ImapSettings, b: ImapSettings) =>
  a.imap.host.toLowerCase() === b.imap.host.toLowerCase() &&
  a.smtp.host.toLowerCase() === b.smtp.host.toLowerCase();

const samePictures = (a: AliasPictures | null | undefined, b: AliasPictures | null) => {
  const entries = (p: AliasPictures | null | undefined) =>
    JSON.stringify(Object.entries(p ?? {}).sort());
  return entries(a) === entries(b);
};

export function planReconcile(
  local: LocalAccount[],
  remote: RelayAccount[],
  snapshot: ReadonlySet<string>,
): ReconcilePlan {
  const plan: ReconcilePlan = { link: [], unlink: [], add: [], remove: [], update: [], moved: [] };
  const localByKey = new Map(local.map((account) => [key(account.email), account]));
  const remoteKeys = new Set(remote.map((account) => key(account.email)));

  for (const account of remote) {
    const here = localByKey.get(key(account.email));
    if (!here) {
      if (snapshot.has(key(account.email))) plan.unlink.push(account.email);
      else plan.add.push(account);
    } else {
      // A signed-in Gmail or Outlook account refreshes its name and picture
      // from Google or Microsoft itself; the relay's copy could be staler, so
      // even an update for its label or color leaves them alone. A null one
      // never blanks ours.
      const fromGoogle = here.signedIn && !here.imap;
      if (
        (here.displayName ?? null) !== account.displayName ||
        (here.color ?? null) !== account.color ||
        // undefined: a relay from before pictures, which mustn't blank ours.
        (account.customPicture !== undefined &&
          (here.customPicture ?? null) !== account.customPicture) ||
        (account.aliasPictures !== undefined &&
          !samePictures(here.aliasPictures, account.aliasPictures)) ||
        (!fromGoogle && account.name !== null && here.name !== account.name) ||
        (!fromGoogle && account.picture !== null && (here.picture ?? null) !== account.picture)
      ) {
        plan.update.push(fromGoogle ? { ...account, name: null, picture: null } : account);
      }
      if (here.signedIn && here.imap && account.imap && !sameServers(here.imap, account.imap)) {
        plan.moved.push(account.email);
      }
    }
  }
  for (const account of local) {
    if (remoteKeys.has(key(account.email))) continue;
    if (snapshot.has(key(account.email))) plan.remove.push(account.email);
    else if (account.signedIn) plan.link.push(account.email);
  }
  return plan;
}

const SNAPSHOT_KEY = "otter:linkedAccounts";

function readSnapshot(): Set<string> {
  const saved = mailStore.getKv(SNAPSHOT_KEY);
  if (!saved) return new Set();
  try {
    return new Set(JSON.parse(saved) as string[]);
  } catch {
    return new Set();
  }
}

function writeSnapshot(emails: Iterable<string>): void {
  mailStore.setKv(SNAPSHOT_KEY, JSON.stringify([...new Set([...emails].map(key))]));
}

export function clearLinkedSnapshot(): void {
  mailStore.setKv(SNAPSHOT_KEY, "");
}

export function linkedAccountIds(): Set<string> {
  return readSnapshot();
}

const PROVIDERS = "?providers=gmail,imap,outlook";
const accountRoute = (email: string) =>
  `/v1/accounts/${encodeURIComponent(key(email))}${PROVIDERS}`;

const profile = (account: MailAccount) => ({
  name: account.name,
  // Outlook's photo is a data URL, too big for the relay and only this device's to read.
  picture: account.picture?.startsWith("data:") ? null : (account.picture ?? null),
  displayName: account.displayName ?? null,
  color: account.color ?? null,
  customPicture: account.customPicture ?? null,
  aliasPictures: account.aliasPictures ?? null,
});

// This device may not have pulled the pictures another device chose: linking mustn't clear them.
function linkProfile(account: MailAccount) {
  const { customPicture, aliasPictures, ...rest } = profile(account);
  return {
    ...rest,
    ...(customPicture ? { customPicture } : {}),
    ...(aliasPictures ? { aliasPictures } : {}),
  };
}

/**
 * What links an account: Gmail proves the sign-in with a Google ID token,
 * Outlook with a Microsoft one; IMAP sends its server settings (never the
 * password).
 */
export async function linkRequest(
  account: MailAccount,
  idToken: (accountId: string) => Promise<string>,
): Promise<PutAccountRequest> {
  if (account.provider === "imap") {
    return { provider: "imap", imap: account.imap, ...linkProfile(account) };
  }
  if (account.provider === "outlook") {
    return { provider: "outlook", idToken: await idToken(account.id), ...linkProfile(account) };
  }
  return { idToken: await idToken(account.id), ...linkProfile(account) };
}

async function link(account: MailAccount): Promise<void> {
  const body = await linkRequest(account, (id) => {
    const auth = account.provider === "outlook" ? platform().microsoft : platform().google;
    if (!auth) throw new Error("This app can't sign in to Outlook.");
    return auth.getIdToken(id);
  });
  await relayRequest("PUT", accountRoute(account.email), body);
}

export function accountFromRelay(account: RelayAccount): MailAccount {
  const imap = account.provider === "imap" && account.imap;
  return {
    id: account.email,
    email: account.email,
    name: account.name ?? account.email,
    ...(imap
      ? {
          provider: "imap",
          imap,
          signature: syncedSignature(account.email),
          sendAs: syncedSendAs(account.email),
          aliasMailboxes: syncedAliasMailboxes(account.email),
        }
      : {}),
    ...(account.provider === "outlook"
      ? { provider: "outlook", signature: syncedSignature(account.email) }
      : {}),
    picture: account.picture ?? undefined,
    displayName: account.displayName ?? undefined,
    color: account.color ?? undefined,
    customPicture: account.customPicture ?? undefined,
    aliasPictures: account.aliasPictures ?? undefined,
  };
}

export async function accountAdded(account: MailAccount): Promise<void> {
  if (!getOtterUser()) return;
  try {
    await link(account);
    writeSnapshot([...readSnapshot(), account.email]);
  } catch (err) {
    logger.failure("linked-accounts", `Couldn't link ${account.email}`, err);
  }
}

export async function accountRemoved(email: string): Promise<void> {
  if (!getOtterUser()) return;
  try {
    await relayRequest("DELETE", accountRoute(email));
    const snapshot = readSnapshot();
    snapshot.delete(key(email));
    writeSnapshot(snapshot);
  } catch (err) {
    logger.failure("linked-accounts", `Couldn't unlink ${email}`, err);
  }
}

export async function accountEdited(
  account: MailAccount,
  fields: (keyof ReturnType<typeof profile>)[],
): Promise<void> {
  if (!getOtterUser() || !readSnapshot().has(key(account.email))) return;
  const all = profile(account);
  const edited = Object.fromEntries(fields.map((field) => [field, all[field]]));
  await relayRequest("PUT", accountRoute(account.email), edited).catch((err: unknown) => {
    logger.failure("linked-accounts", `Couldn't update ${account.email}`, err);
  });
}

export async function reconcileAccounts(
  removeLocal: (accountId: string) => Promise<void>,
): Promise<void> {
  if (!getOtterUser()) return;
  const { accounts: remote } = await relayRequest<ListAccountsResponse>(
    "GET",
    `/v1/accounts${PROVIDERS}`,
  );
  const localAccounts = await accountStore.listAccounts();
  const byKey = new Map(localAccounts.map((account) => [key(account.email), account]));
  const plan = planReconcile(
    localAccounts.map((account) => ({
      ...account,
      signedIn: isSignedIn(account),
    })),
    remote,
    readSnapshot(),
  );

  const linked = new Set(remote.map((account) => key(account.email)));
  for (const email of plan.unlink) {
    await relayRequest("DELETE", accountRoute(email));
    linked.delete(key(email));
  }
  for (const email of plan.link) {
    try {
      await link(byKey.get(key(email))!);
      linked.add(key(email));
    } catch (err) {
      if (err instanceof RelayError && err.status === 401) throw err;
      logger.failure("linked-accounts", `Couldn't link ${email}`, err);
    }
  }
  for (const account of plan.add) {
    if (account.provider === "imap" && !account.imap) continue;
    await accountStore.addAccount(accountFromRelay(account));
  }
  for (const email of plan.remove) {
    await removeLocal(byKey.get(key(email))!.id);
  }
  for (const account of plan.update) {
    await accountStore.updateAccount(byKey.get(key(account.email))!.id, {
      name: account.name ?? undefined,
      picture: account.picture ?? undefined,
      displayName: account.displayName ?? "",
      color: account.color ?? "",
      customPicture:
        account.customPicture === undefined ? undefined : (account.customPicture ?? ""),
      aliasPictures:
        account.aliasPictures === undefined ? undefined : (account.aliasPictures ?? {}),
    });
  }
  for (const email of plan.moved) {
    const here = byKey.get(key(email))!;
    const password = getImapPassword(here.id);
    if (password) {
      setAsideImapPassword(here.id, password, "the Otter account lists other servers for it");
    }
  }
  writeSnapshot(linked);

  const changed = plan.add.length + plan.remove.length + plan.update.length > 0;
  if (changed) broadcast("gmail:accounts-changed");
  if (Object.values(plan).some((list) => list.length > 0)) {
    logger.info("linked-accounts", "Reconciled", {
      linked: plan.link.length,
      unlinked: plan.unlink.length,
      added: plan.add.length,
      removed: plan.remove.length,
      updated: plan.update.length,
      moved: plan.moved.length,
    });
  }
}
