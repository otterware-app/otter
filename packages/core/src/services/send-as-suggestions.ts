import { FREEMAIL_DOMAINS } from "./freemail.ts";
import type { AddressCounts } from "./mail-store.ts";
import { isSingleAddress } from "./outgoing.ts";

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1);

/**
 * Addresses a mailbox seems to send from besides the ones it has (`own`): an iCloud+ custom
 * domain's, an alias. Any it sent mail from, and any at a domain of its own that mail came to
 * more than once. A public service's domain (icloud.com, gmail.com) is no one's own, so mail to
 * someone else there never counts. Most used first.
 */
export function suggestSendAs(
  own: readonly string[],
  { sentFrom, receivedAt }: { sentFrom: AddressCounts; receivedAt: AddressCounts },
  limit = 8,
): string[] {
  const known = new Set(own.map((a) => a.toLowerCase()));
  const fresh = (address: string) => !known.has(address) && isSingleAddress(address);
  const domains = new Set(
    [...known, ...[...sentFrom.keys()].filter(fresh)]
      .map(domainOf)
      .filter((domain) => !FREEMAIL_DOMAINS.has(domain)),
  );
  const scores = new Map<string, number>();
  for (const [address, count] of sentFrom) {
    if (fresh(address)) scores.set(address, count);
  }
  for (const [address, count] of receivedAt) {
    if (!fresh(address) || !domains.has(domainOf(address))) continue;
    const sent = scores.get(address);
    if (sent !== undefined) scores.set(address, sent + count);
    else if (count > 1) scores.set(address, count);
  }
  return [...scores]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([address]) => address);
}
