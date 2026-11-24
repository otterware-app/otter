import { agentApi } from "@otter/client/agents/api";

const WINDOW_ID = crypto.randomUUID();
let toldWebActive = false;
let webIdleTimer: ReturnType<typeof setTimeout> | null = null;
let webRefreshTimer: ReturnType<typeof setInterval> | null = null;
const WEB_IDLE_MS = 120_000;
const WEB_PRESENCE_REFRESH_MS = 30_000;

function setWebPresence(active: boolean): void {
  if (active === toldWebActive) return;
  toldWebActive = active;
  if (active && !webRefreshTimer) {
    // Re-report while active so a replacement worker tab restores presence after failover.
    webRefreshTimer = setInterval(() => {
      if (toldWebActive && !document.hidden)
        void agentApi.presence({ window: WINDOW_ID, active: true }).catch(() => {});
    }, WEB_PRESENCE_REFRESH_MS);
  } else if (!active && webRefreshTimer) {
    clearInterval(webRefreshTimer);
    webRefreshTimer = null;
  }
  void agentApi.presence({ window: WINDOW_ID, active }).catch(() => {});
}

function bumpWebPresence(): void {
  if (document.hidden) {
    if (webIdleTimer) clearTimeout(webIdleTimer);
    webIdleTimer = null;
    setWebPresence(false);
    return;
  }
  setWebPresence(true);
  if (webIdleTimer) clearTimeout(webIdleTimer);
  webIdleTimer = setTimeout(() => {
    webIdleTimer = null;
    setWebPresence(false);
  }, WEB_IDLE_MS);
}

/** Tells core whether you're active in this tab, so the account's iPhones stay quiet meanwhile. */
export function startWebPresence(): void {
  window.addEventListener("pagehide", () => {
    if (!toldWebActive) return;
    if (webIdleTimer) clearTimeout(webIdleTimer);
    webIdleTimer = null;
    setWebPresence(false);
  });
  bumpWebPresence();
  document.addEventListener("visibilitychange", bumpWebPresence);
  window.addEventListener("focus", bumpWebPresence);
  window.addEventListener("pointerdown", bumpWebPresence, { passive: true });
  window.addEventListener("keydown", bumpWebPresence, { passive: true });
}
