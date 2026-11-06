#!/usr/bin/env node
// Phase 0 gate, item 4: a WebSocket that ticks every second (it needs the
// bearer header the relay's sign-in uses) and a chunked SSE stream, on
// localhost:8790 for the simulator. Logs every connection and drop.
//
//   node apps/mobile/scripts/gate-server.mts

import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

const PORT = 8790;
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

function frame(text: string): Buffer {
  const payload = Buffer.from(text);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  return Buffer.concat([header, payload]);
}

const server = NodeHttp.createServer((request, response) => {
  if (request.url !== "/sse") {
    response.writeHead(404).end();
    return;
  }
  log("sse: open");
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let id = 0;
  const timer = setInterval(() => response.write(`id: ${id}\ndata: {"tick":${id++}}\n\n`), 500);
  request.on("close", () => {
    clearInterval(timer);
    log(`sse: closed after ${id} events`);
  });
});

server.on("upgrade", (request, socket) => {
  if (request.headers.authorization !== "Bearer gate-token") {
    log("ws: refused (no bearer header)");
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const accept = NodeCrypto.createHash("sha1")
    .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC085B11`)
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  log("ws: open (bearer ok)");
  let n = 0;
  const timer = setInterval(() => socket.write(frame(JSON.stringify({ tick: n++ }))), 1000);
  socket.on("close", () => {
    clearInterval(timer);
    log(`ws: closed after ${n} messages`);
  });
  socket.on("error", () => {});
});

server.listen(PORT, "127.0.0.1", () => log(`gate server on http://localhost:${PORT}`));
