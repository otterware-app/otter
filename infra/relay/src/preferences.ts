/** The account's preferences (contracts' `Preferences`): sections of JSON each device replaces whole, merged here. */

import type { Preferences, PreferencesResponse } from "@otter/contracts/relay";
import { jwtDecrypt } from "jose";

import { derivedKey } from "./keys.ts";
import * as store from "./store.ts";

/** Hermes's API keys, as they were kept here before agents had their own store (agent-sync.ts): read once, into it. */
export async function openOldAgentKeys(
  secret: string,
  userId: string,
  sealed: string,
): Promise<Record<string, string>> {
  try {
    const { payload } = await jwtDecrypt<{ agentKeys: Record<string, string> }>(
      sealed,
      await derivedKey(secret, "otter-mail preferences seal"),
      { subject: userId },
    );
    return payload.agentKeys;
  } catch {
    return {};
  }
}

export async function read(db: store.Db, userId: string): Promise<PreferencesResponse> {
  return { preferences: (await store.getPreferences(db, userId)).data };
}

const MAX_BYTES = 256 * 1024;

export async function write(
  db: store.Db,
  userId: string,
  change: { preferences?: Preferences },
): Promise<boolean> {
  return store.putPreferences(db, userId, change.preferences ?? {}, MAX_BYTES);
}
