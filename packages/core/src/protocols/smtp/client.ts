import { toBase64, utf8Decode, utf8Encode } from "../../bytes.js";
import type { ByteStream } from "../../platform.js";
import {
  DEFAULT_TIMEOUT_MS,
  errorText,
  MailProtocolError,
  openStream,
  readChunk,
  saslPlain,
  saslXoauth2,
  writeBytes,
  type MailErrorKind,
  type ServerOptions,
} from "../common.js";

export interface SmtpOptions extends ServerOptions {
  clientName?: string;
  /** How long to wait for the answer to a message: RFC 5321's 10 minutes. */
  dataTimeoutMs?: number;
}

const DATA_TIMEOUT_MS = 10 * 60_000;

export class SmtpError extends MailProtocolError {
  readonly code?: number;
  /** RFC 3463's status, when the server gives one: "5.7.8". */
  readonly enhancedCode?: string;
  readonly serverText?: string;
  /** Lost after the whole message went: the server may have taken it. */
  readonly uncertain: boolean;

  constructor(
    message: string,
    kind: MailErrorKind,
    details: { reply?: SmtpReply; cause?: unknown; uncertain?: boolean } = {},
  ) {
    super(message, kind, { cause: details.cause });
    this.name = "SmtpError";
    this.uncertain = details.uncertain ?? false;
    this.code = details.reply?.code;
    this.enhancedCode = details.reply?.text.match(/^([245]\.\d{1,3}\.\d{1,3})\b/)?.[1];
    this.serverText = details.reply?.text;
  }
}

export interface SmtpReply {
  code: number;
  text: string;
}

export interface SmtpEnvelope {
  from: string;
  to: string[];
}

export interface SmtpSendResult {
  accepted: string[];
  response: string;
}

export async function connectSmtp(options: SmtpOptions): Promise<SmtpClient> {
  let stream: ByteStream;
  try {
    stream = await openStream(options);
  } catch (err) {
    throw asSmtpError(err);
  }
  const client = new SmtpClient(stream, options);
  try {
    await client.start();
  } catch (err) {
    client.close();
    throw err;
  }
  return client;
}

export async function sendMail(
  options: SmtpOptions,
  envelope: SmtpEnvelope,
  message: Uint8Array | string,
): Promise<SmtpSendResult> {
  const client = await connectSmtp(options);
  try {
    return await client.send(envelope, message);
  } finally {
    await client.quit();
  }
}

/** Replies are short (RFC 5321 allows 512 bytes a line): anything far beyond is a broken server. */
const MAX_LINE = 64 * 1024;
const MAX_REPLY_LINES = 1000;

export class SmtpClient {
  /** EHLO's extensions, upper-cased names: "SIZE" → "35882577", "AUTH" → "PLAIN LOGIN". */
  readonly extensions = new Map<string, string>();

  private buffer = new Uint8Array(0);
  private readonly timeoutMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly stream: ByteStream,
    private readonly options: SmtpOptions,
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async start(): Promise<void> {
    await this.expect(await this.reply(), [220], "Connecting");
    await this.hello();
    if (this.options.security === "starttls") {
      if (!this.extensions.has("STARTTLS")) {
        throw new SmtpError(`${this.options.host} doesn't offer STARTTLS.`, "protocol");
      }
      await this.command("STARTTLS", [220]);
      if (this.buffer.length > 0) {
        throw new SmtpError(`${this.options.host} sent data before TLS.`, "protocol");
      }
      try {
        await this.stream.startTls();
      } catch (err) {
        throw new SmtpError(`TLS with ${this.options.host} failed: ${errorText(err)}`, "network", {
          cause: err,
        });
      }
      await this.hello();
    }
    await this.login();
  }

  private async hello(): Promise<void> {
    const name = this.options.clientName ?? "[127.0.0.1]";
    await this.write(`EHLO ${name}\r\n`);
    let reply = await this.reply();
    if (reply.code >= 500) reply = await this.command(`HELO ${name}`, [250]);
    else await this.expect(reply, [250], "EHLO");
    this.extensions.clear();
    for (const line of reply.text.split("\n").slice(1)) {
      const [keyword = "", ...rest] = line.trim().split(/\s+/);
      const [extension = "", value] = keyword.split("=", 2);
      this.extensions.set(extension.toUpperCase(), [value, ...rest].filter(Boolean).join(" "));
    }
  }

