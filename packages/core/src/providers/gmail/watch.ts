import { logger } from "../../logger.js";
import * as mailStore from "../../services/mail-store.js";
import { watchMailbox } from "./api.js";

const RENEW_AFTER_MS = 24 * 60 * 60_000;

type Watch = { topic: string; renewedAt: number; expiration: number };

const watchKey = (accountId: string) => `gmailWatch:${accountId}`;

function readWatch(accountId: string): Watch | null {
  const saved = mailStore.getKv(watchKey(accountId));
  if (!saved) return null;
  try {
    return JSON.parse(saved) as Watch;
  } catch {
    return null;
  }
}

/**
 * Starts or renews the account's watch when it needs it. Answers whether
 * Gmail is publishing for it; one that fails (signed out, offline) is left to
 * polling and retried next time.
 */
export async function renewWatch(accountId: string, topic: string): Promise<boolean> {
  const watch = readWatch(accountId);
  if (watch?.topic === topic && Date.now() - watch.renewedAt < RENEW_AFTER_MS) {
    return watch.expiration > Date.now();
  }
  try {
    const { expiration } = await watchMailbox(accountId, topic);
    mailStore.setKv(
      watchKey(accountId),
      JSON.stringify({ topic, renewedAt: Date.now(), expiration } satisfies Watch),
    );
    logger.info("gmail-watch", "Watching", {
      accountId,
      until: new Date(expiration).toISOString(),
    });
    return true;
  } catch (err) {
    logger.info("gmail-watch", `Couldn't watch ${accountId}: ${String(err)}`);
    return false;
  }
}
