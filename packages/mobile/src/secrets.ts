import type { Platform } from "@otter/core";

import { native } from "./native.ts";

const base64url = (base64: string) =>
  base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Core's secrets as the app's Keychain items: generic passwords under `service`, named as core names them. */
export function keychainSecrets(service: string): Platform["secrets"] {
  return {
    async get(name) {
      const value = await native.keychainGet(service, name);
      if (service !== "dev.otterware.agents" || !value || value.startsWith("{")) return value;

      if (name === "otter-session") {
        const savedUser = native.existingAgentSettings().user;
        if (savedUser) {
          try {
            const user = JSON.parse(savedUser) as { id?: unknown; email?: unknown };
            if (typeof user.id === "string" && typeof user.email === "string") {
              const session = JSON.stringify({ token: value, user });
              await native.keychainSet(service, name, session);
              return session;
            }
          } catch {
            // Core can recover the user from the relay using the original token.
          }
        }
        return value;
      }

      // Read the Swift install's OpenClaw pairing in the format the shared client uses.
      const match = /^(agent:.+):device-(key|token)$/.exec(name);
      if (!match) return value;
      if (match[2] === "key") {
        const publicKey = native.ed25519PublicKey(value);
        return publicKey
          ? JSON.stringify({
              kty: "OKP",
              crv: "Ed25519",
              x: base64url(publicKey),
              d: base64url(value),
            })
          : null;
      }
      const scopes = await native.keychainGet(service, `${match[1]}:device-scopes`);
      return JSON.stringify({ token: value, scopes: scopes?.split(",").filter(Boolean) ?? [] });
    },
    set: (name, value) => native.keychainSet(service, name, value),
    delete: (name) => native.keychainDelete(service, name),
  };
}