  private async login(): Promise<void> {
    const { auth } = this.options;
    const mechanisms = new Set((this.extensions.get("AUTH") ?? "").toUpperCase().split(/\s+/));
    const kind: MailErrorKind = "auth";
    if ("accessToken" in auth) {
      const initial = saslXoauth2(auth.user, auth.accessToken);
      const reply = await this.command(`AUTH XOAUTH2 ${initial}`, [235, 334], kind);
      if (reply.code === 334) await this.command("", [235], kind);
    } else if (mechanisms.has("PLAIN")) {
      await this.command(`AUTH PLAIN ${saslPlain(auth.user, auth.pass)}`, [235], kind);
    } else if (mechanisms.has("LOGIN")) {
      await this.command("AUTH LOGIN", [334], kind);
      await this.command(toBase64(utf8Encode(auth.user)), [334], kind);
      await this.command(toBase64(utf8Encode(auth.pass)), [235], kind);
    } else {
      throw new SmtpError(`${this.options.host} doesn't offer a way to log in.`, "auth");
    }
  }

  send(envelope: SmtpEnvelope, message: Uint8Array | string): Promise<SmtpSendResult> {
    const run = this.queue.then(() => this.transaction(envelope, message));
    this.queue = run.catch(() => {});
    return run;
  }

  private async transaction(
    envelope: SmtpEnvelope,
    message: Uint8Array | string,
  ): Promise<SmtpSendResult> {
    const raw = typeof message === "string" ? utf8Encode(message) : message;
    const international = [envelope.from, ...envelope.to].some((address) =>
      /[^\p{ASCII}]/u.test(address),
    );
    if (international && !this.extensions.has("SMTPUTF8")) {
      throw new SmtpError(
        `${this.options.host} can't send to or from international addresses.`,
        "server",
      );
    }
    const limit = Number(this.extensions.get("SIZE") ?? 0);
    if (limit > 0 && raw.length > limit) {
      throw new SmtpError(`The message is larger than ${this.options.host} accepts.`, "server");
    }
    const params: string[] = [];
    if (this.extensions.has("SIZE")) params.push(`SIZE=${raw.length}`);
    if (this.extensions.has("8BITMIME") && raw.some((byte) => byte > 0x7f))
      params.push("BODY=8BITMIME");
    if (international) params.push("SMTPUTF8");

    try {
      await this.command(
        `MAIL FROM:<${envelope.from}>${params.map((p) => ` ${p}`).join("")}`,
        [250],
      );
      if (envelope.to.length === 0) {
        throw new SmtpError("The message has no recipients.", "protocol");
      }
      for (const address of envelope.to) {
        try {
          await this.command(`RCPT TO:<${address}>`, [250, 251]);
        } catch (err) {
          if (!(err instanceof SmtpError) || err.code === undefined) throw err;
          throw new SmtpError(`Couldn't send: ${address} was rejected`, "server", {
            reply: { code: err.code, text: err.serverText ?? "" },
          });
        }
      }
      await this.command("DATA", [354]);
      await this.write(encodeData(raw));
      let answer: SmtpReply;
      try {
        answer = await this.reply(this.options.dataTimeoutMs ?? DATA_TIMEOUT_MS);
      } catch (err) {
        const lost = asSmtpError(err);
        throw new SmtpError(lost.message, lost.kind, { cause: lost, uncertain: true });
      }
      const reply = await this.expect(answer, [250], "Sending");
      return { accepted: envelope.to, response: reply.text };
    } catch (err) {
      if (!this.closed) await this.command("RSET", [250]).catch(() => {});
      throw err;
    }
  }

