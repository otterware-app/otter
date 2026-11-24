import type { Platform } from "@otter/core";

import { native } from "./native.ts";

/** Core's secrets as the app's Keychain items: generic passwords under `service`, named as core names them. */
export function keychainSecrets(service: string): Platform["secrets"] {
  return {
    get: (name) => native.keychainGet(service, name),
    set: (name, value) => native.keychainSet(service, name, value),
    delete: (name) => native.keychainDelete(service, name),
  };
}
