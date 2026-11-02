/**
 * TLS for the web app's mail connections, negotiated in the worker so the
 * relay's tunnel only ever carries ciphertext: subtls (TLS 1.3 on WebCrypto),
 * checking the server's chain against Mozilla's roots and its name against
 * the host. mail-socket.ts loads this on the first IMAP/SMTP connection.
 */

import { LazyReadFunctionReadQueue, startTls, TrustedCert, type RootCertsDatabase } from "subtls";

import rootsPem from "./roots.pem?raw";

const devRoots: string = (import.meta.env.DEV && import.meta.env.VITE_DEV_MAIL_CA) || "";

let roots: Promise<RootCertsDatabase> | undefined;

export type TlsStream = {
  read(): Promise<Uint8Array | undefined>;
  write(data: Uint8Array): Promise<void>;
};

export async function negotiateTls(
  host: string,
  read: () => Promise<Uint8Array | null>,
  write: (data: Uint8Array) => void,
): Promise<TlsStream> {
  roots ??= TrustedCert.databaseFromPEM(`${rootsPem}\n${devRoots}`);
  const queue = new LazyReadFunctionReadQueue(async () => (await read()) ?? undefined);
  try {
    return await startTls(host.toLowerCase(), await roots, queue.read.bind(queue), write);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/alert|No TLS version|Expected 771/.test(message)) {
      throw new Error(
        `${host} doesn't offer TLS 1.3, which the web app needs. The Mac app can connect to it.`,
        { cause: err },
      );
    }
    if (/certificate|subjectAltName|root/i.test(message)) {
      throw new Error(`${host}'s certificate isn't trusted: ${message}`, { cause: err });
    }
    throw new Error(`Couldn't secure the connection to ${host}: ${message}`, { cause: err });
  }
}
