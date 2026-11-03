/**
 * Platform.connect for the web app. A browser can't open TCP connections, so
 * each one is a WebSocket to the relay's tunnel (`/v1/tunnel`, protocol in
 * contracts' relay.ts), which opens the TCP connection and pipes bytes both
 * ways. TLS happens here in the worker (tls.ts, loaded on the first
 * connection), so the relay only carries ciphertext.
 */

import type { ByteStream } from "@otter-mail/core";
import { TUNNEL_CLOSE } from "@otter-mail/contracts/relay";

const CONNECT_TIMEOUT_MS = 20_000;
/** Bytes from the server not yet read: past this the connection goes (a WebSocket can't be paused). */
const MAX_UNREAD = 64 * 1024 * 1024;

export async function connectMailSocket(
  relayUrl: string,
  host: string,
  port: number,
  opts: { tls: boolean },
): Promise<ByteStream> {
  const query = new URLSearchParams({ host, port: String(port) });
  const ws = new WebSocket(`${relayUrl.replace(/^http/, "ws")}/v1/tunnel?${query}`);
  ws.binaryType = "arraybuffer";

  const chunks: Uint8Array[] = [];
  let unread = 0;
  let opened = false;
  let closed = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;

  const closeError = (code: number, reason: string): Error | null => {
    if (code === TUNNEL_CLOSE.connectFailed) {
      return new Error(`Couldn't connect to ${host} on port ${port}. ${reason}`);
    }
    if (code === TUNNEL_CLOSE.rateLimited) {
      return new Error("Too many connections through Otter's relay, retrying shortly.");
    }
    if (
      code === TUNNEL_CLOSE.lost ||
      code === TUNNEL_CLOSE.limit ||
      code === TUNNEL_CLOSE.backlog
    ) {
      return new Error(`Lost the connection to ${host}.`);
    }
    if (code === TUNNEL_CLOSE.idle) return new Error(`The connection to ${host} idled out.`);
    return opened ? null : new Error(`Couldn't reach ${host} through Otter's relay.`);
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${host} didn't answer on port ${port}.`));
      ws.close();
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener("message", ({ data }) => {
      if (data instanceof ArrayBuffer) {
        if (failure) return;
        unread += data.byteLength;
        if (unread > MAX_UNREAD) {
          failure = new Error(`${host} sent more than we could keep up with.`);
          chunks.length = 0;
          ws.close();
        } else {
          chunks.push(new Uint8Array(data));
        }
        wake?.();
      } else if (data === "open") {
        opened = true;
        clearTimeout(timer);
        resolve();
      }
    });
    ws.addEventListener("close", ({ code, reason }) => {
      clearTimeout(timer);
      closed = true;
      failure ??= closeError(code, reason);
      if (failure) reject(failure);
      wake?.();
    });
  });

  const readPlain = async (): Promise<Uint8Array | null> => {
    while (chunks.length === 0) {
      if (failure) throw failure;
      if (closed) return null;
      await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
    }
    const chunk = chunks.shift()!;
    unread -= chunk.length;
    return chunk;
  };
  const writePlain = (data: Uint8Array) => {
    if (ws.readyState !== WebSocket.OPEN) {
      throw failure ?? new Error(`${host} closed the connection.`);
    }
    ws.send(data);
  };

  let read = readPlain;
  let write = async (data: Uint8Array) => writePlain(data);
  const secure = async () => {
    // Anything the server sent after its go-ahead would be unencrypted bytes
    // an attacker could have slipped in: refuse it.
    if (chunks.length > 0) throw new Error(`${host} sent data before STARTTLS completed.`);
    const timer = setTimeout(() => ws.close(), CONNECT_TIMEOUT_MS);
    try {
      const { negotiateTls } = await import("./tls");
      const tls = await negotiateTls(host, readPlain, writePlain);
      read = async () => (await tls.read()) ?? null;
      write = tls.write;
    } finally {
      clearTimeout(timer);
    }
  };

  if (opts.tls) {
    try {
      await secure();
    } catch (err) {
      ws.close();
      throw err;
    }
  }
  return {
    read: () => read(),
    write: (data) => write(data),
    startTls: secure,
    close: () => ws.close(),
  };
}
