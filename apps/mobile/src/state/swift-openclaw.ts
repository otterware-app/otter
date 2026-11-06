/** The Swift app's UserDefaults keys for OpenClaw: its settings, and the run it left open. */
export const SWIFT_OPENCLAW_KEYS = ["openclaw", "openclaw-run"];

const DONE_KEY = "otter:swift-openclaw-imported";

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

/** What core's `agent:importOpenClaw` takes, from the Swift app's JSON (absent or broken: nothing). */
export function swiftOpenClaw(raw: Record<string, string>): {
  url: string;
  model: string;
  enabled: boolean;
  run?: { session: string; run: string };
} | null {
  const parse = (key: string) => {
    try {
      return JSON.parse(raw[key] ?? "null") as Record<string, unknown> | null;
    } catch {
      return null;
    }
  };
  const settings = parse("openclaw");
  const url = typeof settings?.url === "string" ? settings.url.trim() : "";
  if (!url) return null;
  const open = parse("openclaw-run");
  return {
    url,
    model: typeof settings?.model === "string" ? settings.model : "",
    enabled: settings?.enabled !== false,
    ...(typeof open?.session === "string" && typeof open.run === "string"
      ? { run: { session: open.session, run: open.run } }
      : {}),
  };
}

/**
 * On the Expo app's first launch over the Swift app: its OpenClaw gateway, model
 * and switch go to core (which keeps its own if it has one), then never again.
 */
export async function importSwiftOpenClaw({
  storage,
  read,
  invoke,
}: {
  storage: Storage;
  read: (keys: string[]) => Record<string, string>;
  invoke: (channel: string, params: unknown) => Promise<unknown>;
}): Promise<void> {
  if (storage.getItem(DONE_KEY)) return;
  const found = swiftOpenClaw(read(SWIFT_OPENCLAW_KEYS));
  if (found) await invoke("agent:importOpenClaw", found);
  storage.setItem(DONE_KEY, "1");
}
