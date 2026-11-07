import { createHttpRequest, createWebSocketConnection } from "@otter-mail/mobile-net";

/**
 * fetch and WebSocket on the worker, over URLSession (otter-net). fetch's
 * Response streams its body as it arrives (`response.body`, a
 * ReadableStream) for agent SSE; the WebSocket takes request headers the way
 * Node's does (`new WebSocket(url, { headers })`), which the relay's bearer
 * sign-in uses. Headers/Request/Response are whatwg-fetch's.
 */

type Listener = (event: { type: string; [key: string]: unknown }) => void;

class Emitter {
  private listeners = new Map<string, Set<Listener>>();
  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(listener);
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }
  protected emit(type: string, extra: Record<string, unknown> = {}): void {
    const event = { type, target: this, ...extra };
    const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
    if (typeof handler === "function") handler.call(this, event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function bodyBytes(body: unknown): Promise<ArrayBuffer | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body).buffer as ArrayBuffer;
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
  }
  if (body instanceof URLSearchParams)
    return new TextEncoder().encode(body.toString()).buffer as ArrayBuffer;
  if (typeof (body as Blob).arrayBuffer === "function") return (body as Blob).arrayBuffer();
  throw new TypeError("This fetch body type isn't supported.");
}

function headersRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => (out[name] = value));
  return out;
}

export async function otterFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const request = input instanceof Request ? input : null;
  const url = request ? request.url : String(input);
  const method = (init.method ?? request?.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? request?.headers);
  let body = init.body ?? undefined;
  if (body === undefined && request && method !== "GET" && method !== "HEAD")
    body = await request.arrayBuffer();
  if (typeof body === "string" && !headers.has("content-type")) {
    headers.set("content-type", "text/plain;charset=UTF-8");
  }
  if (body instanceof URLSearchParams && !headers.has("content-type")) {
    headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8");
  }
  const bytes = await bodyBytes(body);
  const signal = init.signal ?? request?.signal ?? null;
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");

  const native = createHttpRequest();
  return new Promise<Response>((resolve, reject) => {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const early: Uint8Array[] = [];
    let ended = false;
    let failure: Error | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        for (const chunk of early) c.enqueue(chunk);
        early.length = 0;
        if (failure) c.error(failure);
        else if (ended) c.close();
      },
      cancel() {
        native.cancel();
      },
    });
    const onAbort = () => {
      native.cancel();
      const reason = signal?.reason ?? new DOMException("Aborted", "AbortError");
      failure = reason;
      reject(reason);
      try {
        controller?.error(reason);
      } catch {
        // already closed
      }
    };
    signal?.addEventListener("abort", onAbort);

    native.start(
      url,
      method,
      headersRecord(headers),
      bytes,
      (init.redirect ?? request?.redirect) !== "manual",
      (init.credentials ?? request?.credentials) === "include",
      (head) => {
        const nullBody = head.status === 204 || head.status === 304 || method === "HEAD";
        const response = new Response(null, {
          status: head.status < 200 ? 200 : head.status,
          headers: head.headers,
        });
        Object.defineProperty(response, "url", { value: head.url });
        Object.defineProperty(response, "body", { value: nullBody ? null : stream });
        const collect = async (): Promise<Uint8Array> => {
          if (nullBody) return new Uint8Array(0);
          const reader = stream.getReader();
          const chunks: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) return concat(chunks);
            chunks.push(value);
          }
        };
        Object.assign(response, {
          arrayBuffer: async () => (await collect()).buffer,
          bytes: collect,
          text: async () => new TextDecoder().decode(await collect()),
          json: async () => JSON.parse(new TextDecoder().decode(await collect())),
          blob: async () =>
            new Blob([(await collect()) as Uint8Array<ArrayBuffer>], {
              type: head.headers["content-type"] ?? "",
            }),
        });
        resolve(response);
      },
      (chunk) => {
        const bytes = new Uint8Array(chunk);
        if (controller) controller.enqueue(bytes);
        else early.push(bytes);
      },
      (error) => {
        signal?.removeEventListener("abort", onAbort);
        if (error) {
          failure = new TypeError(`Network request failed: ${error}`);
          reject(failure);
          try {
            controller?.error(failure);
          } catch {
            // already closed
          }
        } else {
          ended = true;
          try {
            controller?.close();
          } catch {
            // already closed
          }
        }
      },
    );
  });
}

export class OtterWebSocket extends Emitter {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = 0;
  protocol = "";
  binaryType: "arraybuffer" | "blob" = "arraybuffer";
  readonly url: string;
  private native = createWebSocketConnection();

  constructor(
    url: string | URL,
    options?: string | string[] | { headers?: Record<string, string>; protocols?: string[] },
  ) {
    super();
    this.url = String(url);
    const protocols =
      typeof options === "string"
        ? [options]
        : Array.isArray(options)
          ? options
          : (options?.protocols ?? []);
    const headers =
      options && !Array.isArray(options) && typeof options === "object"
        ? (options.headers ?? {})
        : {};
    this.native.open(
      this.url,
      protocols,
      headers,
      (protocol) => {
        this.readyState = 1;
        this.protocol = protocol;
        this.emit("open");
      },
      (text) => this.emit("message", { data: text }),
      (data) => this.emit("message", { data }),
      (code, reason) => {
        if (this.readyState === 3) return;
        this.readyState = 3;
        this.emit("close", { code, reason, wasClean: code === 1000 });
      },
      (message) => this.emit("error", { message }),
    );
  }

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== 1) throw new Error("WebSocket is not open.");
    if (typeof data === "string") this.native.sendText(data);
    else if (data instanceof ArrayBuffer) this.native.sendBinary(data);
    else
      this.native.sendBinary(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      );
  }

  close(code = 1000, reason = ""): void {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.native.close(code, reason);
  }
}
