import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import { CONTROL_TTL_MS, cdpInput, createBrowserControl } from "./control.js";

const fixture = async ({ answerDialog, connect } = {}) => {
  let time = 1000;
  const sent = [];
  const calls = [];
  let listener = () => {};
  const page = {
    open: () => true,
    send: (method, params) => sent.push([method, params]),
    call: async (method, params) => {
      calls.push([method, params]);
      return method === "Page.getNavigationHistory"
        ? { currentIndex: 1, entries: [{ id: 7 }, { id: 8 }, { id: 9 }] }
        : {};
    },
    on: (next) => (listener = next),
    close() {},
  };
  const uploads = await mkdtemp(path.join(tmpdir(), "otter-uploads-"));
  const control = createBrowserControl({
    cdpUrlFor: async () => "http://127.0.0.1:18800/",
    answerDialog,
    connect: connect ?? (async () => page),
    now: () => time,
    uploads,
  });
  const saw = (event) =>
    listener("Runtime.bindingCalled", { name: "__otterSaw", payload: JSON.stringify(event) });
  return {
    control,
    sent,
    calls,
    emit: (method, params) => listener(method, params),
    saw,
    advance: (ms) => (time += ms),
  };
};
const text = (t) => ({ type: "text", text: t });

describe("taking control of the agent's browser", () => {
  it("replays input only while held, and in the order it was sent", async () => {
    const { control, sent, calls } = await fixture();
    await expect(control.input("tab", undefined, 1, [text("a")])).rejects.toThrow(/Take control/);
    await control.take("tab");
    expect(calls).toContainEqual(["Page.setInterceptFileChooserDialog", { enabled: true }]);
    const later = control.input("tab", undefined, 2, [text("b")]);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(sent).toEqual([]);
    await control.input("tab", undefined, 1, [text("a")]);
    await later;
    expect(sent.map(([, p]) => p.text)).toEqual(["a", "b"]);
  });

  it("lets the agent read but not act while you hold a tab, and lets go when left alone", async () => {
    const { control, advance } = await fixture();
    expect(control.allows({ action: "act" })).toBe(true);
    await control.take("tab");
    expect(control.allows({ action: "snapshot" })).toBe(true);
    expect(control.allows({ action: "act" })).toBe(false);
    expect(control.allows({ action: "navigate" })).toBe(false);
    advance(CONTROL_TTL_MS + 1);
    expect(control.allows({ action: "act" })).toBe(true);
  });

  it("skips a lost batch on time while later ones keep coming", async () => {
    vi.useFakeTimers();
    const { control, sent } = await fixture();
    await control.take("tab");
    const replayed = [];
    for (let seq = 2; seq <= 6; seq++) {
      void control.input("tab", undefined, seq, [text(String(seq))]);
      await vi.advanceTimersByTimeAsync(50);
      replayed.push(sent.length);
    }
    // Batch 1 never came: replay starts 150 ms in, while the rest keep arriving.
    expect(replayed).toEqual([0, 0, 3, 4, 5]);
    vi.useRealTimers();
  });

  it("goes back a page, and answers the page's pop-up, in the order you did", async () => {
    const { control, sent } = await fixture();
    await control.take("tab");
    await control.input("tab", undefined, 1, [
      { type: "history", delta: -1 },
      { type: "dialog", accept: true, promptText: "yes" },
      { type: "navigate", url: "javascript:alert(1)" },
    ]);
    // Going back waits on the page's history; the answer after it doesn't overtake it.
    expect(sent).toEqual([
      ["Page.navigateToHistoryEntry", { entryId: 7 }],
      ["Page.handleJavaScriptDialog", { accept: true, promptText: "yes" }],
    ]);
  });

  it("drops what's still queued once you hand the tab back", async () => {
    let answer;
    const { control, sent } = await fixture({
      answerDialog: () => new Promise((resolve) => (answer = resolve)),
    });
    await control.take("tab");
    const first = control.input("tab", undefined, 1, [{ type: "dialog", accept: true }]);
    const second = control.input("tab", undefined, 2, [text("late")]);
    await vi.waitFor(() => expect(answer).toBeDefined());
    control.release("tab");
    answer();
    await Promise.all([first, second]);
    expect(sent).toEqual([]);
  });

  it("keeps the request open until its batch is replayed, even one released after a gap", async () => {
    vi.useFakeTimers();
    let answeredWhileOpen = null;
    let settled = false;
    const { control } = await fixture({
      answerDialog: async () => {
        answeredWhileOpen = !settled;
      },
    });
    await control.take("tab");
    // Batch 1 never comes: batch 2 (an answer) goes after the gap, its request still open.
    const request = control
      .input("tab", undefined, 2, [{ type: "dialog", accept: true }])
      .then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(200);
    await request;
    expect(answeredWhileOpen).toBe(true);
    vi.useRealTimers();
  });

  it("tells whoever watches where the pointer went and what popped up, waiting until it does", async () => {
    const { control, saw, emit } = await fixture();
    const start = await control.events("tab", undefined, undefined, 0);
    expect(start).toEqual({
      run: expect.any(String),
      seq: 0,
      dialog: null,
      field: false,
      events: [],
    });
    // From an earlier run of the plugin: its numbers mean nothing now, so just the state.
    expect((await control.events("tab", undefined, 5, 0, "old")).events).toEqual([]);
    const waiting = control.events("tab", undefined, 0, 20_000, start.run);
    await vi.waitFor(() => saw({ type: "pointer", phase: "click", x: 10, y: 20 }));
    expect((await waiting).events).toEqual([
      { type: "pointer", phase: "click", x: 10, y: 20, seq: 1 },
    ]);
    emit("Page.javascriptDialogOpening", { type: "confirm", message: "Leave?" });
    const after = await control.events("tab", undefined, 1, 0, start.run);
    expect(after.dialog).toMatchObject({ dialogType: "confirm", message: "Leave?" });
    // A field that has focus is told to whoever starts watching after it got it.
    saw({ type: "field", editable: true });
    await vi.waitFor(async () =>
      expect((await control.events("tab", undefined, undefined, 0)).field).toBe(true),
    );
  });

  it("says when what has focus in the page takes text, for a phone's keyboard", async () => {
    const { control, calls } = await fixture();
    await control.events("tab", undefined, undefined, 0);
    const { source } = calls.find(
      ([method]) => method === "Page.addScriptToEvaluateOnNewDocument",
    )[1];
    function HTMLInputElement() {}
    function HTMLTextAreaElement() {}
    const listeners = {};
    const said = [];
    const page = {
      HTMLInputElement,
      HTMLTextAreaElement,
      document: { activeElement: null },
      addEventListener: (type, listener) => (listeners[type] ??= []).push(listener),
      setTimeout: (run) => run(),
      __otterSaw: (payload) => said.push(JSON.parse(payload)),
    };
    page.window = page.top = page;
    runInNewContext(source, page);
    expect(said).toEqual([{ type: "field", editable: false }]);
    const focus = (element, type = "focusin") => {
      page.document.activeElement = element;
      for (const listener of listeners[type]) listener({});
      return said.at(-1);
    };
    const input = (type) => Object.assign(new HTMLInputElement(), { type });
    expect(focus(input("email"))).toEqual({ type: "field", editable: true });
    expect(focus(input("checkbox"))).toEqual({ type: "field", editable: false });
    expect(focus(new HTMLTextAreaElement())).toEqual({ type: "field", editable: true });
    expect(focus({ isContentEditable: true })).toEqual({ type: "field", editable: true });
    // Inside a component: the field its shadow root has focused.
    expect(focus({ shadowRoot: { activeElement: input("search") } })).toEqual({
      type: "field",
      editable: true,
    });
    expect(focus(null, "focusout")).toEqual({ type: "field", editable: false });
    // Connected to the same page again: it says the field it has, and listens once.
    focus(input("text"));
    const heard = said.length;
    runInNewContext(source, page);
    expect(said.slice(heard)).toEqual([{ type: "field", editable: true }]);
    expect(listeners.focusin).toHaveLength(1);
  });

  it("hands the page's file picker the files you chose", async () => {
    const { control, emit, calls } = await fixture();
    await control.take("tab");
    await expect(control.upload("tab", undefined, [])).rejects.toThrow(/isn't asking/);
    emit("Page.fileChooserOpened", { backendNodeId: 42, mode: "selectSingle" });
    await control.upload("tab", undefined, [{ name: "../lease.pdf", data: btoa("%PDF") }]);
    const [, params] = calls.at(-1);
    expect(params.backendNodeId).toBe(42);
    expect(path.basename(params.files[0])).toBe("lease.pdf");
    expect(await readFile(params.files[0], "utf8")).toBe("%PDF");
  });

  it("still asks for the file after an upload it refused", async () => {
    const { control, emit, calls } = await fixture();
    await control.take("tab");
    emit("Page.fileChooserOpened", { backendNodeId: 42, mode: "selectSingle" });
    const huge = "A".repeat(14 * 1024 * 1024);
    await expect(control.upload("tab", undefined, [{ name: "a", data: huge }])).rejects.toThrow(
      /too large/,
    );
    await control.upload("tab", undefined, [{ name: "a.txt", data: btoa("a") }]);
    expect(calls.at(-1)[1].backendNodeId).toBe(42);
    await expect(control.upload("tab", undefined, [])).rejects.toThrow(/isn't asking/);
  });

  it("lets the agent act again when taking a tab fails", async () => {
    const { control } = await fixture({
      connect: async () => {
        throw new Error("That tab has closed.");
      },
    });
    await expect(control.take("tab")).rejects.toThrow(/closed/);
    expect(control.allows({ action: "act" })).toBe(true);
  });

  it("sends keys and clicks as a person's", () => {
    expect(
      cdpInput({ type: "key", action: "down", key: "a", code: "KeyA", keyCode: 65, text: "a" }),
    ).toEqual([
      "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyDown", text: "a", windowsVirtualKeyCode: 65 }),
    ]);
    expect(
      cdpInput({
        type: "key",
        action: "down",
        key: "c",
        code: "KeyC",
        keyCode: 67,
        modifiers: 2,
      })?.[1],
    ).toMatchObject({ type: "rawKeyDown", commands: ["copy"] });
    expect(
      cdpInput({ type: "mouse", action: "down", x: 3, y: 4, button: "left", buttons: 1 }),
    ).toEqual([
      "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mousePressed", x: 3, y: 4, button: "left" }),
    ]);
    expect(cdpInput({ type: "eval", code: "x" })).toBeNull();
  });
});
