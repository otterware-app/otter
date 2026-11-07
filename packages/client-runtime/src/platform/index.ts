import * as Context from "effect/Context";

/**
 * What a client app gives the runtime: a window's localStorage and focus, or
 * the phone's MMKV and AppState. The runtime never reaches for `window`.
 */

/** Small, synchronous, per-device storage. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Whether the app is in front, and word when it comes back. */
export interface AppFocus {
  isFocused(): boolean;
  onFocus(listener: () => void): () => void;
}

export interface ClientPlatform {
  storage: KeyValueStorage;
  focus: AppFocus;
  newId(): string;
}

export class ClientStorage extends Context.Service<ClientStorage, KeyValueStorage>()(
  "@otter-mail/client-runtime/platform/ClientStorage",
) {}

export class ClientFocus extends Context.Service<ClientFocus, AppFocus>()(
  "@otter-mail/client-runtime/platform/ClientFocus",
) {}

export function readJson<T>(storage: KeyValueStorage, key: string, fallback: T): T {
  try {
    return (JSON.parse(storage.getItem(key) ?? "") as T) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Storage that forgets: for tests, and a host without any. */
export function memoryStorage(): KeyValueStorage {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
}
