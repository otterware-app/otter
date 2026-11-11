import { describe, expect, it } from "vite-plus/test";

import { decodeThirdPartyLicenses, filterThirdPartyLicenses } from "./third-party-licenses";

const entry = {
  bundles: ["web"],
  kind: "package",
  license: "MIT",
  name: "react",
  noticeText: "MIT License",
  sourceUrl: "https://github.com/facebook/react",
  version: "19.0.0",
};

describe("third-party licenses", () => {
  it("decodes the manifest the build writes", () => {
    expect(decodeThirdPartyLicenses({ schemaVersion: 1, entries: [entry] })).toEqual([entry]);
  });

  it("refuses another format, an entry out of shape and a link that isn't to the web", () => {
    expect(() => decodeThirdPartyLicenses({ schemaVersion: 2, entries: [] })).toThrow();
    expect(() =>
      decodeThirdPartyLicenses({ schemaVersion: 1, entries: [{ ...entry, license: 1 }] }),
    ).toThrow("License entry 1");
    expect(() =>
      decodeThirdPartyLicenses({
        schemaVersion: 1,
        entries: [{ ...entry, sourceUrl: "javascript:alert(1)" }],
      }),
    ).toThrow("License entry 1");
  });

  it("finds entries by every word of the search, in name, version or license", () => {
    const entries = decodeThirdPartyLicenses({
      schemaVersion: 1,
      entries: [entry, { ...entry, name: "pdfjs-dist", license: "Apache-2.0", version: "5.0.0" }],
    });
    expect(filterThirdPartyLicenses(entries, "")).toHaveLength(2);
    expect(filterThirdPartyLicenses(entries, "apache pdf").map((e) => e.name)).toEqual([
      "pdfjs-dist",
    ]);
    expect(filterThirdPartyLicenses(entries, "react apache")).toEqual([]);
  });
});
