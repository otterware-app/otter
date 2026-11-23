import { useLayoutEffect, useRef, useState } from "react";

/** Latest committed value for subscriptions and event handlers, never rendering. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

type Handler = (...args: any[]) => unknown;

/**
 * The handlers as functions that keep their identity and call the latest: passed down, they
 * let a child skip re-rendering when only its parent did (a pane toggling, say).
 */
export function useHandlers<T extends Record<string, Handler>>(handlers: T): T {
  const latest = useLatest(handlers);
  const [stable] = useState(() => {
    const out: Record<string, Handler> = {};
    for (const key of Object.keys(handlers)) out[key] = (...args) => latest.current[key]!(...args);
    return out as T;
  });
  return stable;
}
