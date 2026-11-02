// Full-format fetches cost more quota than Google's published method costs.
// Pace all callers through one per-account budget and reduce it when Gmail reports exhaustion.

import { platform, type AsyncContext } from "../../platform.js";
import type { Lane } from "../provider.js";

/** Gmail's per-minute limit for this project, per user. */
const UNITS_PER_MINUTE_LIMIT = 6_000;
/**
 * What a minute may spend (a full minute of refill plus one full burst): it
 * starts below the limit, where a big sync settled on a real mailbox (Gmail
 * counts a little more than the table), and never goes past MAX_BUDGET.
 */
const START_BUDGET = UNITS_PER_MINUTE_LIMIT * 0.8;
const MAX_BUDGET = UNITS_PER_MINUTE_LIMIT * 0.95;
const CAPACITY = 600;
/** After a refusal the budget never drops below this, and climbs back this much a minute. */
const MIN_BUDGET = UNITS_PER_MINUTE_LIMIT * 0.2;
const RECOVERY_PER_MINUTE = UNITS_PER_MINUTE_LIMIT * 0.01;
const RESERVE: Record<Lane, number> = { sync: 100, backfill: 200, prefetch: 300 };
/** Background tiers, most urgent first: each yields to those before it. */
const TIERS: Lane[] = ["sync", "backfill", "prefetch"];
const COOLDOWN_MS = 60_000;

type Bucket = {
  tokens: number;
  updatedAt: number;
  budget: number;
  cooldownUntil: number;
  foregroundWaiting: number;
  waiting: Record<Lane, number>;
};

const buckets = new Map<string, Bucket>();
const spent = new Map<string, [number, number][]>();

export function budgetOf(accountId: string): number {
  return Math.round(bucketFor(accountId).budget);
}

export function spentLastMinute(accountId: string): number {
  const recent = (spent.get(accountId) ?? []).filter(([at]) => at > Date.now() - 60_000);
  spent.set(accountId, recent);
  return recent.reduce((sum, [, units]) => sum + units, 0);
}

function record(accountId: string, units: number): void {
  const list = spent.get(accountId) ?? [];
  list.push([Date.now(), units]);
  if (list.length > 2000) list.splice(0, list.length - 1000);
  spent.set(accountId, list);
}
let tierContext: AsyncContext<Lane> | null = null;
const tier = (): AsyncContext<Lane> => (tierContext ??= platform().asyncContext<Lane>());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function bucketFor(accountId: string): Bucket {
  let bucket = buckets.get(accountId);
  if (!bucket) {
    bucket = {
      tokens: CAPACITY,
      updatedAt: Date.now(),
      budget: START_BUDGET,
      cooldownUntil: 0,
      foregroundWaiting: 0,
      waiting: { sync: 0, backfill: 0, prefetch: 0 },
    };
    buckets.set(accountId, bucket);
  }
  const now = Date.now();
  const elapsed = now - bucket.updatedAt;
  bucket.budget = Math.min(MAX_BUDGET, bucket.budget + (elapsed / 60_000) * RECOVERY_PER_MINUTE);
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + (elapsed / 1000) * unitsPerSecond(bucket));
  bucket.updatedAt = now;
  return bucket;
}

function unitsPerSecond(bucket: Bucket): number {
  return Math.max(1, (bucket.budget - CAPACITY) / 60);
}

export function inTier<T>(lane: Lane, fn: () => Promise<T>): Promise<T> {
  return tier().run(lane, fn);
}

export function isBackgroundWork(): boolean {
  return tier().get() !== undefined;
}

export function isCoolingDown(accountId: string): boolean {
  return Date.now() < bucketFor(accountId).cooldownUntil;
}

export async function acquireQuota(accountId: string, units: number): Promise<void> {
  const current = tier().get();
  if (current === undefined) {
    let bucket = bucketFor(accountId);
    if (bucket.tokens >= units) {
      bucket.tokens -= units;
      record(accountId, units);
      return;
    }
    bucket.foregroundWaiting += 1;
    try {
      while (bucket.tokens < units) {
        await sleep(((units - bucket.tokens) / unitsPerSecond(bucket)) * 1000);
        bucket = bucketFor(accountId);
      }
      bucket.tokens -= units;
      record(accountId, units);
    } finally {
      bucket.foregroundWaiting -= 1;
    }
    return;
  }

  const ahead = TIERS.slice(0, TIERS.indexOf(current));
  const counted = bucketFor(accountId);
  counted.waiting[current] += 1;
  try {
    for (;;) {
      const bucket = bucketFor(accountId);
      const now = Date.now();
      if (now < bucket.cooldownUntil) {
        await sleep(bucket.cooldownUntil - now);
        continue;
      }
      const needed = units + RESERVE[current];
      const yielding =
        bucket.foregroundWaiting > 0 || ahead.some((lane) => bucket.waiting[lane] > 0);
      if (!yielding && bucket.tokens >= needed) {
        bucket.tokens -= units;
        record(accountId, units);
        return;
      }
      await sleep(Math.max(50, ((needed - bucket.tokens) / unitsPerSecond(bucket)) * 1000));
    }
  } finally {
    counted.waiting[current] -= 1;
  }
}

/**
 * Gmail said the quota is exhausted: drain the bucket so everyone slows down,
 * bring the minute's budget down to what it let through, and keep background
 * work away for `retryAfterMs` (at least COOLDOWN_MS). Refusals of requests
 * already in flight are the same event: false for those.
 */
export function reportQuotaExceeded(accountId: string, retryAfterMs: number): boolean {
  const bucket = bucketFor(accountId);
  bucket.tokens = 0;
  const now = Date.now();
  if (now < bucket.cooldownUntil) return false;
  const used = spentLastMinute(accountId);
  const allowed = used > bucket.budget * 0.3 ? used * 0.9 : bucket.budget * 0.8;
  bucket.budget = Math.max(MIN_BUDGET, Math.min(bucket.budget, allowed));
  bucket.cooldownUntil = now + Math.max(retryAfterMs, COOLDOWN_MS);
  return true;
}

export function quotaCost(method: string, path: string): number {
  const p = path.split("?")[0]!;
  const write = method !== "GET";
  if (p === "/profile") return 1;
  if (p.startsWith("/labels")) return write ? 5 : 1;
  if (p.startsWith("/settings/sendAs")) return method === "GET" ? 1 : 100;
  if (p.startsWith("/history")) return 2;
  if (p === "/watch" || p === "/messages/send" || p === "/drafts/send") return 100;
  if (p === "/stop" || /^\/messages\/batch(Delete|Modify)$/.test(p)) return 50;
  if (p === "/messages") return write ? 25 : 5;
  if (p === "/threads") return 10;
  if (p === "/drafts") return write ? 10 : 5;
  const [, kind, , action] = p.split("/");
  const full = /[?&]format=full\b/.test(path);
  if (kind === "messages") {
    if (action === "attachments" || action === "trash") return 20;
    if (action === "modify" || action === "untrash") return 5;
    if (method === "DELETE") return 10;
    return full ? 50 : 20;
  }
  if (kind === "threads") {
    if (action === "trash") return 20;
    if (action === "modify" || action === "untrash") return 10;
    if (method === "DELETE") return 20;
    return full ? 100 : 40;
  }
  if (kind === "drafts") return method === "PUT" ? 15 : method === "DELETE" ? 10 : 20;
  return 20;
}
