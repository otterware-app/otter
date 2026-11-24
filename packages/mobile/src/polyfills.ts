/**
 * What Hermes (React Native 0.88, Expo SDK 58) lacks of what core and the extensions use: Web
 * Crypto. Imported by the app's entry before anything else; nothing here imports core.
 */
import { CryptoDigestAlgorithm, digest, getRandomValues, randomUUID } from "expo-crypto";

import { native } from "./native.ts";

/** What this runtime lacked and got here: the self-test lists it. */
export const polyfilled: string[] = [];

const KEY = Symbol("ed25519");

type Ed25519Key = CryptoKey & { [KEY]: { privateKey?: string; publicKey: string } };

const nameOf = (algorithm: AlgorithmIdentifier) =>
  typeof algorithm === "string" ? algorithm : algorithm.name;

const refuse = (what: string): never => {
  throw new DOMException(`${what} isn't supported on this phone.`, "NotSupportedError");
};

const toBase64 = (bytes: Uint8Array) =>
  btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""));
const base64url = (base64: string) =>
  base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64url = (text: string) =>
  text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);

const bytesOf = (data: BufferSource) =>
  data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

function ed25519Key(
  type: KeyType,
  extractable: boolean,
  usages: KeyUsage[],
  bytes: Ed25519Key[typeof KEY],
): Ed25519Key {
  return { type, extractable, usages, algorithm: { name: "Ed25519" }, [KEY]: bytes };
}

/**
 * SHA-256 digests (expo-crypto) and Ed25519 keys as JWK (CryptoKit, through our module): what
 * core's `bytes.ts`, contracts' agent tokens and OpenClaw's device key ask of `crypto.subtle`.
 */
const subtle = {
  async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
    if (nameOf(algorithm) !== "SHA-256") refuse(`${nameOf(algorithm)} digests`);
    return digest(CryptoDigestAlgorithm.SHA256, data);
  },
  async generateKey(
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    usages: KeyUsage[],
  ): Promise<CryptoKeyPair> {
    if (nameOf(algorithm) !== "Ed25519") refuse(`${nameOf(algorithm)} keys`);
    const pair = native.ed25519Generate();
    return {
      privateKey: ed25519Key(
        "private",
        extractable,
        usages.filter((u) => u === "sign"),
        pair,
      ),
      publicKey: ed25519Key(
        "public",
        true,
        usages.filter((u) => u === "verify"),
        {
          publicKey: pair.publicKey,
        },
      ),
    };
  },
  async exportKey(format: KeyFormat, key: CryptoKey): Promise<JsonWebKey> {
    const bytes = (key as Partial<Ed25519Key>)[KEY];
    if (format !== "jwk" || !bytes) refuse(`Exporting as ${format}`);
    if (!key.extractable)
      throw new DOMException("The key isn't extractable.", "InvalidAccessError");
    return {
      kty: "OKP",
      crv: "Ed25519",
      x: base64url(bytes!.publicKey),
      ...(bytes!.privateKey ? { d: base64url(bytes!.privateKey) } : {}),
      key_ops: key.usages,
      ext: true,
    };
  },
  async importKey(
    format: KeyFormat,
    jwk: JsonWebKey,
    algorithm: AlgorithmIdentifier,
    extractable: boolean,
    usages: KeyUsage[],
  ): Promise<CryptoKey> {
    if (format !== "jwk" || nameOf(algorithm) !== "Ed25519") refuse(`Importing ${format}`);
    if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.x)
      throw new DOMException("That isn't an Ed25519 key.", "DataError");
    return ed25519Key(jwk.d ? "private" : "public", extractable, usages, {
      publicKey: fromBase64url(jwk.x),
      ...(jwk.d ? { privateKey: fromBase64url(jwk.d) } : {}),
    });
  },
  async sign(
    algorithm: AlgorithmIdentifier,
    key: CryptoKey,
    data: BufferSource,
  ): Promise<ArrayBuffer> {
    const privateKey = (key as Partial<Ed25519Key>)[KEY]?.privateKey;
    if (nameOf(algorithm) !== "Ed25519" || !privateKey) refuse(`Signing with ${nameOf(algorithm)}`);
    const signature = await native.ed25519Sign(privateKey!, toBase64(bytesOf(data)));
    return Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)).buffer;
  },
};

const crypto = ((globalThis as { crypto?: Partial<Crypto> }).crypto ??= {});
if (!crypto.getRandomValues) {
  crypto.getRandomValues = getRandomValues as Crypto["getRandomValues"];
  polyfilled.push("crypto.getRandomValues");
}
if (!crypto.randomUUID) {
  crypto.randomUUID = randomUUID as Crypto["randomUUID"];
  polyfilled.push("crypto.randomUUID");
}
if (!crypto.subtle) {
  (crypto as { subtle: unknown }).subtle = subtle;
  polyfilled.push("crypto.subtle (SHA-256, Ed25519)");
}
