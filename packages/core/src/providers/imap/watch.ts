// Renew IDLE before the server's 30-minute cutoff; stop on refused credentials to avoid repeated failed logins.

import { logger } from "../../logger.js";
import { platform } from "../../platform.js";
import type { IdleSession, ImapClient } from "../../protocols/index.js";
import { openImap } from "./connection.js";
import { isSignInFailure } from "./sign-in-failure.js";

const RENEW_MS = 25 * 60_000;
const DEBOUNCE_MS = 1_000;
const RETRY_MIN_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;
const IDLE_GAP_MS = 30_000;
const HEALTHY_MS = 60_000;

export function watchInbox(accountId: string, onChange: () => void): () => void {
  const stopped = new AbortController();
  let client: ImapClient | null = null;
  let session: IdleSession | null = null;
  let wake: (() => void) | null = null;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  /** Resumed: IDLE again (or reconnect) without waiting, and catch up. */
  let resumed = false;

  const changed = () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      if (!stopped.signal.aborted) onChange();
    }, DEBOUNCE_MS);
  };

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  const run = async () => {
    for (let attempt = 0; !stopped.signal.aborted; attempt++) {
      try {
        client = await openImap(accountId);
        if (!client.has("IDLE")) {
          logger.info("imap-watch", `${accountId}'s server can't IDLE; syncing on the timer`);
          await client.logout();
          return;
        }
        await client.select("INBOX");
        changed();
        while (!stopped.signal.aborted) {
          const started = Date.now();
          session = await client.idle(changed);
          const renew = setTimeout(() => void session?.stop(), RENEW_MS);
          try {
            await session.done;
          } finally {
            clearTimeout(renew);
            session = null;
          }
          const lasted = Date.now() - started;
          if (lasted >= HEALTHY_MS) attempt = 0;
          if (resumed) {
            resumed = false;
            changed();
          } else if (!stopped.signal.aborted) await pause(Math.max(0, IDLE_GAP_MS - lasted));
        }
      } catch (err) {
        if (stopped.signal.aborted) break;
        client?.close();
        if (isSignInFailure(err)) {
          logger.info("imap-watch", `IDLE for ${accountId} stopped: ${String(err)}`);
          changed();
          return;
        }
        const delay = resumed ? 0 : Math.min(RETRY_MIN_MS * 2 ** attempt, RETRY_MAX_MS);
        resumed = false;
        logger.info(
          "imap-watch",
          `IDLE for ${accountId} dropped (${String(err)}); again in ${delay / 1000}s`,
        );
        await pause(delay);
      }
    }
    await client?.logout();
  };
  void run();

  const stopResume = platform().onResume(() => {
    resumed = true;
    if (session) void session.stop();
    else wake?.();
  });

  return () => {
    stopResume();
    stopped.abort();
    clearTimeout(debounce);
    wake?.();
    const idling = session;
    const open = client;
    void (async () => {
      await idling?.stop();
      await open?.logout();
    })();
  };
}
