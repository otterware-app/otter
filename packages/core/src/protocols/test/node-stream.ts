import net from "node:net";
import tls from "node:tls";
import type { ByteStream } from "../../platform.ts";

export async function nodeConnect(
  host: string,
  port: number,
  opts: { tls: boolean },
): Promise<ByteStream> {
  const socket = opts.tls
    ? tls.connect({ host, port, rejectUnauthorized: false })
    : net.connect({ host, port });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once(opts.tls ? "secureConnect" : "connect", resolve);
      socket.on("error", reject);
    });
  } catch (err) {
    socket.destroy();
    throw err;
  }
  return new NodeStream(socket);
}

class NodeStream implements ByteStream {
  private chunks: Uint8Array[] = [];
  private waiting: { resolve: (chunk: Uint8Array | null) => void; reject: (err: Error) => void }[] =
    [];
  private ended = false;
  private failure: Error | null = null;
  private detach: () => void = () => {};

  constructor(private socket: net.Socket) {
    this.attach(socket);
  }

  private attach(socket: net.Socket): void {
    const onData = (data: Buffer) => {
      const chunk = new Uint8Array(data);
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve(chunk);
      else this.chunks.push(chunk);
    };
    const onEnd = () => this.finish(null);
    const onError = (err: Error) => this.finish(err);
    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("close", onEnd);
    socket.on("error", onError);
    this.detach = () => {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("close", onEnd);
      socket.off("error", onError);
    };
  }

  private finish(err: Error | null): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = err;
    for (const waiter of this.waiting.splice(0)) {
      if (err) waiter.reject(err);
      else waiter.resolve(null);
    }
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.chunks.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.failure) return Promise.reject(this.failure);
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  async startTls(): Promise<void> {
    this.detach();
    const secure = tls.connect({ socket: this.socket, rejectUnauthorized: false });
    await new Promise<void>((resolve, reject) => {
      secure.once("secureConnect", resolve);
      secure.once("error", reject);
    });
    this.socket = secure;
    this.attach(secure);
  }

  close(): void {
    this.socket.destroy();
    this.finish(null);
  }
}
