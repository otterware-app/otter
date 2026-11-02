import { isModClick } from "./keybindings/keys";
import type { RecentIcon } from "./recently-viewed";

/**
 * ⌘-click (Ctrl-click off the Mac) on a place opens it in a new tab, as in a
 * browser: in the background, or shown with ⇧ too. The click is noted here as
 * it happens; the navigation it leads to (router.tsx's blocker) becomes the tab.
 * Clicks that mean something else with ⌘ (picking list rows) never navigate.
 */
let pending: { show: boolean; title: string } | null = null;

function clickedTitle(target: EventTarget | null): string {
  const control = (target as Element | null)?.closest?.("a, button, [role=tab], [role=option]");
  if (!control) return "";
  const label =
    control.getAttribute("aria-label") ||
    control.querySelector(".truncate")?.textContent ||
    control.textContent ||
    "";
  return label.trim().slice(0, 80);
}

export function watchNewTabClicks(): () => void {
  const click = (e: MouseEvent) => {
    if (e.button !== 0 || e.altKey || !isModClick(e)) return;
    pending = { show: e.shiftKey, title: clickedTitle(e.target) };
    // Only the navigation this click starts, not a later one.
    setTimeout(() => {
      pending = null;
    }, 0);
  };
  window.addEventListener("click", click, true);
  return () => window.removeEventListener("click", click, true);
}

export function takeNewTabClick(): { show: boolean; title: string } | null {
  const click = pending;
  pending = null;
  return click;
}

/** What a place is, from its address alone (the tab names itself once shown). */
export function iconForHref(href: string): RecentIcon {
  const [first = "", second = "", third] = href.split(/[?#]/)[0]!.split("/").filter(Boolean);
  if (first === "settings") return "settings";
  if (first === "calendar") return "calendar";
  if (first === "chats") return "chat";
  if (first === "compose") return "compose";
  if (third) return "conversation";
  if (second === "INBOX") return "inbox";
  return "label";
}
