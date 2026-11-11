/** Adapted from T3 Code (github.com/pingdotgg/t3code, packages/shared/src/thirdPartyLicenses.ts; MIT, see THIRD_PARTY_NOTICES.md). */
export const THIRD_PARTY_LICENSES_PATH = "/third-party-licenses.json";

export interface ThirdPartyLicenseEntry {
  readonly bundles: ReadonlyArray<string>;
  readonly kind: "custom" | "package";
  readonly license: string;
  readonly name: string;
  readonly noticeText: string;
  readonly sourceUrl: string | null;
  readonly version: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function decodeEntry(value: unknown, index: number): ThirdPartyLicenseEntry {
  if (
    !isRecord(value) ||
    !Array.isArray(value.bundles) ||
    !value.bundles.every((bundle) => typeof bundle === "string") ||
    (value.kind !== "custom" && value.kind !== "package") ||
    typeof value.license !== "string" ||
    typeof value.name !== "string" ||
    typeof value.noticeText !== "string" ||
    (value.sourceUrl !== null && !isHttpUrl(value.sourceUrl)) ||
    (value.version !== null && typeof value.version !== "string")
  ) {
    throw new Error(`License entry ${String(index + 1)} has an invalid shape.`);
  }
  return {
    bundles: value.bundles,
    kind: value.kind,
    license: value.license,
    name: value.name,
    noticeText: value.noticeText,
    sourceUrl: value.sourceUrl,
    version: value.version,
  };
}

export function decodeThirdPartyLicenses(value: unknown): ReadonlyArray<ThirdPartyLicenseEntry> {
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    throw new Error("The open-source license manifest has an unsupported format.");
  }
  return value.entries.map(decodeEntry);
}

export function filterThirdPartyLicenses(
  entries: ReadonlyArray<ThirdPartyLicenseEntry>,
  query: string,
): ReadonlyArray<ThirdPartyLicenseEntry> {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return entries;
  return entries.filter((entry) => {
    const searchable = `${entry.name} ${entry.version ?? ""} ${entry.license}`.toLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function thirdPartyLicenseKey(entry: ThirdPartyLicenseEntry): string {
  return `${entry.kind}:${entry.name}@${entry.version ?? ""}`;
}