  async quit(): Promise<void> {
    if (this.closed) return;
    await this.queue;
    try {
      await this.command("QUIT", [221]);
    } catch {
      // Closing anyway.
    } finally {
      this.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stream.close();
  }

  private async command(
    line: string,
    expected: number[],
    kind: MailErrorKind = "server",
  ): Promise<SmtpReply> {
    await this.write(`${line}\r\n`);
    // Never echo credentials into an error.
    const name = /^AUTH\b/i.test(line) || kind === "auth" ? "Logging in" : line.split(/[\s:]/)[0]!;
    return this.expect(await this.reply(), expected, name, kind);
  }

  private async expect(
    reply: SmtpReply,
    expected: number[],
    name: string,
    kind: MailErrorKind = "server",
  ): Promise<SmtpReply> {
    if (expected.includes(reply.code)) return reply;
    const errorKind = kind === "auth" && reply.code < 500 ? "server" : kind;
    throw new SmtpError(`${name} failed: ${reply.code} ${reply.text}`, errorKind, { reply });
  }

  private async reply(timeoutMs = this.timeoutMs): Promise<SmtpReply> {
    const lines: string[] = [];
    for (;;) {
      const line = await this.readLine(timeoutMs);
      if (lines.length >= MAX_REPLY_LINES) {
        this.close();
        throw new SmtpError(`${this.options.host} sent a reply that never ends.`, "protocol");
      }
      const match = /^(\d{3})([ -]?)(.*)$/.exec(line);
      if (!match) {
        this.close();
        throw new SmtpError(`${this.options.host} sent something unexpected: ${line}`, "protocol");
      }
      lines.push(match[3]!);
      if (match[2] !== "-") return { code: Number(match[1]), text: lines.join("\n") };
    }
  }

  private async readLine(timeoutMs: number): Promise<string> {
    for (;;) {
      const lf = this.buffer.indexOf(10);
      if (lf >= 0) {
        const line = utf8Decode(this.buffer.subarray(0, lf)).replace(/\r$/, "");
        this.buffer = this.buffer.slice(lf + 1);
        return line;
      }
      if (this.buffer.length > MAX_LINE) {
        this.close();
        throw new SmtpError(`${this.options.host} sent a line that never ends.`, "protocol");
      }
      let chunk: Uint8Array | null;
      try {
        chunk = await readChunk(this.stream, timeoutMs, this.options.host);
      } catch (err) {
        this.close();
        throw asSmtpError(err);
      }
      if (!chunk) {
        this.close();
        throw new SmtpError(`${this.options.host} closed the connection.`, "network");
      }
      const joined = new Uint8Array(this.buffer.length + chunk.length);
      joined.set(this.buffer);
      joined.set(chunk, this.buffer.length);
      this.buffer = joined;
    }
  }

  private async write(data: string | Uint8Array): Promise<void> {
    if (this.closed)
      throw new SmtpError(`The connection to ${this.options.host} is closed.`, "network");
    try {
      await writeBytes(this.stream, data, this.options.host);
    } catch (err) {
      this.close();
      throw asSmtpError(err);
    }
  }
}

export function encodeData(message: Uint8Array): Uint8Array {
  const size = stuff(message, null);
  const out = new Uint8Array(size);
  stuff(message, out);
  return out;
}

/** Writes into `out` (or only counts, without one); returns the length. */
function stuff(message: Uint8Array, out: Uint8Array | null): number {
  let n = 0;
  const emit = (byte: number) => {
    if (out) out[n] = byte;
    n++;
  };
  let lineStart = true;
  for (let i = 0; i < message.length; i++) {
    const byte = message[i]!;
    if (byte === 13 || byte === 10) {
      if (byte === 13 && message[i + 1] === 10) i++;
      emit(13);
      emit(10);
      lineStart = true;
      continue;
    }
    if (lineStart && byte === 46) emit(46);
    emit(byte);
    lineStart = false;
  }
  if (!lineStart) {
    emit(13);
    emit(10);
  }
  emit(46);
  emit(13);
  emit(10);
  return n;
}

function asSmtpError(err: unknown): SmtpError {
  if (err instanceof SmtpError) return err;
  if (err instanceof MailProtocolError) return new SmtpError(err.message, err.kind, { cause: err });
  return new SmtpError(errorText(err), "network", { cause: err });
}
