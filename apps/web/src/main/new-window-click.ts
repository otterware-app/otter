import { isModClick } from "./keybindings/keys";
import { appApi } from "./app-api";

/**
 * ⌘-click (Ctrl-click off the Mac) on a place opens it in a new window, as
 * does "Open in New Window" in its menu. The click is noted here as it
 * happens; the navigation it leads to (home-view's history blocker) becomes
 * the window. Clicks that mean something else with ⌘ (picking list rows)
 * never navigate. A place's click that goes nowhere was on the place already
 * shown, which opens instead.
 */
let pending = false;

const here = () =>
  location.hash.length > 1 ? location.hash.slice(1) : location.pathname + location.search;

function note(fallback: boolean): void {
  pending = true;
  // Only the navigation this click starts, not a later one.
  setTimeout(() => {
    if (pending && fallback) void appApi.openWindow(here());
    pending = false;
  }, 0);
}

export function watchNewWindowClicks(): () => void {
  const click = (e: MouseEvent) => {
    if (e.button !== 0 || e.altKey || !isModClick(e)) return;
    note(e.target instanceof Element && e.target.closest("[data-place]") !== null);
  };
  window.addEventListener("click", click, true);
  return () => window.removeEventListener("click", click, true);
}

/** Runs `go` (what a place's click does), so that where it goes opens in a new window. */
export function inNewWindow(go: () => void): void {
  note(true);
  go();
}

export function takeNewWindowClick(): boolean {
  const click = pending;
  pending = false;
  return click;
}
