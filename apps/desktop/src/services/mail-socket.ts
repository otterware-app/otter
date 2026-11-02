import * as net from "node:net";
import * as tls from "node:tls";

import type { ByteStream } from "@otter-mail/core";

const CONNECT_TIMEOUT_MS = 20_000;
const HIGH_WATER_BYTES = 1 << 20;

let trusted: string[] | undefined;
const ca = () =>
  (trusted ??= [
    ...new Set([...tls.getCACertificates("default"), ...tls.getCACertificates("system")]),
  ]);

function describe(err: NodeJS.ErrnoException, host: string, port: number): Error {
  switch (err.code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return new Error(`Couldn't find the server ${host}.`);
    case "ECONNREFUSED":
      return new Error(`${host} refused the connection on port ${port}.`);
    case "ETIMEDOUT":
      return new Error(`${host} didn't answer on port ${port}.`);
    case "ECONNRESET":
      return new Error(`${host} closed the connection.`);
  }
  if (err.code?.startsWith("ERR_TLS_") || /CERT|SELF_SIGNED|UNABLE_TO/.test(err.code ?? "")) {
    return new Error(`${host}'s certificate isn't trusted: ${err.message}`);
  }
  return new Error(`Couldn't connect to ${host}: ${err.message}`);
}

function ready(socket: net.Socket, event: string, host: string, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    }, CONNECT_TIMEOUT_MS);
    const settle = (err?: Error) => {
      clearTimeout(timer);
      socket.off(event, onReady).off("error", settle);
      if (err) reject(describe(err, host, port));
      else resolve();
    };
    const onReady = () => settle();
    socket.once(event, onReady).once("error", settle);
  });
}

export async function connectMailSocket(
  host: string,
  port: number,
  opts: { tls: boolean },
): Promise<ByteStream> {
  let socket: net.Socket = opts.tls
    ? tls.connect({ host, port, servername: host, ca: ca() })
    : net.connect({ host, port });
  await ready(socket, opts.tls ? "secureConnect" : "connect", host, port);

  const chunks: Uint8Array[] = [];
  let queued = 0;
  let ended = false;
  let failure: Error | null = null;
  let wake: (() => void) | null = null;
  const notify = () => {
    wake?.();
    wake = null;
  };

  const onData = (data: Buffer) => {
    chunks.push(new Uint8Array(data));
    queued += data.length;
    if (queued > HIGH_WATER_BYTES) socket.pause();
    notify();
  };
  const onClose = () => {
    ended = true;
    notify();
  };
  const onError = (err: Error) => {
    failure ??= describe(err, host, port);
    notify();
  };
  const listen = (s: net.Socket) => s.on("data", onData).on("close", onClose).on("error", onError);
  listen(socket);

  return {
    async read() {
      while (chunks.length === 0) {
        if (failure) throw failure;
        if (ended) return null;
        await new Promise<void>((resolve) => (wake = resolve));
      }
      const chunk = chunks.shift()!;
      queued -= chunk.length;
      if (queued <= HIGH_WATER_BYTES && socket.isPaused()) socket.resume();
      return chunk;
    },
    write(data) {
      return new Promise((resolve, reject) =>
        socket.write(data, (err) => (err ? reject(describe(err, host, port)) : resolve())),
      );
    },
    async startTls() {
      // Anything the server sent after its go-ahead would be unencrypted
      // bytes an attacker could have slipped in: refuse it.
      if (chunks.length > 0) throw new Error(`${host} sent data before STARTTLS completed.`);
      const plain = socket;
      plain.off("data", onData).off("close", onClose).off("error", onError);
      socket = tls.connect({ socket: plain, servername: host, ca: ca() });
      listen(socket);
      await ready(socket, "secureConnect", host, port);
    },
    close() {
      socket.destroy();
    },
  };
}
