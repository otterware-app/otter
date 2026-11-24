import { describe, expect, it } from "vite-plus/test";
import {
  browserActivity,
  screencastClosed,
  screencastFrame,
  screencastPage,
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
    const parsed = screencastFrame(frame({ cssWidth: 1280, cssHeight: 800 }, [0xff, 0xd8]));
    expect(parsed.size).toEqual({ cssWidth: 1280, cssHeight: 800 });
    expect([...parsed.jpeg]).toEqual([0xff, 0xd8]);
    expect(screencastFrame(frame({}, [1])).size).toBeNull();
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
