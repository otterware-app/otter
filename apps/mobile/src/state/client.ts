import type { ClientPlatform, KeyValueStorage } from "@otter-mail/client-runtime/platform";
import { makeMailboxes } from "@otter-mail/client-runtime/state/mailboxes";
import { makeThreadLists } from "@otter-mail/client-runtime/state/messages";
import { makeMailOperations } from "@otter-mail/client-runtime/operations";
import type { MailboxInfo } from "@otter-mail/client-runtime/mail";
import { AtomRegistry } from "effect/reactivity";
import { AppState } from "react-native";

import { createWorkerHost } from "@otter-mail/mobile-worker";

import { core } from "./core";

/** The app's atoms (client-runtime's state), read with @effect/atom-react. */
export const appAtomRegistry = AtomRegistry.make();

const STORAGE_FILE = "client-storage.json";

/** Small synchronous storage: one JSON file in Application Support, written through. */
function fileStorage(): KeyValueStorage {
  const host = createWorkerHost();
  let items: Record<string, string> = {};
  try {
    const bytes = host.readFile(STORAGE_FILE);
    if (bytes) items = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, string>;
  } catch {
    items = {};
  }
  const save = () =>
    host.writeFile(
      STORAGE_FILE,
      new TextEncoder().encode(JSON.stringify(items)).buffer as ArrayBuffer,
    );
  return {
    getItem: (key) => items[key] ?? null,
    setItem(key, value) {
      items[key] = value;
      save();
    },
    removeItem(key) {
      delete items[key];
      save();
    },
  };
}

export const clientPlatform: ClientPlatform = {
  storage: fileStorage(),
  focus: {
    isFocused: () => AppState.currentState === "active",
    onFocus(listener) {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") listener();
      });
      return () => subscription.remove();
    },
  },
  newId: () => crypto.randomUUID(),
};

export type Mailbox = MailboxInfo & {
  name?: string;
  displayName?: string;
  picture?: string;
  customPicture?: string;
  color?: string;
  signedOut?: boolean;
};

export const mailboxes = makeMailboxes<Mailbox>(appAtomRegistry, core);

export const threadLists = makeThreadLists(appAtomRegistry, {
  core,
  focus: clientPlatform.focus,
  pageSize: 50,
});

export const operations = makeMailOperations({
  core,
  threadLists,
  archiveFolder: (accountId) => {
    const provider = appAtomRegistry
      .get(mailboxes.accountsAtom)
      .value.find((m) => m.id === accountId)?.provider;
    return provider === "imap" || provider === "outlook";
  },
  onError: (error) => console.log("[mail] write failed", String(error)),
});

let started = false;

/** Loads the mailboxes and follows core's changes, once. */
export function startClientState(): void {
  if (started) return;
  started = true;
  mailboxes.start();
  threadLists.start();
}
