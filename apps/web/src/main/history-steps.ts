import type { RouterHistory } from "@tanstack/react-router";

let trackedHistory: RouterHistory | null = null;
let furthestIndex = 0;

function trackHistory(history: RouterHistory): void {
  if (trackedHistory === history) return;
  trackedHistory = history;
  furthestIndex = history.location.state.__TSR_index;
  history.subscribe(({ location, action }) => {
    const index = location.state.__TSR_index;
    furthestIndex = action.type === "PUSH" ? index : Math.max(furthestIndex, index);
  });
}

export function canStepHistory(history: RouterHistory, step: "back" | "forward"): boolean {
  trackHistory(history);
  const index = history.location.state.__TSR_index;
  return step === "back" ? index > 0 : index < furthestIndex;
}
