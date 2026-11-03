import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { useLatest } from "../use-latest";
import { usePanelAnimationDurationMs } from "../panel-animations";
import { movePanelTab, orderedPanelTabs, tabDragTarget } from "./panel-tabs";

type Drag = {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
  grab: number;
  width: number;
  original: string[];
  active: boolean;
  /** Off the strip, carrying a window (what it was torn off with). */
  torn: TabTearOff | null;
  /** Torn off as the strip's only tab, carrying its own window. */
  whole: boolean;
};

/** How far off the strip a tab comes loose. */
const TEAR_DISTANCE = 32;

/**
 * Tearing tabs off a strip into windows: `start` when one comes loose,
 * `move` as the pointer moves after, `drop` when it's let go, and `back` when
 * it's brought back over the strip first (to be dragged on there).
 * With `whole` (the strip's only tab) it's loose from the first move, carrying
 * the window itself, and never comes back.
 */
export type TabTearOff = {
  /** Asked as it comes loose, not when the drag began (the strip may have changed since). */
  whole: () => boolean;
  /** `grab`: where the pointer holds the window it carries, from its top-left. */
  start: (id: string, grab: { x: number; y: number }) => void;
  move: () => void;
  drop: () => void;
  back: (id: string) => void;
};

/**
 * Drags a strip's tabs to reorder them. With `tearOff`, a tab pulled well off
 * the strip comes loose (for a window of its own), and brought back over the
 * strip before it's let go, rejoins it.
 */
