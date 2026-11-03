// Use a plain Worker: long-lived IMAP IDLE connections would incur Durable Object wall-clock billing.
// TLS runs inside the tunnel; the relay carries ciphertext after any STARTTLS greeting.

import { connect } from "cloudflare:sockets";
import { TUNNEL_CLOSE } from "@otter-mail/contracts/relay";

const PORTS = new Set([143, 993, 465, 587]);

/** Closed after this long without a byte either way (IDLE re-issues every 25 minutes). */
const IDLE_MS = 30 * 60_000;

const BACKLOG_BYTES = 8 * 2 ** 20;

const DOWN_RATE = 4 * 2 ** 20;
const DOWN_BURST = 8 * 2 ** 20;

const DNS_NAME =
  /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const OCTET = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

function isPrivateIPv4([a, b]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b! >= 64 && b! < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! < 32) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

/**
 * Whether the tunnel may reach `host:port`: a mail port, on a DNS name or a
 * public IPv4 address (no IPv6 literals, no localhost). A DNS name is only
 * checked by its spelling: what it resolves to is up to connect(), which
 * refuses Cloudflare's, private and loopback addresses. `testTarget`
 * ("host:port") is let through regardless; only tests set it.
 */
export function allowed(host: string, port: number, testTarget?: string): boolean {
  if (testTarget && `${host}:${port}` === testTarget) return true;
  if (!PORTS.has(port) || !DNS_NAME.test(host)) return false;
  const labels = host.toLowerCase().split(".");
  if (labels.at(-1) === "localhost") return false;
  if (!/^(0x[0-9a-f]*|\d+)$/.test(labels.at(-1)!)) return true;
  return (
    labels.length === 4 && labels.every((l) => OCTET.test(l)) && !isPrivateIPv4(labels.map(Number))
  );
}

export function refuse(code: number, reason: string): Response {
  const { 0: client, 1: ws } = new WebSocketPair();
  ws.accept();
  ws.close(code, reason);
  return new Response(null, { status: 101, webSocket: client });
}

export function open(host: string, port: number, maxBytes: number): Response {
  const { 0: client, 1: ws } = new WebSocketPair();
  ws.binaryType = "arraybuffer";
  ws.accept();
  const socket = connect(
    { hostname: host, port },
    { secureTransport: "off", allowHalfOpen: false },
  );
  const writer = socket.writable.getWriter();
  const started = Date.now();
  let last = started;
  let up = 0;
  let down = 0;
  let done = false;
  let backlog = 0;
  let writing = Promise.resolve();

  const finish = (code: number, reason: string) => {
    if (done) return;
    done = true;
    clearTimeout(idle);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed by the client.
    }
    socket.close().catch(() => {});
    console.log("tunnel", {
      host,
      port,
      maxBytes,
      code,
      up,
      down,
      seconds: Math.round((Date.now() - started) / 1000),
    });
  };

  const checkIdle = () => {
    const left = last + IDLE_MS - Date.now();
    if (left <= 0) finish(TUNNEL_CLOSE.idle, "Idle");
    else idle = setTimeout(checkIdle, left);
  };
  let idle = setTimeout(checkIdle, IDLE_MS);

  ws.addEventListener("message", ({ data }) => {
    if (done) return;
    if (typeof data === "string") return finish(1003, "Binary frames only");
    const bytes = new Uint8Array(data);
    up += bytes.byteLength;
    backlog += bytes.byteLength;
    last = Date.now();
    if (up > maxBytes) return finish(TUNNEL_CLOSE.limit, "Byte limit reached");
    if (backlog > BACKLOG_BYTES) return finish(TUNNEL_CLOSE.backlog, "Sending too fast");
    writing = writing.then(async () => {
      if (done) return;
      try {
        await writer.write(bytes);
        backlog -= bytes.byteLength;
      } catch {
        finish(TUNNEL_CLOSE.lost, "Connection lost");
      }
    });
  });
  ws.addEventListener("close", () => finish(1000, "Closed"));
  ws.addEventListener("error", () => finish(1000, "Closed"));

  socket.opened.then(
    async () => {
      if (done) return;
      ws.send("open");
      let credit = DOWN_BURST;
      let refilled = Date.now();
      try {
        for await (const chunk of socket.readable as ReadableStream<Uint8Array>) {
          if (done) return;
          down += chunk.byteLength;
          last = Date.now();
          if (down > maxBytes) return finish(TUNNEL_CLOSE.limit, "Byte limit reached");
          ws.send(chunk);
          credit = Math.min(DOWN_BURST, credit + ((last - refilled) / 1000) * DOWN_RATE);
          refilled = last;
          credit -= chunk.byteLength;
          if (credit < 0)
            await new Promise((resolve) => setTimeout(resolve, (-credit / DOWN_RATE) * 1000));
        }
        finish(1000, "Closed by the server");
      } catch {
        finish(TUNNEL_CLOSE.lost, "Connection lost");
      }
    },
    (err: unknown) =>
      finish(TUNNEL_CLOSE.connectFailed, `Couldn't connect: ${String(err)}`.slice(0, 120)),
  );

  return new Response(null, { status: 101, webSocket: client });
}
