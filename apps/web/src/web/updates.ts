import type { DesktopBridge, UpdateChannel, UpdateState } from "@otter-mail/contracts";
import { releaseChannel } from "@otter-mail/shared/release-channel";

const CHECK_EVERY_MS = 30 * 60_000;

const live = !import.meta.env.DEV && !__DEMO__;

let state: UpdateState = {
  status: live ? "idle" : "disabled",
  channel: releaseChannel(__APP_VERSION__),
  currentVersion: __APP_VERSION__,
  availableVersion: null,
  downloadPercent: null,
  checkedAt: null,
  message: live ? null : "The web app is always up to date.",
  manualDownloadUrl: null,
};
const listeners = new Set<(state: UpdateState) => void>();

function set(next: Partial<UpdateState>): UpdateState {
  state = { ...state, ...next };
  for (const listener of listeners) listener(state);
  return state;
}

async function check(): Promise<UpdateState> {
  if (!live || state.status === "checking") return state;
  set({ status: "checking" });
  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    const { version } = (await response.json()) as { version: string };
    return version === __APP_VERSION__
      ? set({ status: "up-to-date", availableVersion: null, checkedAt: Date.now(), message: null })
      : set({
          status: "downloaded",
          availableVersion: version,
          checkedAt: Date.now(),
          message: null,
        });
  } catch {
    return set({ status: "error", message: "Couldn't reach mail.otterware.app." });
  }
}

async function setChannel(channel: UpdateChannel): Promise<UpdateState> {
  if (live && channel !== state.channel) {
    window.location.assign(`/__otter-mail/channel?channel=${channel}`);
  }
  return state;
}

if (live) {
  setTimeout(() => void check(), 10_000);
  setInterval(() => void check(), CHECK_EVERY_MS);
}

export const webUpdates: DesktopBridge["updates"] = {
  getState: async () => state,
  check,
  setChannel,
  download: check,
  install: async () => window.location.reload(),
  onState(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
