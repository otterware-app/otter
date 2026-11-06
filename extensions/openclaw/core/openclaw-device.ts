import { ed25519 } from "@noble/curves/ed25519";
import { fromBase64, sha256, toBase64Url, toHex } from "@otter-mail/core/extension-kit";

/** This device's key as WebCrypto exported it (JWK), so keys saved before keep working. */
export type OpenClawDeviceKey = {
  kty: "OKP";
  crv: "Ed25519";
  d: string;
  x: string;
  ext?: boolean;
  key_ops?: string[];
};

export function newOpenClawDeviceKey(): OpenClawDeviceKey {
  return keyFromSeed(ed25519.utils.randomPrivateKey());
}

function keyFromSeed(seed: Uint8Array): OpenClawDeviceKey {
  return {
    crv: "Ed25519",
    d: toBase64Url(seed),
    ext: true,
    key_ops: ["sign"],
    kty: "OKP",
    x: toBase64Url(ed25519.getPublicKey(seed)),
  };
}

/**
 * A saved key: the JWK, or the Swift iPhone app's raw 32-byte seed in base64, which `fromSwift`
 * marks so the caller saves it back as a JWK.
 */
export function savedOpenClawDeviceKey(
  saved: string,
): { key: OpenClawDeviceKey; fromSwift: boolean } | null {
  if (saved.startsWith("{"))
    return { key: JSON.parse(saved) as OpenClawDeviceKey, fromSwift: false };
  let seed: Uint8Array;
  try {
    seed = fromBase64(saved);
  } catch {
    return null;
  }
  return seed.length === 32 ? { key: keyFromSeed(seed), fromSwift: true } : null;
}

/** The gateway knows a device by its public key's SHA-256, in hex. */
export function openClawDeviceIdentity(key: OpenClawDeviceKey) {
  const seed = fromBase64(key.d);
  return {
    deviceId: toHex(sha256(fromBase64(key.x))),
    publicKey: key.x,
    sign: async (payload: string) =>
      toBase64Url(ed25519.sign(new TextEncoder().encode(payload), seed)),
  };
}
