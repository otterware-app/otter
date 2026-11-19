/**
 * Ported from T3 Code (github.com/pingdotgg/t3code at 470ca6349; MIT, see
 * THIRD_PARTY_NOTICES.md): apps/web/src/components/HistorySwipeNavigation.tsx.
 * Departures: it steps the router's history, sizes the indicator to the main pane,
 * takes the wheel events of a message's frame too, leaves alone wheel events something
 * else took, and the app mounts it only where `features.swipeNavigation` (a Mac).
 */
import { useRouter } from "@tanstack/react-router";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { canStepHistory } from "./history-steps";
import { cn } from "./mail/ui";

type HistoryDirection = "back" | "forward";

const SWIPE_TRIGGER_DISTANCE = 120;
// Movement needed before the gesture picks an axis; first events are often diagonal.
const SWIPE_AXIS_LOCK_DISTANCE = 8;
// Vertical scrolls drift sideways, so a swipe's horizontal travel must clearly dominate once
// it has moved far enough for its direction to be more than noise.
const SWIPE_HORIZONTAL_DOMINANCE = 2;
const SWIPE_DOMINANCE_DISTANCE = 30;
const MOMENTUM_SAMPLE_SIZE = 5;

type SwipeBounds = { left: number; top: number; width: number; height: number };
type SwipeGesture =
  | { kind: "pending"; path: EventTarget[]; y: number; sumX: number; sumY: number }
  | {
      kind: "tracking";
      direction: HistoryDirection;
      distance: number;
      deltas: number[];
      travelX: number;
      travelY: number;
      y: number;
      bounds: SwipeBounds;
    }
  // Not a swipe, or one already decided: the rest of its events are ignored.
  | { kind: "ignored" };
type SwipeIndicatorState = {
  direction: HistoryDirection;
  progress: number;
  y: number;
  bounds: SwipeBounds;
  tracking: boolean;
};

function readMainPaneBounds(): SwipeBounds {
  const main = document.querySelector("[data-main-pane]");
  if (!main) return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const { left, top, width, height } = main.getBoundingClientRect();
  return { left, top, width, height };
}

// A message's frame has its own window, whose elements fail `instanceof Element` here.
function isElement(target: EventTarget): target is Element {
  return (target as Node).nodeType === Node.ELEMENT_NODE;
}

// A frame's page scrolls sideways with `visible` too, unless its root or body clips: their
// overflow is the page's.
function pageScrollsSideways(doc: Document): boolean {
  const root = getComputedStyle(doc.documentElement).overflowX;
  const page = root === "visible" && doc.body ? getComputedStyle(doc.body).overflowX : root;
  return page !== "hidden" && page !== "clip";
}

// `event.target` stops at a shadow host; the composed path also reaches scrollers inside it.
function canScrollHorizontally(path: readonly EventTarget[], deltaX: number): boolean {
  for (const element of path) {
    if (!isElement(element) || element.scrollWidth <= element.clientWidth) continue;
    const { overflowX } = getComputedStyle(element);
    const scrolls =
      overflowX === "auto" ||
      overflowX === "scroll" ||
      (element === element.ownerDocument.scrollingElement &&
        pageScrollsSideways(element.ownerDocument));
    if (!scrolls) continue;
    const canScroll =
      deltaX < 0
        ? element.scrollLeft > 0
        : element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    if (canScroll) return true;
  }
  return false;
}

function isVerticalScroll(travelX: number, travelY: number): boolean {
  return (
    travelX + travelY >= SWIPE_DOMINANCE_DISTANCE && travelX <= SWIPE_HORIZONTAL_DOMINANCE * travelY
  );
}

function lockSwipeAxis(
  pending: Extract<SwipeGesture, { kind: "pending" }>,
  canStep: (direction: HistoryDirection) => boolean,
): Exclude<SwipeGesture, { kind: "pending" }> {
  const { path, sumX, sumY } = pending;
  if (Math.abs(sumX) <= Math.abs(sumY) || isVerticalScroll(Math.abs(sumX), Math.abs(sumY))) {
    return { kind: "ignored" };
  }
  if (path.some((node) => isElement(node) && node.matches('[role="dialog"]'))) {
    return { kind: "ignored" };
  }
  if (canScrollHorizontally(path, sumX)) return { kind: "ignored" };
  const direction = sumX < 0 ? "back" : "forward";
  if (!canStep(direction)) return { kind: "ignored" };
  return {
    kind: "tracking",
    direction,
    distance: Math.abs(sumX),
    deltas: [],
    travelX: Math.abs(sumX),
    travelY: Math.abs(sumY),
    y: pending.y,
    bounds: readMainPaneBounds(),
  };
}

/**
 * macOS momentum after the fingers lift decays by a near-constant ratio per
 * event; finger movement is noisier. Deltas are signed along the swipe.
 */
export function isMomentumTail(deltas: readonly number[]): boolean {
  if (deltas.length < MOMENTUM_SAMPLE_SIZE) return false;
  const recent = deltas.slice(-MOMENTUM_SAMPLE_SIZE);
  if (recent.some((delta) => delta <= 0)) return false;
  const ratios = recent.slice(1).map((delta, index) => delta / recent[index]!);
  return (
    ratios.every((ratio) => ratio >= 0.7 && ratio < 1) &&
    Math.max(...ratios) - Math.min(...ratios) < 0.1
  );
}

type FrameWheel = (event: WheelEvent, frame: HTMLIFrameElement) => void;
let frameWheel: FrameWheel | null = null;

