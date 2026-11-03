import { describe, expect, it } from "vite-plus/test";
import { utf8Decode, utf8Encode } from "../../bytes.ts";
import { FakeStream } from "../test/fake-stream.ts";
import { connectSmtp, encodeData, SmtpError, type SmtpOptions } from "./client.ts";

const options = (stream: FakeStream, extra: Partial<SmtpOptions> = {}): SmtpOptions => ({
  host: "smtp.example.com",
  port: 587,
  security: "starttls",
  auth: { user: "ann@example.com", pass: "secret" },
  connect: async () => stream,
  ...extra,
});

describe("encodeData", () => {
  const encode = (text: string) => utf8Decode(encodeData(utf8Encode(text)));

  it("normalises line ends and doubles leading dots", () => {
    expect(encode("a\nb\r\nc\rd")).toBe("a\r\nb\r\nc\r\nd\r\n.\r\n");
    expect(encode(".hidden\r\n..two\r\nmid.dot\r\n.")).toBe(
      "..hidden\r\n...two\r\nmid.dot\r\n..\r\n.\r\n",
    );
    expect(encode("ends\r\n")).toBe("ends\r\n.\r\n");
    expect(encode("")).toBe(".\r\n");
  });
});

describe("SmtpClient against a pretend server", () => {
  it("upgrades, logs in with LOGIN, and sends", async () => {
    const stream = new FakeStream("220 smtp.example.com ESMTP\r\n", (text, server) => {
      if (text.startsWith("EHLO")) {
        return server.tls
          ? "250-smtp.example.com\r\n250-SIZE 1000\r\n250-8BITMIME\r\n250 AUTH=LOGIN\r\n"
          : "250-smtp.example.com\r\n250 STARTTLS\r\n";
      }
      if (text.startsWith("STARTTLS")) return "220 Go ahead\r\n";
      if (text.startsWith("AUTH LOGIN")) return "334 VXNlcm5hbWU6\r\n";
      if (text === "YW5uQGV4YW1wbGUuY29t\r\n") return "334 UGFzc3dvcmQ6\r\n";
      if (text === "c2VjcmV0\r\n") return "235 2.7.0 Accepted\r\n";
      if (text.startsWith("MAIL FROM")) return "250 OK\r\n";
      if (text.startsWith("RCPT TO:<nobody")) return "550 5.1.1 No such user\r\n";
      if (text.startsWith("RCPT TO")) return "250 OK\r\n";
      if (text.startsWith("DATA")) return "354 Go\r\n";
      if (text.endsWith("\r\n.\r\n")) return "250 2.0.0 Queued as 12345\r\n";
      if (text.startsWith("QUIT")) return "221 Bye\r\n";
      return undefined;
    });
    const client = await connectSmtp(options(stream));
    expect(client.extensions.get("AUTH")).toBe("LOGIN");
    expect(client.extensions.get("SIZE")).toBe("1000");

    const result = await client.send(
      { from: "ann@example.com", to: ["bob@example.com"] },
      "Subject: Café\n\n.dot\n",
    );
    expect(result.accepted).toEqual(["bob@example.com"]);
    expect(result.response).toBe("2.0.0 Queued as 12345");
    expect(stream.written).toContain("MAIL FROM:<ann@example.com> SIZE=21 BODY=8BITMIME\r\n");
    expect(stream.written).toContain("Subject: Café\r\n\r\n..dot\r\n.\r\n");
    await client.quit();
    expect(stream.closed).toBe(true);
  });

  it("refuses the whole send when the server rejects any recipient, before the message", async () => {
    const stream = new FakeStream("220 hi\r\n", (text) => {
      if (text.startsWith("EHLO")) return "250-hi\r\n250 AUTH PLAIN\r\n";
      if (text.startsWith("AUTH")) return "235 ok\r\n";
      if (text.startsWith("RCPT TO:<nobody")) return "550 5.1.1 No such user\r\n";
      return "250 ok\r\n";
    });
    const client = await connectSmtp(options(stream, { security: "tls" }));
    const error = await client
      .send({ from: "a@x.com", to: ["b@x.com", "nobody@x.com"] }, "Subject: x\r\n\r\nhi")
      .catch((err: unknown) => err);
    expect(error).toMatchObject({
      message: "Couldn't send: nobody@x.com was rejected",
      code: 550,
      enhancedCode: "5.1.1",
      uncertain: false,
    });
    expect(stream.written).not.toContain("DATA\r\n");
    expect(stream.written.at(-1)).toBe("RSET\r\n");
  });

  it("waits longer for the answer to the message, and calls losing it uncertain", async () => {
    const stream = new FakeStream("220 hi\r\n", (text) => {
      if (text.startsWith("EHLO")) return "250-hi\r\n250 AUTH PLAIN\r\n";
      if (text.startsWith("AUTH")) return "235 ok\r\n";
      if (text.startsWith("DATA")) return "354 go\r\n";
      if (text.endsWith("\r\n.\r\n")) return undefined;
      return "250 ok\r\n";
    });
    const client = await connectSmtp(
      options(stream, { security: "tls", timeoutMs: 20, dataTimeoutMs: 200 }),
    );
    const started = Date.now();
    const error = await client
      .send({ from: "a@x.com", to: ["b@x.com"] }, "Subject: x\r\n\r\nhi")
      .catch((err: unknown) => err);
    expect(Date.now() - started).toBeGreaterThanOrEqual(150);
    expect(error).toBeInstanceOf(SmtpError);
    expect(error).toMatchObject({ kind: "timeout", uncertain: true });
  });

  it("isn't uncertain when the server refuses the message", async () => {
    const stream = new FakeStream("220 hi\r\n", (text) => {
      if (text.startsWith("EHLO")) return "250-hi\r\n250 AUTH PLAIN\r\n";
      if (text.startsWith("AUTH")) return "235 ok\r\n";
      if (text.startsWith("DATA")) return "354 go\r\n";
      if (text.endsWith("\r\n.\r\n")) return "554 5.7.1 Spam\r\n";
      return "250 ok\r\n";
    });
    const client = await connectSmtp(options(stream, { security: "tls" }));
    await expect(
      client.send({ from: "a@x.com", to: ["b@x.com"] }, "Subject: x\r\n\r\nhi"),
    ).rejects.toMatchObject({ code: 554, uncertain: false });
  });

  it("tells a refused login apart", async () => {
    const stream = new FakeStream("220 hi\r\n", (text) => {
      if (text.startsWith("EHLO")) return "250-hi\r\n250 AUTH PLAIN LOGIN\r\n";
      if (text.startsWith("AUTH PLAIN")) return "535 5.7.8 Bad credentials\r\n";
      return undefined;
    });
    const error = await connectSmtp(options(stream, { security: "tls" })).catch((err) => err);
    expect(error).toBeInstanceOf(SmtpError);
    expect(error).toMatchObject({ kind: "auth", code: 535, enhancedCode: "5.7.8" });
    expect((error as Error).message).not.toContain("AUTH PLAIN");
  });

  it("fails when no recipient is accepted, and resets", async () => {
    const stream = new FakeStream("220 hi\r\n", (text) => {
      if (text.startsWith("EHLO")) return "250-hi\r\n250 AUTH PLAIN\r\n";
      if (text.startsWith("AUTH")) return "235 ok\r\n";
      if (text.startsWith("RCPT")) return "550 no\r\n";
      return "250 ok\r\n";
    });
    const client = await connectSmtp(options(stream, { security: "tls" }));
    await expect(
      client.send({ from: "a@x.com", to: ["b@x.com"] }, "Subject: x\r\n\r\nhi"),
    ).rejects.toMatchObject({ kind: "server", code: 550 });
    expect(stream.written.at(-1)).toBe("RSET\r\n");
  });

  it("gives up on a reply line that never ends", async () => {
    const stream = new FakeStream("220 hi\r\n", (text, server) => {
      if (!text.startsWith("EHLO")) return undefined;
      for (let i = 0; i < 20; i++) server.send(`250-${"x".repeat(8192)}`);
      return undefined;
    });
    await expect(connectSmtp(options(stream, { security: "tls" }))).rejects.toMatchObject({
      kind: "protocol",
    });
    expect(stream.closed).toBe(true);
  });
});
