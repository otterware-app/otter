import { sha1 } from "@noble/hashes/legacy";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2";
import type { WorkerHost } from "@otter-mail/mobile-worker";
import structuredClonePolyfill from "@ungap/structured-clone";
import { ReadableStream, TransformStream, WritableStream } from "web-streams-polyfill";
import { URL, URLSearchParams } from "whatwg-url-minimum";

import { OtterWebSocket, otterFetch } from "./net";
import { installTextDecoder } from "./text";

/**
 * What a worker runtime lacks that core expects of a browser or Node. Bundle
 * Mode skips React Native's InitializeCore there, so nothing of RN's setup
 * runs: URL, crypto, streams, fetch and WebSocket all come from here.
 */
export function installPolyfills(host: WorkerHost): void {
  const global = globalThis as Record<string, unknown>;

  if (typeof global.console === "undefined") {
    const log =
      (level: string) =>
      (...args: unknown[]) =>
        host.log(
          level,
          args.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" "),
        );
    global.console = {
      log: log("info"),
      info: log("info"),
      debug: log("debug"),
      warn: log("warn"),
      error: log("error"),
    };
  }

  global.URL = URL;
  global.URLSearchParams = URLSearchParams;
  global.ReadableStream ??= ReadableStream;
  global.WritableStream ??= WritableStream;
  global.TransformStream ??= TransformStream;
  global.structuredClone ??= (value: unknown) => structuredClonePolyfill(value);
  global.performance ??= { now: () => host.now() };

  if (typeof global.TextEncoder === "undefined") {
    global.TextEncoder = class {
      readonly encoding = "utf-8";
      encode(text = ""): Uint8Array {
        const utf8 = unescape(encodeURIComponent(text));
        const out = new Uint8Array(utf8.length);
        for (let i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i);
        return out;
      }
    };
  }
  installTextDecoder(host);

  if (typeof global.btoa === "undefined") {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    global.btoa = (input: string) => {
      let out = "";
      for (let i = 0; i < input.length; i += 3) {
        const [a, b, c] = [input.charCodeAt(i), input.charCodeAt(i + 1), input.charCodeAt(i + 2)];
        const n = (a << 16) | ((b || 0) << 8) | (c || 0);
        out += alphabet[n >> 18]! + alphabet[(n >> 12) & 63]!;
        out += i + 1 < input.length ? alphabet[(n >> 6) & 63]! : "=";
        out += i + 2 < input.length ? alphabet[n & 63]! : "=";
      }
      return out;
    };
    global.atob = (input: string) => {
      const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
      let out = "";
      for (let i = 0; i < clean.length; i += 4) {
        const n =
          (alphabet.indexOf(clean[i]!) << 18) |
          (alphabet.indexOf(clean[i + 1]!) << 12) |
          ((alphabet.indexOf(clean[i + 2] ?? "A") & 63) << 6) |
          (alphabet.indexOf(clean[i + 3] ?? "A") & 63);
        out += String.fromCharCode(n >> 16);
        if (clean[i + 2]) out += String.fromCharCode((n >> 8) & 255);
        if (clean[i + 3]) out += String.fromCharCode(n & 255);
      }
      return out;
    };
  }

  const digests: Record<string, (data: Uint8Array) => Uint8Array> = {
    "SHA-1": sha1,
    "SHA-256": sha256,
    "SHA-384": sha384,
    "SHA-512": sha512,
  };
  const getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (!array) return array;
    const random = new Uint8Array(host.randomBytes(array.byteLength));
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(random);
    return array;
  };
  global.crypto = {
    getRandomValues,
    randomUUID() {
      const b = getRandomValues(new Uint8Array(16));
      b[6] = (b[6]! & 0x0f) | 0x40;
      b[8] = (b[8]! & 0x3f) | 0x80;
      const hex = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    },
    subtle: {
      async digest(algorithm: string | { name: string }, data: ArrayBuffer | ArrayBufferView) {
        const name = (typeof algorithm === "string" ? algorithm : algorithm.name).toUpperCase();
        const hash = digests[name];
        if (!hash) throw new Error(`crypto.subtle.digest: ${name} isn't supported.`);
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        return hash(bytes).slice().buffer;
      },
    },
  };

  const AbortSignal = global.AbortSignal as
    | { timeout?: (ms: number) => unknown; any?: (signals: unknown[]) => unknown }
    | undefined;
  const AbortController = global.AbortController as
    | (new () => { signal: unknown; abort(reason?: unknown): void })
    | undefined;
  if (AbortSignal && AbortController && !AbortSignal.timeout) {
    AbortSignal.timeout = (ms: number) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("The operation timed out.", "TimeoutError")),
        ms,
      );
      return controller.signal;
    };
  }

  global.fetch = otterFetch;
  global.WebSocket = OtterWebSocket;
}

function safeJson(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ""}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
