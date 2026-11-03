import type { ByteStream } from "../../platform.ts";

export class FakeStream implements ByteStream {
  written: string[] = [];
  tls = false;
  closed = false;
  private chunks: Uint8Array[] = [];
  private waiting: ((chunk: Uint8Array | null) => void)[] = [];

  constructor(
    greeting: string,
    private reply: (written: string, stream: FakeStream) => string | undefined,
  ) {
    this.send(greeting);
  }

  send(text: string | Uint8Array, chunkSize = Infinity): void {
    const bytes = typeof text === "string" ? new TextEncoder().encode(text) : text;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      const waiter = this.waiting.shift();
      if (waiter) waiter(chunk);
      else this.chunks.push(chunk);
    }
  }

  read(): Promise<Uint8Array | null> {
    const chunk = this.chunks.shift();
    if (chunk) return Promise.resolve(chunk);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  async write(data: Uint8Array): Promise<void> {
    const text = new TextDecoder().decode(data);
    this.written.push(text);
    const answer = this.reply(text, this);
    if (answer) this.send(answer);
  }

  async startTls(): Promise<void> {
    this.tls = true;
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiting.splice(0)) waiter(null);
  }
}

export const tagOf = (line: string): string => line.split(" ")[0]!;
