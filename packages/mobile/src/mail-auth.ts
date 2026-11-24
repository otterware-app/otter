import {
  accountStore,
  broadcast,
  OUTLOOK_SIGNED_OUT_MESSAGE,
  SIGNED_OUT_MESSAGE,
  SignInCancelledError,
  type GoogleAuth,
  type MailAccount,
  type MicrosoftAuth,
} from "@otter/core";

import { native, type MailOAuthProvider } from "./native.ts";

function mailboxAuth(provider: MailOAuthProvider, signedOutMessage: string) {
  const signIns = new Map<string, symbol>();
  const forcedRefreshes = new Map<symbol, Promise<string | null>>();

  function refreshAccessToken(key: string, signIn: symbol) {
    const pending = forcedRefreshes.get(signIn);
    if (pending) return pending;
    const refresh = native.mailToken(provider, key, false, true).finally(() => {
      forcedRefreshes.delete(signIn);
    });
    forcedRefreshes.set(signIn, refresh);
    return refresh;
  }

  async function token(accountId: string, id: boolean, force = false): Promise<string> {
    const key = accountId.toLowerCase();
    const signIn = signIns.get(key);
    if (!signIn) throw new Error(signedOutMessage);
    const value = await (force
      ? refreshAccessToken(key, signIn)
      : native.mailToken(provider, key, id, false));
    if (signIns.get(key) !== signIn) throw new Error(signedOutMessage);
    if (value) return value;
    signIns.delete(key);
    broadcast("gmail:accounts-changed");
    throw new Error(signedOutMessage);
  }

  return {
    async load() {
      signIns.clear();
      for (const email of await native.mailSignedInAddresses(provider)) {
        signIns.set(email, Symbol());
      }
    },
    async addAccount(loginHint?: string) {
      const profile = await native.mailSignIn(provider, loginHint?.trim() || null);
      if (!profile) throw new SignInCancelledError();
      signIns.set(profile.email, Symbol());
      return profile;
    },
    cancelSignIn: () => void native.cancelGoogleSignIn(),
    isSignedIn: (accountId: string) => signIns.has(accountId.toLowerCase()),
    getAccessToken: (accountId: string, options?: { forceRefresh?: boolean }) =>
      token(accountId, false, options?.forceRefresh),
    getIdToken: (accountId: string) => token(accountId, true),
    async removeTokens(accountId: string) {
      const key = accountId.toLowerCase();
      const previous = signIns.get(key);
      await native.mailForget(provider, key);
      if (signIns.get(key) === previous) signIns.delete(key);
    },
  };
}

export function mailGoogleAuth(): GoogleAuth {
  const auth = mailboxAuth("gmail", SIGNED_OUT_MESSAGE);
  return {
    ...auth,
    async signInForIdToken() {
      const token = await native.googleIdToken();
      if (!token) throw new SignInCancelledError();
      return token;
    },
    async addAccount(loginHint) {
      const { email, name, picture } = await auth.addAccount(loginHint);
      const existing = await accountStore.getAccount(email);
      if (existing?.provider && existing.provider !== "gmail") {
        await auth.removeTokens(email);
        throw new Error(`${email} is already added.`);
      }
      const account: MailAccount = { ...existing, id: email, email, name, picture };
      await accountStore.addAccount(account);
      return account;
    },
  };
}

export function mailMicrosoftAuth(): MicrosoftAuth {
  return {
    ...mailboxAuth("outlook", OUTLOOK_SIGNED_OUT_MESSAGE),
    available: async () => true,
  };
}
