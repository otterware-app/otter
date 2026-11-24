/** What the client asks of the app it runs in. Each app sets it once at startup, before it renders. */
export type Host = {
  /** This device's own key-value store. `set` can throw when the store is full or refused. */
  storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
  };
  /** Whether the app is in front, where the user is. */
  focused(): boolean;
  onFocusChange(listener: () => void): () => void;
  /** Hears the app about to go (a reload, a quit): the last moment to save. */
  onLeave(listener: () => void): () => void;
  /** Shows a notice in the app; returns a way to close it. */
  notice(notice: Notice): () => void;
  /** A kind of agent's mark, as SVG, for the notifications it sends. */
  agentMark(kind: string): string | undefined;
};

export type Notice = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  body?: string;
  /** Milliseconds it stays, 0 until it's closed; the app's own default without. */
  timeout?: number;
  action?: { label: string; run: () => void };
  /** It went, closed or timed out. */
  onGone?: () => void;
};

let current: Host | null = null;

export function setHost(next: Host): void {
  current = next;
}

export function host(): Host {
  if (!current) throw new Error("The app hasn't set @otter/client's host (setHost).");
  return current;
}
