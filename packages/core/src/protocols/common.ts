/**
 * What the IMAP and SMTP clients share: how they reach a server, how they log
 * in, and how they fail. Plain TypeScript over a ByteStream, so both run in
 * the Mac app's backend process and in the web app's worker alike.
 */

import type { MailServer } from "@otter-mail/contracts/mail";
import { toBase64, utf8Encode } from "../bytes.js";
import { platform, type ByteStream } from "../platform.js";

export type MailAuth = { user: string; pass: string } | { user: string; accessToken: string };

export type Connector = (host: string, port: number, opts: { tls: boolean }) => Promise<ByteStream>;

export interface ServerOptions extends Omit<MailServer, "security"> {
  security: MailServer["security"] | "none";
  auth: MailAuth;
  /** How long to wait for the server to say anything before giving up. */
  timeoutMs?: number;
  connect?: Connector;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

export type MailErrorKind = "auth" | "network" | "timeout" | "server" | "protocol";

export class MailProtocolError extends Error {
  constructor(
    message: string,
    readonly kind: MailErrorKind,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "MailProtocolError";
  }
}

export function openStream(options: ServerOptions): Promise<ByteStream> {
  const connect = options.connect ?? ((host, port, opts) => platform().connect(host, port, opts));
  return connect(options.host, options.port, { tls: options.security === "tls" }).catch(
    (err: unknown) => {
      throw new MailProtocolError(
        `Couldn't connect to ${options.host}:${options.port}: ${errorText(err)}`,
        "network",
        { cause: err },
      );
    },
  );
}

export async function readChunk(
  stream: ByteStream,
  timeoutMs: number | null,
  server: string,
): Promise<Uint8Array | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    if (timeoutMs === null) return;
    timer = setTimeout(() => {
      // Rejecting first wins the race against the read that closing ends.
      reject(new MailProtocolError(`${server} didn't answer in time.`, "timeout"));
      stream.close();
    }, timeoutMs);
  });
  try {
    return await Promise.race([stream.read(), timeout]);
  } catch (err) {
    if (err instanceof MailProtocolError) throw err;
    throw new MailProtocolError(`Lost the connection to ${server}: ${errorText(err)}`, "network", {
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function writeBytes(
  stream: ByteStream,
  data: Uint8Array | string,
  server: string,
): Promise<void> {
  try {
    await stream.write(typeof data === "string" ? utf8Encode(data) : data);
  } catch (err) {
    throw new MailProtocolError(`Lost the connection to ${server}: ${errorText(err)}`, "network", {
      cause: err,
    });
  }
}

/** SASL PLAIN (RFC 4616): no authorization identity, then user and password. */
export const saslPlain = (user: string, pass: string): string =>
  toBase64(utf8Encode(`\0${user}\0${pass}`));

export const saslXoauth2 = (user: string, accessToken: string): string =>
  toBase64(utf8Encode(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`));

export const errorText = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
