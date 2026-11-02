import type { AddressInfo } from "node:net";
import * as tls from "node:tls";
import { describe, expect, it } from "vite-plus/test";
import type { ByteStream } from "@otter-mail/core";

import { connectMailSocket } from "./mail-socket.ts";

async function readUntil(stream: ByteStream, pattern: RegExp): Promise<string> {
  let text = "";
  while (!pattern.test(text)) {
    const chunk = await stream.read();
    if (!chunk) throw new Error(`closed after ${JSON.stringify(text)}`);
    text += new TextDecoder().decode(chunk);
  }
  return text;
}

const send = (stream: ByteStream, line: string) =>
  stream.write(new TextEncoder().encode(`${line}\r\n`));

it("explains a refused connection", async () => {
  await expect(connectMailSocket("127.0.0.1", 1, { tls: false })).rejects.toThrow(
    "refused the connection",
  );
});

describe.runIf(process.env.NETWORK_TESTS)("real servers", () => {
  it.each(["imap.gmail.com", "imap.fastmail.com", "imap.mail.me.com"])(
    "reads %s's greeting over TLS",
    async (host) => {
      const stream = await connectMailSocket(host, 993, { tls: true });
      expect(await readUntil(stream, /\r\n/)).toMatch(/^\* OK/);
      stream.close();
    },
  );

  it("upgrades with STARTTLS", async () => {
    const stream = await connectMailSocket("imap.gmx.net", 143, { tls: false });
    expect(await readUntil(stream, /\r\n/)).toMatch(/^\* OK/);
    await send(stream, "a STARTTLS");
    expect(await readUntil(stream, /^a /m)).toMatch(/^a OK/m);
    await stream.startTls();
    await send(stream, "b CAPABILITY");
    expect(await readUntil(stream, /^b /m)).toMatch(/AUTH=PLAIN[\s\S]*^b OK/m);
    stream.close();
  });
});

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

it("refuses a certificate no one vouches for", async () => {
  const server = tls.createServer({ key: SELF_SIGNED, cert: SELF_SIGNED }, (socket) =>
    socket.end("* OK Not really Gmail\r\n"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await expect(connectMailSocket("127.0.0.1", port, { tls: true })).rejects.toThrow(
      "127.0.0.1's certificate isn't trusted",
    );
  } finally {
    server.close();
  }
});
