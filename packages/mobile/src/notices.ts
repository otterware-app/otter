import type { Notice } from "@otter/client/host";
import { useSyncExternalStore } from "react";

export type ShownNotice = Notice & { id: number; close(): void };

let shown: readonly ShownNotice[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function change(next: readonly ShownNotice[]): void {
  shown = next;
  for (const listener of listeners) listener();
}

/** Shows a notice until it times out or is closed (what @otter/client's host asks for). */
export function showNotice(notice: Notice): () => void {
  const id = nextId++;
  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    change(shown.filter((n) => n.id !== id));
    notice.onGone?.();
  };
  const timer = notice.timeout === 0 ? undefined : setTimeout(close, notice.timeout ?? 5000);
  change([...shown, { ...notice, id, close }]);
  return close;
}

/** The notices showing now, for the app to draw. */
export function useNotices(): readonly ShownNotice[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
  );
}
