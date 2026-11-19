import type { BrowserWindow, MouseInputEvent, WebContents } from "electron";

export type HistoryStep = "back" | "forward";

/** Back or forward in the focused browser page, else in the app's own history. */
export function stepHistory(
  win: BrowserWindow | null | undefined,
  page: WebContents | null,
  step: HistoryStep,
): void {
  if (page && (!win || page.hostWebContents === win.webContents)) {
    stepPage(page, step);
    return;
  }
  if (win && !win.isDestroyed()) win.webContents.send(`nav:${step}`);
}

/**
 * Chromium moves the window's history on the mouse's back and forward buttons
 * itself, from anywhere in it (a message's iframe included), as T3 Code relies on.
 * On a Mac, Logi Options+ can send them as a swipe instead (deltaX +1 is back,
 * which Electron calls "left"), as Chrome and Safari read it. The renderer turns
 * two-finger trackpad swipes into back and forward from the scroll gestures,
 * which Chromium brackets with these events.
 */
export function followHistoryButtons(
  win: BrowserWindow,
  focusedPage: () => WebContents | null,
): void {
  win.on("swipe", (_event, direction) => {
    if (direction === "left") stepHistory(win, focusedPage(), "back");
    else if (direction === "right") stepHistory(win, focusedPage(), "forward");
  });
  win.webContents.on("input-event", (_event, input) => {
    if (win.isDestroyed()) return;
    if (input.type === "gestureScrollBegin") win.webContents.send("trackpad:scroll-begin");
    else if (input.type === "gestureScrollEnd") win.webContents.send("trackpad:scroll-end");
  });
}

/**
 * A browser tab's page takes the buttons itself, so they move its own history.
 * Left alone, Chromium would also move the app's, its outermost contents.
 */
export function followPageHistoryButtons(page: WebContents): void {
  page.on("before-mouse-event", (event, mouse) => {
    const step = buttonStep(mouse);
    if (!step) return;
    event.preventDefault();
    if (mouse.type === "mouseUp") stepPage(page, step);
  });
}

function stepPage(page: WebContents, step: HistoryStep): void {
  if (step === "back") page.navigationHistory.goBack();
  else page.navigationHistory.goForward();
}

function buttonStep(mouse: MouseInputEvent): HistoryStep | null {
  if (mouse.type !== "mouseDown" && mouse.type !== "mouseUp") return null;
  // Electron reports these buttons though its types list only left, middle and right.
  const button = mouse.button as string | undefined;
  return button === "back" || button === "forward" ? button : null;
}
