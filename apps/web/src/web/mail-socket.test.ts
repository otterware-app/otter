import * as net from "node:net";
import * as tls from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { WebSocketServer } from "ws";
import type { ByteStream } from "@otter-mail/core";
import { TUNNEL_CLOSE } from "@otter-mail/contracts/relay";

import { connectMailSocket } from "./mail-socket";

const route = new Map<string, { host: string; port: number }>();
let relay: WebSocketServer;
let relayUrl = "";

beforeAll(async () => {
  relay = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  relay.on("connection", (ws, req) => {
    const query = new URL(req.url!, "http://relay").searchParams;
    const host = query.get("host")!;
    if (host === "busy.example") return ws.close(TUNNEL_CLOSE.rateLimited, "");
    const target = route.get(host) ?? { host, port: Number(query.get("port")) };
    const socket = net.connect(target);
    socket.on("connect", () => ws.send("open"));
    socket.on("data", (data) => ws.send(data));
    socket.on("error", (err) => ws.close(TUNNEL_CLOSE.connectFailed, err.message));
    socket.on("close", () => ws.close(1000));
    ws.on("message", (data) => socket.write(data as Buffer));
    ws.on("close", () => socket.destroy());
  });
  await new Promise((resolve) => relay.once("listening", resolve));
  relayUrl = `http://127.0.0.1:${(relay.address() as net.AddressInfo).port}`;
});
afterAll(() => relay.close());

async function readLine(stream: ByteStream): Promise<string> {
  let text = "";
  while (!text.includes("\r\n")) {
    const chunk = await stream.read();
    if (!chunk) throw new Error(`closed after ${JSON.stringify(text)}`);
    text += new TextDecoder().decode(chunk);
  }
  return text;
}

const SELF_SIGNED = `
-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgO9/hPhhMdplAPVO7
ryVzbgj0nNL1en54dEUnmxwFITahRANCAATZu43/bbUMkwD1GkyMK+6qlLhxSNul
gTHFN8ULAqHE95lfKa+PRSz7vOBaGRJ2PR/YzvPgRbD/qKnK383Gwk2w
-----END PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIBezCCASGgAwIBAgIJANLC37ZAFKHDMAoGCCqGSM49BAMCMBkxFzAVBgNVBAMM
DmltYXAuZ21haWwuY29tMCAXDTI2MDkyOTA5MDIwOVoYDzIxMjYwOTA1MDkwMjA5
WjAZMRcwFQYDVQQDDA5pbWFwLmdtYWlsLmNvbTBZMBMGByqGSM49AgEGCCqGSM49
AwEHA0IABNm7jf9ttQyTAPUaTIwr7qqUuHFI26WBMcU3xQsCocT3mV8pr49FLPu8
4FoZEnY9H9jO8+BFsP+oqcrfzcbCTbCjUDBOMBkGA1UdEQQSMBCCDmltYXAuZ21h
aWwuY29tMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/BAQDAgeAMBMGA1UdJQQMMAoG
CCsGAQUFBwMBMAoGCCqGSM49BAMCA0gAMEUCIBT8FzsewXA5+gnPV+suEjQCKo8f
ozY9xK/+D7DzeBrZAiEAu6+dMuNs4T7sm08BhsTLjIdODn7VLCB3WZpENwad7m4=
-----END CERTIFICATE-----
`;

it("explains a server it couldn't reach", async () => {
  await expect(connectMailSocket(relayUrl, "127.0.0.1", 1, { tls: false })).rejects.toThrow(
    "Couldn't connect to 127.0.0.1 on port 1",
  );
});

it("refuses a relay that answers with its own certificate", async () => {
  const server = tls.createServer(
    { key: SELF_SIGNED, cert: SELF_SIGNED, minVersion: "TLSv1.3" },
    (socket) => socket.end("* OK Not really Gmail\r\n"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  route.set("imap.gmail.com", {
    host: "127.0.0.1",
    port: (server.address() as net.AddressInfo).port,
  });
  try {
    await expect(connectMailSocket(relayUrl, "imap.gmail.com", 993, { tls: true })).rejects.toThrow(
      "imap.gmail.com's certificate isn't trusted",
    );
  } finally {
    route.delete("imap.gmail.com");
    server.close();
  }
});

it("says when the relay turns a connection away", async () => {
  await expect(connectMailSocket(relayUrl, "busy.example", 993, { tls: false })).rejects.toThrow(
    "Too many connections",
  );
});

it("drops a connection whose server sends far more than is read", async () => {
  const server = net.createServer((socket) => {
    socket.on("error", () => {});
    socket.end(Buffer.alloc(70 * 1024 * 1024));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  route.set("flood.example", {
    host: "127.0.0.1",
    port: (server.address() as net.AddressInfo).port,
  });
  try {
    const stream = await connectMailSocket(relayUrl, "flood.example", 993, { tls: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(stream.read()).rejects.toThrow("more than we could keep up with");
  } finally {
    route.delete("flood.example");
    server.close();
  }
});

describe.runIf(process.env.NETWORK_TESTS)("real servers", () => {
  it.each(["imap.gmail.com", "imap.mail.me.com", "imap.fastmail.com", "imap.gmx.net"])(
    "reads %s's greeting over TLS 1.3",
    async (host) => {
      const stream = await connectMailSocket(relayUrl, host, 993, { tls: true });
      expect(await readLine(stream)).toMatch(/^\* OK/);
      stream.close();
    },
  );

  it("upgrades with STARTTLS", async () => {
    const stream = await connectMailSocket(relayUrl, "imap.gmx.net", 143, { tls: false });
    const send = (line: string) => stream.write(new TextEncoder().encode(`${line}\r\n`));
    expect(await readLine(stream)).toMatch(/^\* OK/);
    await send("a STARTTLS");
    expect(await readLine(stream)).toMatch(/^a OK/);
    await stream.startTls();
    await send("b CAPABILITY");
    expect(await readLine(stream)).toMatch(/^\* CAPABILITY .*AUTH=PLAIN/);
    stream.close();
  });

  it("refuses a real certificate for another host", async () => {
    route.set("imap.fastmail.com", { host: "imap.gmail.com", port: 993 });
    try {
      await expect(
        connectMailSocket(relayUrl, "imap.fastmail.com", 993, { tls: true }),
      ).rejects.toThrow("imap.fastmail.com's certificate isn't trusted");
    } finally {
      route.delete("imap.fastmail.com");
    }
  });

  it.each(["imap.mail.ru:993", "ssl0.ovh.net:465"])(
    "explains that %s has no TLS 1.3",
    async (server) => {
      const [host, port] = server.split(":");
      await expect(connectMailSocket(relayUrl, host!, Number(port), { tls: true })).rejects.toThrow(
        "doesn't offer TLS 1.3",
      );
    },
  );
});
