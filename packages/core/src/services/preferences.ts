// Preference sections are replaced whole: preserve fields owned by other devices when updating them.

import type { PreferencesResponse } from "@otter/contracts/relay";

import { broadcast } from "../ipc.js";
import { readJson, writeJson } from "../json-file.js";
import { logger } from "../logger.js";
import { platform } from "../platform.js";
import {
  applySyncedAgentKeys,
  applySyncedProviderSettings,
  forgetAgentKeys,
  syncedAgentKeys,
  syncedProviderSettings,
  type SyncedProviderSettings,
} from "./agent/service.js";
import { readKeybindings, writeKeybindings } from "./keybindings-store.js";
import { configureAutoSync, followMailboxArrangement } from "./mail-sync.js";
import { getOtterUser, relayRequest } from "./otter-account.js";
import {
  keepsSendAsOnDevice,
  keepsSignatureOnDevice,
  listAccounts,
  updateAccount,
} from "./account-store.js";
import { followAliasMailApart, parseAliasMailboxes } from "./alias-mailboxes.js";
import { getSettings, updateSettings, type AppSettings } from "./settings-store.js";
import { listViews, writeViews } from "./views-store.js";
import type { AliasMailbox } from "@otter/contracts";
import type { MailView } from "../types.js";

const UI_FILE = "ui-preferences.json";
export type UiPreferences = Record<string, string>;

export async function getUiPreferences(initialize = false): Promise<UiPreferences> {
  const cached = (await readJson<UiPreferences>(UI_FILE)) ?? {};
  // A new browser has no palette yet. Fetch it before its first render instead
  // of waiting for the event stream; returning browsers keep the local fast path.
  if (
    initialize &&
    platform().relaySession === "cookie" &&
    getOtterUser() &&
    Object.keys(cached).length === 0
  ) {
    await pullPreferences().catch((err: unknown) =>
      logger.failure("preferences", "Couldn't load initial appearance", err),
    );
    return (await readJson<UiPreferences>(UI_FILE)) ?? cached;
  }
  return cached;
}

async function writeUiPreferences(ui: UiPreferences): Promise<void> {
  await writeJson(UI_FILE, ui);
  followMailboxArrangement(ui["mail:mailboxes"]);
  followAliasMailApart(ui["mail:alias-mail-apart"]);
  broadcast("preferences:uiChanged", ui);
}

let uiWrites: Promise<void> = Promise.resolve();

/** One at a time, so two choices made together don't lose one another. */
export function setUiPreference(key: string, value: string): Promise<void> {
  const write = uiWrites.then(async () => {
    const ui = await getUiPreferences();
    if (ui[key] === value) return;
    await writeUiPreferences({ ...ui, [key]: value });
    preferenceChanged("ui");
  });
  uiWrites = write.catch(() => {});
  return write;
}

const SYNCED_SETTINGS = [
  "syncIntervalSeconds",
  "notificationsMode",
  "readLanguages",
  "autoTranslate",
] as const satisfies readonly (keyof AppSettings)[];

type Section = {
  read(): Promise<unknown>;
  apply(value: unknown): Promise<void>;
};