/** A message's frame keeps its wheel events from the window: it passes them on here. */
export function followFrameWheel(frame: HTMLIFrameElement, doc: Document): void {
  doc.addEventListener("wheel", (event) => frameWheel?.(event, frame), { passive: true });
}

function framePath(frame: HTMLIFrameElement): Element[] {
  const path: Element[] = [];
  for (let element: Element | null = frame; element; element = element.parentElement) {
    path.push(element);
  }
  return path;
}

/** Two-finger horizontal trackpad swipes go back and forward, like a browser. */
export function HistorySwipeNavigation() {
  const { history } = useRouter();
  const [swipe, setSwipe] = useState<SwipeIndicatorState | null>(null);

  useEffect(() => {
    const canStep = (direction: HistoryDirection) => canStepHistory(history, direction);
    let gesture: SwipeGesture | null = null;
    const hideIndicator = () =>
      setSwipe((current) => (current === null ? null : { ...current, tracking: false }));
    // The fingers lifted: navigate if the swipe went far enough, then ignore its momentum.
    const release = () => {
      if (gesture?.kind === "tracking" && gesture.distance >= SWIPE_TRIGGER_DISTANCE) {
        if (gesture.direction === "back") history.back();
        else history.forward();
      }
      gesture = { kind: "ignored" };
      hideIndicator();
    };
    // Chromium brackets each trackpad scroll, momentum included, with these.
    const unsubscribeScrollBegin = window.desktopBridge.on("trackpad:scroll-begin", () => {
      if (gesture?.kind === "ignored") gesture = null;
    });
    const unsubscribeScrollEnd = window.desktopBridge.on("trackpad:scroll-end", () => {
      if (gesture?.kind === "tracking") release();
      gesture = null;
    });
    const onWheel = (event: WheelEvent, frame?: HTMLIFrameElement) => {
      // Taken by what's under it (the agent's live browser), which Chromium then doesn't scroll.
      if (event.defaultPrevented) return;
      const path = () =>
        frame ? [...event.composedPath(), ...framePath(frame)] : event.composedPath();
      if (gesture === null) {
        const y = event.clientY + (frame?.getBoundingClientRect().top ?? 0);
        gesture =
          event.ctrlKey || event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL
            ? { kind: "ignored" }
            : { kind: "pending", path: path(), y, sumX: 0, sumY: 0 };
      }
      if (gesture.kind === "ignored") return;
      if (gesture.kind === "pending") {
        gesture.sumX += event.deltaX;
        gesture.sumY += event.deltaY;
        if (Math.abs(gesture.sumX) + Math.abs(gesture.sumY) < SWIPE_AXIS_LOCK_DISTANCE) return;
        gesture = lockSwipeAxis({ ...gesture, path: [...gesture.path, ...path()] }, canStep);
        if (gesture.kind === "ignored") return;
      } else {
        const delta = gesture.direction === "back" ? -event.deltaX : event.deltaX;
        if (event.deltaX === 0 && event.deltaY === 0) return release();
        gesture.travelX += Math.abs(event.deltaX);
        gesture.travelY += Math.abs(event.deltaY);
        if (isVerticalScroll(gesture.travelX, gesture.travelY)) {
          gesture = { kind: "ignored" };
          return hideIndicator();
        }
        gesture.deltas = [...gesture.deltas.slice(1 - MOMENTUM_SAMPLE_SIZE), delta];
        if (isMomentumTail(gesture.deltas)) return release();
        gesture.distance = Math.max(0, gesture.distance + delta);
      }
      setSwipe({
        direction: gesture.direction,
        progress: Math.min(1, gesture.distance / SWIPE_TRIGGER_DISTANCE),
        y: gesture.y,
        bounds: gesture.bounds,
        tracking: true,
      });
    };
    const onWindowWheel = (event: WheelEvent) => onWheel(event);
    frameWheel = onWheel;
    window.addEventListener("wheel", onWindowWheel, { passive: true });
    return () => {
      frameWheel = null;
      unsubscribeScrollBegin();
      unsubscribeScrollEnd();
      window.removeEventListener("wheel", onWindowWheel);
    };
  }, [history]);

  return swipe === null ? null : <SwipeIndicator {...swipe} />;
}

// A circle pinned to the edge of the main pane that peeks in up to half its width.
function SwipeIndicator({ direction, progress, y, bounds, tracking }: SwipeIndicatorState) {
  const armed = progress >= 1;
  const Icon = direction === "back" ? ArrowLeftIcon : ArrowRightIcon;
  const hidden = 100 - progress * 50;
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed z-100 overflow-hidden"
      style={bounds}
    >
      <div
        className={cn(
          "absolute flex size-14 items-center rounded-full bg-muted text-foreground dark:bg-black dark:text-white",
          direction === "back" ? "left-0 justify-end pr-2" : "right-0 justify-start pl-2",
          !tracking && "transition-[opacity,transform] duration-200 ease-out",
        )}
        style={{
          top: `clamp(0px, calc(${y - bounds.top}px - 1.75rem), calc(100% - 3.5rem))`,
          opacity: tracking ? 1 : 0,
          transform: `translateX(${direction === "back" ? -hidden : hidden}%)`,
        }}
      >
        <Icon
          className={cn(
            "size-4 transition-opacity duration-100",
            armed ? "opacity-100" : "opacity-40",
          )}
        />
      </div>
    </div>
  );
}
