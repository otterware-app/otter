// The runtime runs in a window, a worker and the phone's JS runtime: only the
// globals all of them have, and no DOM.

declare function setTimeout(handler: () => void, timeout?: number): number;
declare function clearTimeout(id: number | undefined): void;
declare function queueMicrotask(callback: () => void): void;

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class URL {
  constructor(url: string, base?: string);
  static parse(url: string, base?: string): URL | null;
  readonly host: string;
  readonly hostname: string;
  readonly href: string;
  readonly pathname: string;
  readonly protocol: string;
}
