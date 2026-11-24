import { useCallback, useRef, useState } from "react";
import { useLatest } from "@otter/client/use-latest";

/** An element's width, kept current. */
export function useWidth(initial: number): [number, (el: HTMLElement | null) => void] {
  const [width, setWidth] = useState(initial);
  const ref = useObservedWidth(setWidth, initial);
  return [width, ref];
}

/** Calls `onWidth` with an element's width as it changes, without re-rendering for it:
 *  a panel sliding open resizes what's beside it on every frame. */
export function useObservedWidth(
  onWidth: (width: number) => void,
  initial: number,
): (el: HTMLElement | null) => void {
  const latest = useLatest(onWidth);
  const observer = useRef<ResizeObserver | null>(null);
  return useCallback(
    (el: HTMLElement | null) => {
      observer.current?.disconnect();
      observer.current = null;
      if (!el) return latest.current(initial);
      latest.current(el.getBoundingClientRect().width);
      const ro = new ResizeObserver(([entry]) => latest.current(entry.borderBoxSize[0].inlineSize));
      ro.observe(el);
      observer.current = ro;
    },
    [initial, latest],
  );
}
