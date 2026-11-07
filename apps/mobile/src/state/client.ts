import type { ClientPlatform, KeyValueStorage } from "@otter-mail/client-runtime/platform";
import { makeMailboxes } from "@otter-mail/client-runtime/state/mailboxes";
import { makeThreadLists } from "@otter-mail/client-runtime/state/messages";
import { makeMailOperations, summarizeLabelChange } from "@otter-mail/client-runtime/operations";
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

/** A v4 UUID from the OS's randomness: the UI runtime has no `crypto` (only core's worker is given one). */
function randomUUID(): string {
  const b = new Uint8Array(createWorkerHost().randomBytes(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  newId: randomUUID,
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

const archiveFolder = (accountId: string) => {
  const provider = appAtomRegistry
    .get(mailboxes.accountsAtom)
    .value.find((m) => m.id === accountId)?.provider;
  return provider === "imap" || provider === "outlook";
};

export const operations = makeMailOperations({
  core,
  threadLists,
  archiveFolder,
  summarize: ({ accountId, addLabelIds = [], removeLabelIds = [] }, noun) => {
    const labels = appAtomRegistry.get(mailboxes.labelsAtom(accountId)).value;
    const nameOf = (id: string) => labels.find((l) => l.id === id && l.type === "user")?.name;
    return summarizeLabelChange(
      addLabelIds,
      removeLabelIds,
      noun,
      nameOf,
      archiveFolder(accountId),
    );
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
