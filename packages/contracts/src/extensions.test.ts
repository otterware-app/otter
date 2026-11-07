import { describe, expect, it } from "vite-plus/test";

import { extensionManifest, runsOn } from "./extensions.js";

const manifest = (platforms?: unknown) =>
  extensionManifest({
    otterMail: {
      id: "sample",
      name: "Sample",
      description: "A sample.",
      category: "mail",
      dataUse: "None.",
      ...(platforms ? { platforms } : {}),
    },
  });

describe("runsOn", () => {
  it("runs a manifest without platforms everywhere but the phone", () => {
    const any = manifest();
    expect(["mac", "linux", "web"].every((p) => runsOn(any, p as "mac"))).toBe(true);
    expect(runsOn(any, "ios")).toBe(false);
  });

  it("runs on the phone only when the manifest names it", () => {
    expect(runsOn(manifest(["ios", "web"]), "ios")).toBe(true);
    expect(runsOn(manifest(["ios"]), "mac")).toBe(false);
  });
});
