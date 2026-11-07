const DONE_KEY = "otter:swift-notifications-mode-imported";
const MODES = new Set(["off", "inbox", "all"]);

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

function swiftUserId(raw: string | undefined, email: string): string | null {
  try {
    const user = JSON.parse(raw ?? "null") as { id?: unknown; email?: unknown } | null;
    return typeof user?.id === "string" &&
      typeof user.email === "string" &&
      user.email.toLowerCase() === email.toLowerCase()
      ? user.id
      : null;
  } catch {
    return null;
  }
}

/**
 * The Swift app took the account's preferences over its own, except a
 * notifications mode it hadn't managed to send (`push:pending-mode:<user>`).
 * On the Expo app's first launch signed in as the same account, that mode is
 * kept, then never again.
 */
export async function importSwiftNotificationsMode({
  storage,
  email,
  read,
  invoke,
}: {
  storage: Storage;
  /** The Otter account signed in now. */
  email: string;
  read: (keys: string[]) => Record<string, string>;
  invoke: (channel: string, params: unknown) => Promise<unknown>;
}): Promise<void> {
  if (storage.getItem(DONE_KEY)) return;
  const userId = swiftUserId(read(["otter:user"])["otter:user"], email);
  const key = `push:pending-mode:${userId}`;
  const mode = userId ? read([key])[key] : undefined;
  if (mode && MODES.has(mode)) await invoke("preferences:keepNotificationsMode", { mode });
  storage.setItem(DONE_KEY, "1");
}
