import { OTTER_ACCOUNT_STATE_CHANNEL, type OtterAccountState } from "@otter-mail/contracts";
import { Atom } from "effect/reactivity";
import { DevSettings } from "react-native";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import { appAtomRegistry, clientPlatform, mailboxes } from "./client";
import { core, fakeMailbox } from "./core";
import { DEMO_FILE } from "./demo";

/**
 * The Swift app's Session: who you are (the Otter account) or the demo mailbox,
 * else the welcome. A copy of the account stays in client storage so a cold
 * start opens on the mail, not on the welcome, while core starts.
 */
export type OtterUser = NonNullable<OtterAccountState["user"]>;
export type Session = "starting" | "welcome" | "demo" | "signedIn";

const CACHE_KEY = "mobile:otter-user";

function cachedUser(): OtterUser | null | undefined {
  const saved = clientPlatform.storage.getItem(CACHE_KEY);
  if (saved === null) return undefined;
  try {
    return JSON.parse(saved) as OtterUser | null;
  } catch {
    return undefined;
  }
}

/** undefined until core has answered (or the cache did). */
export const otterUserAtom = Atom.make<OtterUser | null | undefined>(cachedUser()).pipe(
  Atom.keepAlive,
);
export const realtimeAtom = Atom.make<string | undefined>(undefined).pipe(Atom.keepAlive);

/** The demo, chosen on the welcome (or the build's made-up mailbox): core started on it. */
export const inDemo = fakeMailbox;

export const sessionAtom = Atom.make((get): Session => {
  if (inDemo) return "demo";
  const user = get(otterUserAtom);
  return user === undefined ? "starting" : user ? "signedIn" : "welcome";
});

function take(state: OtterAccountState): void {
  appAtomRegistry.set(otterUserAtom, state.user);
  appAtomRegistry.set(realtimeAtom, state.realtime);
  clientPlatform.storage.setItem(CACHE_KEY, JSON.stringify(state.user));
}

let started = false;

export function startOtterAccount(): void {
  if (started) return;
  started = true;
  void core.invoke<OtterAccountState>("otter:getState").then(take, () => {});
  core.on(OTTER_ACCOUNT_STATE_CHANNEL, (state) => take(state as OtterAccountState));
}

/**
 * The welcome's "Sign in with Google": one consent adds the Gmail mailbox and
 * its ID token signs in to (or creates) the Otter account, which then links
 * it and brings the account's other mailboxes. False when cancelled.
 */
export async function signInWithGoogle(): Promise<boolean> {
  const account = await core.invoke<{ id: string } | null>("gmail:addAccount");
  if (!account) return false;
  const state = await core.invoke<OtterAccountState | null>("otter:signIn", {
    accountId: account.id,
  });
  if (state) take(state);
  await mailboxes.refreshAccounts();
  return state !== null;
}

/** Signed out, the mailboxes leave this iPhone (their mail stays on the servers, and on other devices). */
async function forgetMailboxes(): Promise<void> {
  const accounts = await core.invoke<{ id: string }[]>("gmail:listAccounts");
  for (const account of accounts) {
    await core.invoke("gmail:removeAccount", { accountId: account.id }).catch(() => {});
  }
  await mailboxes.refreshAccounts();
}

export async function signOut(): Promise<void> {
  const state = await core.invoke<OtterAccountState>("otter:signOut");
  await forgetMailboxes();
  take(state);
}

export async function deleteAccount(): Promise<void> {
  const state = await core.invoke<OtterAccountState>("otter:deleteAccount");
  await forgetMailboxes();
  take(state);
}

/** In or out of the demo: core starts again on the other mailbox (a JS reload, Release builds too). */
export function setDemo(on: boolean): void {
  const host = createWorkerHost();
  if (on) host.writeFile(DEMO_FILE, new TextEncoder().encode("1").buffer as ArrayBuffer);
  else host.removeFile(DEMO_FILE);
  DevSettings.reload(on ? "Trying the demo mailbox" : "Leaving the demo mailbox");
}
