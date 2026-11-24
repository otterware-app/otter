import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  browserActivity,
  browserFit,
  followBrowser,
  holdBrowser,
  keyInput,
  screencastClosed,
  screencastFrame,
  screencastPage,
  tapInput,
} from "./agent-browser.ts";

function frame(meta: object, jpeg: number[]): ArrayBuffer {
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const bytes = new Uint8Array(4 + header.length + jpeg.length);
  new DataView(bytes.buffer).setUint32(0, header.length);
  bytes.set(header, 4);
  bytes.set(jpeg, 4 + header.length);
  return bytes.buffer;
}

describe("the screencast", () => {
  it("reads a frame's page size and its JPEG", () => {
    const parsed = screencastFrame(frame({ cssWidth: 1280, cssHeight: 800 }, [0xff, 0xd8]))!;
    expect(parsed.size).toEqual({ cssWidth: 1280, cssHeight: 800 });
    expect([...parsed.jpeg]).toEqual([0xff, 0xd8]);
    expect(screencastFrame(frame({}, [1]))?.size).toBeNull();
  });

  it("has no frame in one cut short", () => {
    expect(screencastFrame(new Uint8Array([0, 0, 1]).buffer)).toBeNull();
    expect(screencastFrame(new Uint8Array([0, 0, 0, 9, 0x7b, 0x7d]).buffer)).toBeNull();
    expect(screencastFrame(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x7b]).buffer)).toBeNull();
  });

  it("hears the page from ready and meta messages only", () => {
    expect(screencastPage('{"type":"meta","url":"https://a.com"}')).toBe("https://a.com");
    expect(screencastPage('{"type":"other","url":"https://a.com"}')).toBeNull();
  });

  it("gives up on what the gateway refuses, and asks again sooner for a closed tab", () => {
    expect(screencastClosed(4003, 1)).toHaveProperty("failed");
    expect(screencastClosed(4005, 1)).toHaveProperty("failed");
    expect(screencastClosed(4004, 5)).toEqual({ retryMs: 300 });
    expect(screencastClosed(1006, 1)).toEqual({ retryMs: 2000 });
    expect(screencastClosed(1006, 10)).toEqual({ retryMs: 15000 });
  });

  it("counts the agent's browsing", () => {
    const browse = (output?: string) => ({
      kind: "step" as const,
      step: { kind: "tool" as const, title: "Browser" },
      ...(output !== undefined && { output }),
    });
    expect(
      browserActivity([
        {
          id: "a",
          role: "assistant",
          text: "",
          items: [browse("ok"), browse(), { kind: "text", text: "x" }],
        },
      ]),
    ).toEqual({ steps: 2, done: 1 });
  });
});

describe("touching the live view", () => {
  it("fits a wide page against the top, and maps a touch to the page and back", () => {
    const wide = browserFit(
      { width: 400, height: 800 },
      { width: 800, height: 500 },
      { width: 1600, height: 1000 },
    )!;
    expect(wide.rect).toEqual({ x: 0, y: 0, width: 400, height: 250 });
    expect(wide.scale).toBe(0.25);
    expect(wide.page({ x: 200, y: 125 })).toEqual({ x: 800, y: 500 });
    expect(wide.page({ x: 200, y: 300 })).toBeNull();
    expect(wide.page({ x: 500, y: 300 }, true)).toEqual({ x: 1600, y: 1000 });
    expect(wide.view({ x: 800, y: 500 })).toEqual({ x: 200, y: 125 });
  });

  it("fits a tall page in the middle", () => {
    const tall = browserFit(
      { width: 400, height: 200 },
      { width: 100, height: 200 },
      { width: 50, height: 100 },
    )!;
    expect(tall.rect).toEqual({ x: 150, y: 0, width: 100, height: 200 });
    expect(tall.page({ x: 150, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(tall.page({ x: 100, y: 10 })).toBeNull();
    expect(tall.page({ x: 200, y: 100 })).toEqual({ x: 25, y: 50 });
    expect(tall.view({ x: 25, y: 50 })).toEqual({ x: 200, y: 100 });
    expect(
      browserFit({ width: 0, height: 0 }, { width: 1, height: 1 }, { width: 1, height: 1 }),
    ).toBeNull();
  });

  it("sends a tap and a key as the gateway replays them", () => {
    const tap = tapInput({ x: 3, y: 4 }, 2);
    expect(tap.map((e) => e.action)).toEqual(["move", "down", "up"]);
    expect(tap[1]).toMatchObject({ button: "left", clickCount: 2, x: 3, y: 4 });
    expect(tap[2].buttons).toBe(0);

    const enter = keyInput("\n");
    expect(enter[0]).toMatchObject({ key: "Enter", keyCode: 13, text: "\r" });
    expect(enter[1]).not.toHaveProperty("text");
    expect(keyInput("a")[0]).toMatchObject({ code: "KeyA", keyCode: 65, text: "a" });
    expect(keyInput("\b")[0]).not.toHaveProperty("text");
    expect(keyInput("é")[0]).toMatchObject({ text: "é" });
  });
});

afterEach(() => {
  delete (globalThis as { desktopBridge?: unknown }).desktopBridge;
});

it("releases a tab after a pending take is acknowledged", async () => {
  let acknowledge!: () => void;
  const taking = new Promise<void>((resolve) => {
    acknowledge = resolve;
  });
  const invoke = vi.fn().mockReturnValueOnce(taking).mockResolvedValue(undefined);
  (globalThis as { desktopBridge?: unknown }).desktopBridge = { invoke };
  const hold = holdBrowser("openclaw", { targetId: "t" }, vi.fn());
  const released = hold.release();

  await Promise.resolve();
  expect(invoke.mock.calls).toEqual([
    ["agent:browserInput", { provider: "openclaw", targetId: "t", take: true }],
  ]);
  acknowledge();
  await released;
  expect(invoke.mock.lastCall).toEqual([
    "agent:browserInput",
    { provider: "openclaw", targetId: "t", take: false },
  ]);
});

describe("following the agent's tab", () => {
  it("hears the tab as it is, then what happens on it", async () => {
    const answers = [
      { run: "r1", seq: 3, dialog: null, field: true, events: [] },
      {
        run: "r1",
        seq: 5,
        dialog: null,
        events: [
          { type: "pointer", phase: "click", x: 10, y: 20.5, seq: 4 },
          { type: "field", editable: false, seq: 5 },
          { type: "fileChooser", multiple: false, seq: 5 },
          { type: "later", seq: 5 },
        ],
      },
    ];
    const invoke = vi.fn(
      async (_channel: string, _params: { since?: number }) =>
        answers.shift() ?? new Promise(() => {}),
    );
    (globalThis as { desktopBridge?: unknown }).desktopBridge = { invoke };
    const events: unknown[] = [];
    const stop = followBrowser(
      "openclaw",
      { targetId: "t" },
      {
        onEvent: (event) => events.push(event),
        onDialog: () => {},
      },
    );
    await vi.waitFor(() => expect(events).toHaveLength(4));
    stop();
    expect(events).toEqual([
      { type: "field", editable: true },
      { type: "pointer", x: 10, y: 20.5, click: true },
      { type: "field", editable: false },
      { type: "fileChooser", multiple: false },
    ]);
    expect(invoke.mock.calls.map(([, params]) => params.since)).toEqual([undefined, 3, 5]);
  });
});