const SECTIONS = {
  settings: {
    async read() {
      const settings = await getSettings();
      return Object.fromEntries(SYNCED_SETTINGS.map((key) => [key, settings[key]]));
    },
    async apply(value) {
      const patch = Object.fromEntries(
        Object.entries(value as Partial<AppSettings>).filter(([key]) =>
          (SYNCED_SETTINGS as readonly string[]).includes(key),
        ),
      );
      const settings = await updateSettings(patch);
      configureAutoSync(settings.syncIntervalSeconds);
      broadcast("translation:settingsChanged");
    },
  },
  views: {
    read: () => listViews(),
    async apply(value) {
      if (!Array.isArray(value)) return;
      await writeViews(value as MailView[]);
      broadcast("gmail:views-changed");
    },
  },
  keybindings: {
    read: async () => (await readKeybindings()).rules ?? undefined,
    async apply(value) {
      await writeKeybindings(value);
      broadcast("keybindings:updated");
    },
  },
  assistant: {
    read: () => syncedProviderSettings(),
    async apply(value) {
      await applySyncedProviderSettings(value as Partial<SyncedProviderSettings>);
      // What this device has that the account hasn't (an agent added before it synced) goes to it.
      if (JSON.stringify(await syncedProviderSettings()) !== JSON.stringify(value))
        preferenceChanged("assistant");
    },
  },
  ui: {
    read: () => getUiPreferences(),
    async apply(value) {
      if (value && typeof value === "object") await writeUiPreferences(value as UiPreferences);
    },
  },
  // By address, lower-cased. Keeps the mailboxes this device doesn't have, so
  // it never drops another device's.
  signatures: {
    async read() {
      const signatures = syncedSignatures();
      for (const account of await listAccounts()) {
        if (!keepsSignatureOnDevice(account)) continue;
        signatures[account.email.toLowerCase()] = account.signature ?? "";
      }
      return signatures;
    },
    async apply(value) {
      if (!value || typeof value !== "object") return;
      const signatures = value as Record<string, string>;
      let changed = false;
      for (const account of await listAccounts()) {
        const signature = signatures[account.email.toLowerCase()];
        if (!keepsSignatureOnDevice(account) || signature === undefined) continue;
        if ((account.signature ?? "") === signature) continue;
        await updateAccount(account.id, { signature });
        changed = true;
      }
      if (changed) broadcast("gmail:accounts-changed");
    },
  },
  sendAs: {
    async read() {
      const sendAs = syncedSendAsAll();
      for (const account of await listAccounts()) {
        if (!keepsSendAsOnDevice(account)) continue;
        sendAs[account.email.toLowerCase()] = account.sendAs ?? [];
      }
      return sendAs;
    },
    async apply(value) {
      if (!value || typeof value !== "object") return;
      const sendAs = value as Record<string, string[]>;
      let changed = false;
      for (const account of await listAccounts()) {
        const addresses = sendAs[account.email.toLowerCase()];
        if (!keepsSendAsOnDevice(account) || !Array.isArray(addresses)) continue;
        if ((account.sendAs ?? []).join() === addresses.join()) continue;
        await updateAccount(account.id, { sendAs: addresses });
        changed = true;
      }
      if (changed) broadcast("gmail:accounts-changed");
    },
  },
  aliasMailboxes: {
    async read() {
      const all = syncedAliasMailboxesAll();
      for (const account of await listAccounts()) {
        if (!keepsSendAsOnDevice(account)) continue;
        all[account.email.toLowerCase()] = account.aliasMailboxes ?? [];
      }
      return all;
    },
    async apply(value) {
      if (!value || typeof value !== "object") return;
      const all = value as Record<string, unknown>;
      let changed = false;
      for (const account of await listAccounts()) {
        const key = account.email.toLowerCase();
        if (!keepsSendAsOnDevice(account) || !(key in all)) continue;
        const aliasMailboxes = parseAliasMailboxes(all[key]);
        if (JSON.stringify(account.aliasMailboxes ?? []) === JSON.stringify(aliasMailboxes)) {
          continue;
        }
        await updateAccount(account.id, { aliasMailboxes });
        changed = true;
      }
      if (changed) broadcast("gmail:accounts-changed");
    },
  },
} satisfies Record<string, Section>;

export type SectionName = keyof typeof SECTIONS;
const SECTION_NAMES = Object.keys(SECTIONS) as SectionName[];

const synced = new Map<SectionName | "agentKeys", string>();

