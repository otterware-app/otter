import type { HybridObject } from "react-native-nitro-modules";

export interface HttpResponseHead {
  status: number;
  url: string;
  headers: Record<string, string>;
}

/**
 * One HTTP request on URLSession, its body delivered as it arrives (a data
 * task's delegate), so fetch can hand out `Response.body` as a stream.
 */
export interface HttpRequest extends HybridObject<{ ios: "swift" }> {
  start(
    url: string,
    method: string,
    headers: Record<string, string>,
    body: ArrayBuffer | undefined,
    followRedirects: boolean,
    onResponse: (head: HttpResponseHead) => void,
    onData: (chunk: ArrayBuffer) => void,
    onComplete: (error: string | undefined) => void,
  ): void;
  cancel(): void;
}

/** A URLSessionWebSocketTask, with request headers (the relay's bearer token). */
export interface WebSocketConnection extends HybridObject<{ ios: "swift" }> {
  open(
    url: string,
    protocols: string[],
    headers: Record<string, string>,
    onOpen: (subprotocol: string) => void,
    onText: (text: string) => void,
    onBinary: (data: ArrayBuffer) => void,
    onClose: (code: number, reason: string) => void,
    onError: (message: string) => void,
  ): void;
  sendText(text: string): void;
  sendBinary(data: ArrayBuffer): void;
  close(code: number, reason: string): void;
}
