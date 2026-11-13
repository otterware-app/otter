/**
 * The account's preferences (contracts' `Preferences`): sections of JSON
 * each device replaces whole, merged here, and the agents' keys (each Hermes
 * server's API key), which are full control of the user's agents: sealed with
 * a key only the relay holds, so the database alone can't reveal them.
 */

import type { AgentKeys, Preferences, PreferencesResponse } from "@otter/contracts/relay";
import { EncryptJWT, jwtDecrypt } from "jose";

import { derivedKey } from "./keys.ts";
import * as store from "./store.ts";

const sealKey = (secret: string) => derivedKey(secret, "otter-mail preferences seal");

async function seal(secret: string, userId: string, agentKeys: AgentKeys): Promise<string> {
  return new EncryptJWT({ agentKeys })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(userId)
    .encrypt(await sealKey(secret));
}

async function open(secret: string, userId: string, sealed: string): Promise<AgentKeys> {
  const { payload } = await jwtDecrypt<{ agentKeys: AgentKeys }>(sealed, await sealKey(secret), {
    subject: userId,
  });
  return payload.agentKeys;
}

export async function read(
  db: store.Db,
  secret: string,
  userId: string,
): Promise<PreferencesResponse> {
  const { data, agentKeys } = await store.getPreferences(db, userId);
  return {
    preferences: data,
    agentKeys: agentKeys ? await open(secret, userId, agentKeys) : null,
  };
}

const MAX_BYTES = 256 * 1024;

export async function write(
  db: store.Db,
  secret: string,
  userId: string,
  change: { preferences?: Preferences; agentKeys?: AgentKeys | null },
): Promise<boolean> {
  return store.putPreferences(
    db,
    userId,
    {
      sections: change.preferences ?? {},
      agentKeys:
        change.agentKeys === undefined
          ? undefined
          : change.agentKeys && Object.keys(change.agentKeys).length
            ? await seal(secret, userId, change.agentKeys)
            : null,
    },
    MAX_BYTES,
  );
}
