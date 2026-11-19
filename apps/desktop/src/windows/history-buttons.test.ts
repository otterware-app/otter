import type { BrowserWindow, WebContents } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";

import { followHistoryButtons, followPageHistoryButtons } from "./history-buttons";

type Listener = (...args: any[]) => void;

function fakeContents() {
  const listeners = new Map<string, Listener>();
  return {
    listeners,
    on: (name: string, listener: Listener) => listeners.set(name, listener),
    send: vi.fn(),
    navigationHistory: { goBack: vi.fn(), goForward: vi.fn() },
  };
}

function fakeWindow() {
  const contents = fakeContents();
  const listeners = new Map<string, Listener>();
  const win = {
    webContents: contents,
    isDestroyed: () => false,
    on: (name: string, listener: Listener) => listeners.set(name, listener),
  };
  return { win, contents, listeners };
}

describe("followHistoryButtons", () => {
  it("leaves the mouse's back and forward buttons to Chromium, which moves the window's history once", () => {
    const { win, contents } = fakeWindow();
    followHistoryButtons(win as unknown as BrowserWindow, () => null);
    expect(contents.listeners.has("before-mouse-event")).toBe(false);
  });

  it("reads Logi Options+'s swipes as Chrome does: left is back", () => {
    const { win, contents, listeners } = fakeWindow();
    followHistoryButtons(win as unknown as BrowserWindow, () => null);
    const swipe = listeners.get("swipe")!;
    swipe({}, "left");
    swipe({}, "right");
    swipe({}, "up");
    expect(contents.send.mock.calls).toEqual([["nav:back"], ["nav:forward"]]);
  });

  it("swipes the focused browser tab in this window rather than the app", () => {
    const { win, contents, listeners } = fakeWindow();
    const page = { ...fakeContents(), hostWebContents: contents };
    followHistoryButtons(win as unknown as BrowserWindow, () => page as unknown as WebContents);
    listeners.get("swipe")!({}, "left");
    expect(page.navigationHistory.goBack).toHaveBeenCalledOnce();
    expect(contents.send).not.toHaveBeenCalled();
  });

  it("tells the app where a trackpad scroll begins and ends", () => {
    const { win, contents } = fakeWindow();
    followHistoryButtons(win as unknown as BrowserWindow, () => null);
    const input = contents.listeners.get("input-event")!;
    input({}, { type: "gestureScrollBegin" });
    input({}, { type: "gestureScrollUpdate" });
    input({}, { type: "gestureScrollEnd" });
    expect(contents.send.mock.calls).toEqual([["trackpad:scroll-begin"], ["trackpad:scroll-end"]]);
  });
});

describe("followPageHistoryButtons", () => {
  it("steps a browser tab's own history, and keeps the press from moving the app's", () => {
    const page = fakeContents();
    followPageHistoryButtons(page as unknown as WebContents);
    const mouse = page.listeners.get("before-mouse-event")!;
    const events = [
      { type: "mouseDown", button: "back" },
      { type: "mouseUp", button: "back" },
      { type: "mouseUp", button: "forward" },
      { type: "mouseUp", button: "left" },
    ].map((input) => {
      const event = { preventDefault: vi.fn() };
      mouse(event, input);
      return event;
    });
    expect(page.navigationHistory.goBack).toHaveBeenCalledOnce();
    expect(page.navigationHistory.goForward).toHaveBeenCalledOnce();
    expect(events.map((event) => event.preventDefault.mock.calls.length)).toEqual([1, 1, 1, 0]);
  });
});
