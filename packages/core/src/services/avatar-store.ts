/**
 * Sender avatars. Gmail exposes no sender photos, so this resolves them from
 * side channels, best first:
 *   1. Google People API (contacts + "other contacts") — real profile photos
 *   2. Gravatar
 *   3. The sender domain's favicon/logo (Google s2, then DuckDuckGo icons;
 *      tried for the exact domain and its registrable root, skipped for
 *      free-mail domains)
 * Results — including misses — are cached in the mail store's kv table so each
 * sender costs at most one network cascade per TTL window.
 */

import { fromBase64, sha256Hex, toBase64 } from "../bytes.js";
import { logger } from "../logger.js";
import { platform } from "../platform.js";
import { findProvider } from "../providers/index.js";
import { getKv, setKv } from "./mail-store.js";

const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 300 * 1024;
const FETCH_TIMEOUT_MS = 6_000;

/** Domains where a "company logo" would be wrong for a personal sender. */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "aol.com",
  "mail.com",
  "zoho.com",
  "hey.com",
  "fastmail.com",
  "t-online.de",
  "orange.fr",
  "free.fr",
]);

type CacheEntry = { dataUrl: string | null; fetchedAt: number };

const inFlight = new Map<string, Promise<string | null>>();

// v2: bumped when the source cascade changes so stale misses re-resolve.
function cacheKey(email: string): string {
  return `avatar2:${email}`;
}

type FetchInit = { headers?: Record<string, string> };

async function fetchWithTimeout(url: string, init?: FetchInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

async function fetchImageAsDataUrl(url: string, init?: FetchInit): Promise<string | null> {
  const response = await fetchWithTimeout(url, init);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
  return `data:${contentType.split(";")[0]};base64,${toBase64(bytes)}`;
}

type PeoplePerson = {
  photos?: { url?: string; default?: boolean }[];
  emailAddresses?: { value?: string }[];
};

function photoFromPeopleResults(
  results: { person?: PeoplePerson }[],
  email: string,
): string | null {
  for (const result of results) {
    const person = result.person;
    if (!person) continue;
    const matches = (person.emailAddresses ?? []).some((e) => e.value?.toLowerCase() === email);
    if (!matches) continue;
    const photo = (person.photos ?? []).find((p) => p.url && !p.default);
    if (photo?.url) return photo.url;
  }
  return null;
}

/** Real contact photos via the People API (needs the contacts scopes). */
async function fromPeopleApi(accountId: string, email: string): Promise<string | null> {
  const token = await platform().google.getAccessToken(accountId);
  const headers = { Authorization: `Bearer ${token}` };
  const query = encodeURIComponent(email);
  const readMask = "readMask=photos,emailAddresses";
  const endpoints = [
    `https://people.googleapis.com/v1/people:searchContacts?query=${query}&${readMask}`,
    `https://people.googleapis.com/v1/otherContacts:search?query=${query}&${readMask}`,
  ];
  for (const endpoint of endpoints) {
    const response = await fetchWithTimeout(endpoint, { headers });
    if (!response.ok) continue;
    const body = (await response.json()) as { results?: { person?: PeoplePerson }[] };
    const photoUrl = photoFromPeopleResults(body.results ?? [], email);
    if (photoUrl) {
      const sized = photoUrl.includes("=") ? photoUrl : `${photoUrl}=s128`;
      const dataUrl = await fetchImageAsDataUrl(sized);
      if (dataUrl) return dataUrl;
    }
  }
  return null;
}

async function fromGravatar(email: string): Promise<string | null> {
  const hash = await sha256Hex(email);
  return fetchImageAsDataUrl(`https://www.gravatar.com/avatar/${hash}?s=128&d=404`);
}

function pngWidth(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  const bytes = fromBase64(base64);
  if (bytes.length < 24) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0) === 0x89504e47 ? view.getUint32(16) : 0;
}

function registrableDomain(domain: string): string {
  const parts = domain.split(".");
  if (parts.length <= 2) return domain;
  const secondLevel = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);
  const take = secondLevel.has(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join(".");
}

async function domainLogoFor(domain: string): Promise<string | null> {
  const s2 = await fetchImageAsDataUrl(
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
  );
  if (s2 && pngWidth(s2) >= 32) return s2;
  return fetchImageAsDataUrl(`https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`);
}

async function fromDomainLogo(email: string): Promise<string | null> {
  const domain = email.split("@")[1];
  if (!domain || FREEMAIL_DOMAINS.has(domain)) return null;
  const exact = await domainLogoFor(domain);
  if (exact) return exact;
  const root = registrableDomain(domain);
  if (root !== domain && !FREEMAIL_DOMAINS.has(root)) return domainLogoFor(root);
  return null;
}

async function resolveAvatar(accountId: string, email: string): Promise<string | null> {
  const sources: (() => Promise<string | null>)[] = [
    // Contact photos need a Google sign-in; other mailboxes start at Gravatar.
    ...(findProvider(accountId)?.kind === "gmail" ? [() => fromPeopleApi(accountId, email)] : []),
    () => fromGravatar(email),
    () => fromDomainLogo(email),
  ];
  for (const source of sources) {
    try {
      const dataUrl = await source();
      if (dataUrl) return dataUrl;
    } catch {
      // network hiccup or missing scope — fall through to the next source
    }
  }
  return null;
}

export async function getSenderAvatar(accountId: string, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;

  const cached = getKv(cacheKey(normalized));
  if (cached) {
    try {
      const entry = JSON.parse(cached) as CacheEntry;
      const ttl = entry.dataUrl ? HIT_TTL_MS : MISS_TTL_MS;
      if (Date.now() - entry.fetchedAt < ttl) return entry.dataUrl;
    } catch {
      // corrupt entry — refetch
    }
  }

  const pending = inFlight.get(normalized);
  if (pending) return pending;

  const promise = (async () => {
    const dataUrl = await resolveAvatar(accountId, normalized);
    const entry: CacheEntry = { dataUrl, fetchedAt: Date.now() };
    setKv(cacheKey(normalized), JSON.stringify(entry));
    logger.debug("avatar-store", "resolved sender avatar", {
      email: normalized,
      hit: dataUrl != null,
    });
    return dataUrl;
  })().finally(() => {
    inFlight.delete(normalized);
  });
  inFlight.set(normalized, promise);
  return promise;
}
