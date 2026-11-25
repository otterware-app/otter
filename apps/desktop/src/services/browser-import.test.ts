import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it, vi } from "vite-plus/test";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-import-test-"));

vi.mock("electron-chrome-web-store", () => ({ installExtension: vi.fn() }));
vi.mock("../logger.ts", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("./browser.ts", () => ({ getBrowserSession: vi.fn() }));
vi.mock("./extensions.ts", () => ({ listExtensions: () => [{ id: "already" }] }));
vi.mock("../os/index.ts", () => ({
  hostOS: { chromiumBrowsers: () => [{ id: "chrome", name: "Google Chrome", dataDir }] },
}));

const { decryptValue, importSources, toCookie } = await import("./browser-import.ts");

const key = pbkdf2Sync("secret", "saltysalt", 1003, 16, "sha1");
const encrypt = (plain: Buffer) => {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, " "));
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
};

it("decrypts a cookie, without the domain hash newer databases put first", () => {
  const hash = createHash("sha256").update(".example.com").digest();
  const blob = encrypt(Buffer.concat([hash, Buffer.from("value")]));
  expect(decryptValue(blob, { v10: key }, ".example.com")).toBe("value");
  expect(decryptValue(encrypt(Buffer.from("old")), { v10: key }, ".example.com")).toBe("old");
  expect(decryptValue(blob, { v11: key }, ".example.com")).toBeNull();
});

const row = {
  host_key: ".example.com",
  top_frame_site_key: "",
  name: "sid",
  value: "",
  encrypted_value: new Uint8Array(),
  path: "/",
  expires_utc: BigInt(Math.floor(Date.now() / 1000) + 11_644_473_600 + 3600) * 1_000_000n,
  has_expires: 1,
  is_secure: 1,
  is_httponly: 1,
  samesite: 1,
};

it("turns a row into Electron's cookie", () => {
  expect(toCookie(row, "v")).toMatchObject({
    url: "https://example.com/",
    domain: ".example.com",
    secure: true,
    httpOnly: true,
    sameSite: "lax",
  });
  expect(toCookie({ ...row, host_key: "example.com" }, "v")).not.toHaveProperty("domain");
  expect(toCookie({ ...row, top_frame_site_key: "https://other.com" }, "v")).toBeNull();
  expect(toCookie({ ...row, expires_utc: 13_000_000_000_000_000n }, "v")).toBeNull();
  expect(toCookie({ ...row, has_expires: 0 }, "v")).not.toHaveProperty("expirationDate");
});

it("offers the profiles with cookies, and the store extensions the user added", () => {
  const profile = path.join(dataDir, "Default");
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, "Cookies"), "");
  fs.writeFileSync(
    path.join(dataDir, "Local State"),
    JSON.stringify({ profile: { info_cache: { Default: { name: "Me" }, Gone: { name: "x" } } } }),
  );
  const ext = (fields: object) => ({ location: 1, from_webstore: true, ...fields });
  fs.writeFileSync(
    path.join(profile, "Secure Preferences"),
    JSON.stringify({
      extensions: {
        settings: {
          mine: ext({ manifest: { name: "Mine" } }),
          already: ext({ manifest: { name: "Already" } }),
          builtIn: ext({ location: 5, from_webstore: false }),
          preinstalled: ext({ was_installed_by_default: true }),
          off: ext({ disable_reasons: [1] }),
        },
      },
    }),
  );
  expect(importSources()).toEqual([
    { id: "chrome/Default", name: "Google Chrome", extensions: [{ id: "mine", name: "Mine" }] },
  ]);
});
