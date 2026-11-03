/**
 * The account's preferences (contracts' `Preferences`): sections of JSON
 * each device replaces whole, merged here, and the Hermes API key, which is
 * full control of the user's agent: sealed with a key only the relay holds,
 * so the database alone can't reveal it.
 */

import type { Preferences, PreferencesResponse } from "@otter-mail/contracts/relay";
import { EncryptJWT, jwtDecrypt } from "jose";

import { derivedKey } from "./keys.ts";
import * as store from "./store.ts";

const sealKey = (secret: string) => derivedKey(secret, "otter-mail preferences seal");

async function seal(secret: string, userId: string, hermesKey: string): Promise<string> {
  return new EncryptJWT({ hermesKey })
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setSubject(userId)
    .encrypt(await sealKey(secret));
}

async function open(secret: string, userId: string, sealed: string): Promise<string> {
  const { payload } = await jwtDecrypt<{ hermesKey: string }>(sealed, await sealKey(secret), {
    subject: userId,
  });
  return payload.hermesKey;
}

export async function read(
  db: store.Db,
  secret: string,
  userId: string,
): Promise<PreferencesResponse> {
  const { data, hermesKey } = await store.getPreferences(db, userId);
  return {
    preferences: data,
    hermesKey: hermesKey ? await open(secret, userId, hermesKey) : null,
  };
}

const MAX_BYTES = 256 * 1024;

export async function write(
  db: store.Db,
  secret: string,
  userId: string,
  change: { preferences?: Preferences; hermesKey?: string | null },
): Promise<boolean> {
  return store.putPreferences(
    db,
    userId,
    {
      sections: change.preferences ?? {},
      hermesKey:
        change.hermesKey === undefined
          ? undefined
          : change.hermesKey && (await seal(secret, userId, change.hermesKey)),
    },
    MAX_BYTES,
  );
}
