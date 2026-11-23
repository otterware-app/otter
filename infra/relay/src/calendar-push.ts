import { base64url } from "jose";

import { derivedKey } from "./keys.ts";
import type { Env } from "./worker.ts";

export const notificationUrl = (env: Env, email: string) =>
  `${env.BETTER_AUTH_URL}/push/calendar/${encodeURIComponent(email)}`;

const pushKey = async (env: Env) =>
  crypto.subtle.importKey(
    "raw",
    await derivedKey(env.BETTER_AUTH_SECRET, "otter calendar push"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

/**
 * The secret a mailbox's calendar watches hand Google (a channel's token) or Graph (a
 * subscription's clientState), which they send back with each notification: an HMAC of the
 * address (43 characters; Google allows 256, Graph 128).
 */
export async function calendarToken(env: Env, email: string): Promise<string> {
  const data = new TextEncoder().encode(email.toLowerCase());
  return base64url.encode(
    new Uint8Array(await crypto.subtle.sign("HMAC", await pushKey(env), data)),
  );
}

export async function checkCalendarToken(env: Env, email: string, token: string) {
  let signature: Uint8Array;
  try {
    signature = base64url.decode(token);
  } catch {
    return false;
  }
  const data = new TextEncoder().encode(email.toLowerCase());
  return crypto.subtle.verify("HMAC", await pushKey(env), signature, data);
}
