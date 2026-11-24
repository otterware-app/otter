/** Core's Platform on the iPhone, in the app's JavaScript runtime. */
import type { AsyncContext, GoogleAuth, Platform } from "@otter/core";
import Constants from "expo-constants";
import { AppState } from "react-native";

import { emit } from "./bridge.ts";
import { openDatabase } from "./database.ts";
import { appFiles } from "./files.ts";
import { localNotifications } from "./notifications.ts";
import { keychainSecrets } from "./secrets.ts";
import { userFiles } from "./user-files.ts";

const RELAY_URL = "https://relay.otterware.app";

const SIGN_IN_MISSING = "Sign-in isn't here yet.";
const notYet = () => Promise.reject(new Error(SIGN_IN_MISSING));

/** Otter's sign-in with Google's ID token comes next (GoogleSignIn.swift's PKCE); mailboxes later. */
const google: GoogleAuth = {
  load: async () => {},
  addAccount: notYet,
  cancelSignIn: () => {},
  isSignedIn: () => false,
  getAccessToken: notYet,
  getIdToken: notYet,
  signInForIdToken: notYet,
  removeTokens: async () => {},
};

const noContext = <T>(): AsyncContext<T> => ({ run: (_value, fn) => fn(), get: () => undefined });

/** The user is here while the app is active, in front. */
function onPresence(listener: (active: boolean) => void): () => void {
  listener(AppState.currentState === "active");
  const subscription = AppState.addEventListener("change", (state) => listener(state === "active"));
  return () => subscription.remove();
}

function onResume(listener: () => void): () => void {
  let last = AppState.currentState;
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active" && last !== "active") listener();
    last = state;
  });
  return () => subscription.remove();
}

/**
 * `home`: where its files and database are, apart from another home's (the fake's).
 * `secretsService`: the Keychain service its secrets are kept under.
 */
export function phonePlatform(options: {
  home: string;
  secretsService: string;
  relayUrl?: string;
}): Platform {
  let database: ReturnType<Platform["database"]> | null = null;
  return {
    kind: "mobile",
    appVersion: Constants.expoConfig?.version ?? "0.0.0",
    log: (level, scope, message, data) =>
      console[level === "debug" ? "log" : level](`[${scope}] ${message}`, data ?? ""),

    database: () => (database ??= openDatabase(`${options.home}.db`)),
    files: appFiles(options.home),
    secrets: keychainSecrets(options.secretsService),
    userFiles,

    google,
    connect: () => Promise.reject(new Error("Mail servers can't be reached from the phone yet.")),
    relayUrl: options.relayUrl || RELAY_URL,
    relaySession: "bearer",
    deviceName: Constants.deviceName ?? "iPhone",

    broadcast: emit,
    ...localNotifications(),
    onResume,
    onPresence,
    asyncContext: noContext,
    offlineDownloads: false,
  };
}
