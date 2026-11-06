import type { HybridObject } from "react-native-nitro-modules";

/**
 * A connection to a mail server, core's ByteStream: TLS from the first byte
 * over NWConnection, or plain over URLSessionStreamTask, upgraded in place by
 * `startTls`. `read` resolves undefined once the server has closed.
 */
export interface MailSocket extends HybridObject<{ ios: "swift" }> {
  connect(host: string, port: number, tls: boolean): Promise<void>;
  read(): Promise<ArrayBuffer | undefined>;
  write(data: ArrayBuffer): Promise<void>;
  startTls(): Promise<void>;
  close(): void;
}