export function usePanelTabDrag(onReorder: (order: string[]) => void, tearOff?: TabTearOff) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const frame = useRef<number | null>(null);
  const before = useRef<Map<string, number> | null>(null);
  const animations = useRef(new Map<HTMLElement, Animation>());
  const suppressClick = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const duration = usePanelAnimationDurationMs();
  const reorder = useLatest(onReorder);
  const tearer = useLatest(tearOff);

  const elements = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-panel-tab-id]") ?? []);
  const positions = () =>
    new Map(elements().map((tab) => [tab.dataset.panelTabId!, tab.getBoundingClientRect().left]));
  const animate = (tab: HTMLElement, from: number) => {
    if (!from || !duration || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    animations.current.set(
      tab,
      tab.animate([{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }], {
        duration,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      }),
    );
  };

  const placeDragged = () => {
    const strip = ref.current;
    const current = drag.current;
    if (!strip || !current?.active || current.torn) return null;
    const tabs = elements();
    const tab = tabs.find((tab) => tab.dataset.panelTabId === current.id);
    if (!tab || !tabs.length) return null;
    const bounds = strip.getBoundingClientRect();
    const last = tabs[tabs.length - 1];
    const pointerLeft = current.clientX - bounds.left + strip.scrollLeft - current.grab;
    const left = Math.max(
      tabs[0].offsetLeft,
      Math.min(last.offsetLeft + last.offsetWidth - current.width, pointerLeft),
    );
    tab.style.transform = `translateX(${left - tab.offsetLeft}px)`;
    // End slots must remain reachable even while the tab is kept inside the
    // strip, including when it is wider than the end tab it crosses.
    return { tabs, center: pointerLeft + current.width / 2 };
  };

  // FLIP from the current painted positions so another crossing can interrupt
  // an in-flight animation smoothly. The dragged tab itself never lags behind.
  useLayoutEffect(() => {
    const previous = before.current;
    before.current = null;
    if (previous) {
      for (const tab of elements()) {
        const id = tab.dataset.panelTabId!;
        animations.current.get(tab)?.cancel();
        if (id === drag.current?.id) continue;
        const left = previous.get(id);
        if (left !== undefined) animate(tab, left - tab.getBoundingClientRect().left);
      }
    }
    placeDragged();
  });

  const move = () => {
    const strip = ref.current;
    const current = drag.current;
    if (!strip || !current?.active) return;
    const bounds = strip.getBoundingClientRect();
    if (current.torn) {
      if (current.whole) return;
      // Back over the strip's row, anywhere across the window.
      const over =
        current.clientY >= bounds.top &&
        current.clientY <= bounds.bottom &&
        current.clientX >= 0 &&
        current.clientX <= window.innerWidth;
      if (!over) return;
      const torn = current.torn;
      current.torn = null;
      torn.back(current.id);
      return;
    }
    const tearOff = tearer.current;
    const whole = tearOff?.whole() ?? false;
    if (
      tearOff &&
      (whole ||
        current.clientY < bounds.top - TEAR_DISTANCE ||
        current.clientY > bounds.bottom + TEAR_DISTANCE ||
        current.clientX < 0 ||
        current.clientX > window.innerWidth)
    ) {
      current.torn = tearOff;
      current.whole = whole;
      // The window carried is this one, held where it was grabbed, or a new
      // one whose first tab is under the pointer.
      tearOff.start(current.id, {
        x: whole ? current.startX : bounds.left + current.grab,
        y: current.startY,
      });
      return;
    }
    if (current.clientX < bounds.left + 24) strip.scrollLeft -= 8;
    else if (current.clientX > bounds.right - 24) strip.scrollLeft += 8;
    const placed = placeDragged();
    if (!placed || before.current) return;
    const tabs = placed.tabs.map((tab) => ({
      id: tab.dataset.panelTabId!,
      left: tab.offsetLeft,
      width: tab.offsetWidth,
    }));
    const target = tabDragTarget(tabs, current.id, placed.center);
    if (!target) return;
    before.current = positions();
    reorder.current(
      movePanelTab(
        tabs.map((tab) => tab.id),
        current.id,
        target.id,
        target.after,
      ),
    );
  };

  const finish = (cancelled: boolean) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current.active) {
      // Escape brings a torn-off tab back; let go, it stays where it was dropped.
      if (current.torn && cancelled && !current.whole) current.torn.back(current.id);
      else if (current.torn) current.torn.drop();
      else before.current = positions();
      for (const tab of elements()) {
        if (tab.dataset.panelTabId === current.id) tab.style.transform = "";
      }
      suppressClick.current = true;
      setDraggingId(null);
      if (cancelled && !current.torn)
        reorder.current(
          orderedPanelTabs(
            current.original,
            elements().map((tab) => tab.dataset.panelTabId!),
          ),
        );
    }
    if (ref.current?.hasPointerCapture(current.pointerId))
      ref.current.releasePointerCapture(current.pointerId);
  };
  const finishRef = useLatest(finish);

  const activate = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    current.active = true;
    const tab = elements().find((tab) => tab.dataset.panelTabId === current.id);
    if (tab) animations.current.get(tab)?.cancel();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(current.id);
    const tick = () => {
      if (!drag.current?.active) return;
      move();
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    // Not a tab out carrying a window: making that window can move focus.
    const cancel = () => {
      if (!drag.current?.torn) finishRef.current(true);
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      // Gone mid-drag: a window it was carrying stays where it is.
      drag.current?.torn?.drop();
      drag.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      for (const animation of animations.current.values()) animation.cancel();
    };
  }, [finishRef]);

  return {
    ref,
    draggingId,
    handlers: {
      onPointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || drag.current) return;
        suppressClick.current = false;
        if (!(event.target instanceof Element) || event.target.closest("button")) return;
        const tab = event.target.closest<HTMLElement>("[data-panel-tab-id]");
        const id = tab?.dataset.panelTabId;
        if (!tab || !id) return;
        const bounds = tab.getBoundingClientRect();
        tab.focus({ preventScroll: true });
        drag.current = {
          id,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          clientX: event.clientX,
          clientY: event.clientY,
          grab: event.clientX - bounds.left,
          width: bounds.width,
          original: elements().map((tab) => tab.dataset.panelTabId!),
          active: false,
          torn: null,
          whole: false,
        };
      },
      onPointerMove(event: PointerEvent<HTMLDivElement>) {
        const current = drag.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!(event.buttons & 1)) {
          finish(false);
          return;
        }
        current.clientX = event.clientX;
        current.clientY = event.clientY;
        current.torn?.move();
        if (!current.active) {
          if (
            Math.abs(event.clientX - current.startX) < 4 &&
            !(tearer.current && Math.abs(event.clientY - current.startY) >= 4)
          )
            return;
          activate(event);
        }
        // Here as well as each frame: a window covered by the one a tab
        // carries gets no frames, but pointer moves keep coming.
        move();
        event.preventDefault();
      },
      onPointerUp(event: PointerEvent<HTMLDivElement>) {
        if (drag.current?.pointerId !== event.pointerId) return;
        drag.current.clientX = event.clientX;
        drag.current.clientY = event.clientY;
        move();
        finish(false);
      },
      onPointerCancel: () => finish(true),
      onLostPointerCapture: () => finish(true),
      onPointerLeave(event: PointerEvent<HTMLDivElement>) {
        const current = drag.current;
        if (!current || current.active) return;
        // A quick flick can leave the strip before it's moved far enough to
        // count: held, it's a drag from here (tearing it off, if it can).
        if (event.buttons & 1 && current.pointerId === event.pointerId) {
          current.clientX = event.clientX;
          current.clientY = event.clientY;
          activate(event);
        } else finish(false);
      },
      onClickCapture(event: React.MouseEvent<HTMLDivElement>) {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      },
      onKeyDownCapture(event: React.KeyboardEvent<HTMLDivElement>) {
        if (event.key !== "Escape" || !drag.current?.active) return;
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      },
      onDragStart(event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();
      },
    },
  };
}
