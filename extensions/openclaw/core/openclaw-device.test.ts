import { describe, expect, it } from "vite-plus/test";

import {
  newOpenClawDeviceKey,
  openClawDeviceIdentity,
  type OpenClawDeviceKey,
} from "./openclaw-device.js";

// RFC 8032's first Ed25519 key, saved as WebCrypto's exportKey("jwk") wrote it.
const RFC_8032_KEY: OpenClawDeviceKey = {
  crv: "Ed25519",
  d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A",
  ext: true,
  key_ops: ["sign"],
  kty: "OKP",
  x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
};

const PAYLOAD = "v2|device|otter-mail|nonce";

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) => Uint8Array.from(text.match(/../g)!, (b) => parseInt(b, 16));

/** What the extension did before, with WebCrypto. */
async function webCryptoIdentity(key: OpenClawDeviceKey, payload: string) {
  const imported = await crypto.subtle.importKey("jwk", key, { name: "Ed25519" }, false, ["sign"]);
  const raw = fromBase64url(key.x);
  return {
    deviceId: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", raw))),
    signature: base64url(
      new Uint8Array(
        await crypto.subtle.sign({ name: "Ed25519" }, imported, new TextEncoder().encode(payload)),
      ),
    ),
  };
}

describe("OpenClaw device identity", () => {
  it("keeps a saved key's device id and signatures", async () => {
    const identity = openClawDeviceIdentity(RFC_8032_KEY);
    expect(identity.deviceId).toBe(
      "21fe31dfa154a261626bf854046fd2271b7bed4b6abe45aa58877ef47f9721b9",
    );
    expect(identity.publicKey).toBe(RFC_8032_KEY.x);
    expect(await identity.sign(PAYLOAD)).toBe(
      "MjfI4bEzpsXk0zjYJUME_IMe5zpH2UxvC71eM0IafXAhGIC0GekvvxwHGFdPYE0xFq2EClS7KEQOIJt9PhdHBw",
    );
    expect(await identity.sign("")).toBe(
      base64url(
        fromHex(
          "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        ),
      ),
    );
  });

  it("signs as WebCrypto does, for keys it made and keys made now", async () => {
    const generated = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ]);
    const saved = (await crypto.subtle.exportKey(
      "jwk",
      (generated as CryptoKeyPair).privateKey,
    )) as OpenClawDeviceKey;
    for (const key of [saved, newOpenClawDeviceKey()]) {
      const expected = await webCryptoIdentity(key, PAYLOAD);
      const identity = openClawDeviceIdentity(key);
      expect(identity.deviceId).toBe(expected.deviceId);
      expect(await identity.sign(PAYLOAD)).toBe(expected.signature);
    }
  });

  it("saves new keys as WebCrypto exported them", () => {
    expect(Object.keys(newOpenClawDeviceKey()).sort()).toEqual(Object.keys(RFC_8032_KEY).sort());
  });
});