function syncedSignatures(): Record<string, string> {
  try {
    return JSON.parse(synced.get("signatures") ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function syncedSignature(email: string): string | undefined {
  return syncedSignatures()[email.toLowerCase()] || undefined;
}

function syncedSendAsAll(): Record<string, string[]> {
  try {
    return JSON.parse(synced.get("sendAs") ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function syncedSendAs(email: string): string[] | undefined {
  const addresses = syncedSendAsAll()[email.toLowerCase()];
  return Array.isArray(addresses) && addresses.length > 0 ? addresses : undefined;
}

function syncedAliasMailboxesAll(): Record<string, unknown> {
  try {
    return JSON.parse(synced.get("aliasMailboxes") ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function syncedAliasMailboxes(email: string): AliasMailbox[] | undefined {
  const aliases = parseAliasMailboxes(syncedAliasMailboxesAll()[email.toLowerCase()]);
  return aliases.length > 0 ? aliases : undefined;
}

// An agent's key (Hermes's) is full control of it, and a device can be shared: this remembers
// which Otter account the keys synced with, so they never reach another account, and they leave
// the device with its account. Keys set while signed out have no owner until an account adopts them.
const AGENT_KEYS_OWNER = "agent-keys-owner";
const agentKeysOwner = () =>
  platform()
    .secrets.get(AGENT_KEYS_OWNER)
    .catch(() => null);
const setAgentKeysOwner = (userId: string) => platform().secrets.set(AGENT_KEYS_OWNER, userId);

export async function pullPreferences(): Promise<void> {
  if (!getOtterUser()) return;
  const remote = await relayRequest<PreferencesResponse>("GET", "/v1/preferences");
  for (const name of SECTION_NAMES) {
    const value = remote.preferences[name];
    if (value === undefined) {
      preferenceChanged(name);
      continue;
    }
    const json = JSON.stringify(value);
    synced.set(name, json);
    if (JSON.stringify(await SECTIONS[name].read()) === json) continue;
    try {
      await SECTIONS[name].apply(value);
    } catch (err) {
      logger.failure("preferences", `Couldn't apply ${name}`, err);
    }
  }
  const userId = getOtterUser()?.id;
  if (!userId) return;
  if (remote.agentKeys && Object.keys(remote.agentKeys).length) {
    synced.set("agentKeys", JSON.stringify(remote.agentKeys));
    await applySyncedAgentKeys(remote.agentKeys);
    await setAgentKeysOwner(userId);
  }
  if (((await agentKeysOwner()) ?? userId) === userId) preferenceChanged("agentKeys");
}

const pending = new Set<SectionName | "agentKeys">();
let pushTimer: ReturnType<typeof setTimeout> | null = null;

export function preferenceChanged(name: SectionName | "agentKeys"): void {
  if (!getOtterUser()) return;
  pending.add(name);
  pushTimer ??= setTimeout(() => void push(), 500);
}

const RETRY_MS = 30_000;

async function push(): Promise<void> {
  pushTimer = null;
  const userId = getOtterUser()?.id;
  if (!userId) return;
  const names = [...pending];
  pending.clear();
  const sending = new Map<SectionName | "agentKeys", string>();
  const preferences: Record<string, unknown> = {};
  let agentKeys: Record<string, string> | undefined;
  for (const name of names) {
    const value = name === "agentKeys" ? await syncedAgentKeys() : await SECTIONS[name].read();
    if (value === undefined) continue;
    const json = JSON.stringify(value);
    if (synced.get(name) === json) continue;
    sending.set(name, json);
    if (name === "agentKeys") agentKeys = value as Record<string, string>;
    else preferences[name] = value;
  }
  if (sending.size === 0) return;
  try {
    await relayRequest("PUT", "/v1/preferences", { preferences, agentKeys });
    for (const [name, json] of sending) synced.set(name, json);
    if (agentKeys !== undefined) await setAgentKeysOwner(userId);
  } catch (err) {
    logger.failure("preferences", "Couldn't save preferences, retrying", err);
    for (const name of sending.keys()) pending.add(name);
    pushTimer ??= setTimeout(() => void push(), RETRY_MS);
  }
}

export async function forgetSyncedPreferences(): Promise<void> {
  synced.clear();
  pending.clear();
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  if (await agentKeysOwner()) {
    await forgetAgentKeys();
    await platform().secrets.delete(AGENT_KEYS_OWNER);
  }
}
