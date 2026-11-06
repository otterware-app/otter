import { describe, expect, it, vi } from "vite-plus/test";

import { importSwiftOpenClaw, swiftOpenClaw } from "./swift-openclaw";

const settings = JSON.stringify({ enabled: false, url: "wss://computer.ts.net", model: "main" });
const run = JSON.stringify({ session: "agent:main:otter", run: "r-1" });

function storage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

describe("swiftOpenClaw", () => {
  it("reads apps/ios's settings and its open run", () => {
    expect(swiftOpenClaw({ openclaw: settings, "openclaw-run": run })).toEqual({
      url: "wss://computer.ts.net",
      model: "main",
      enabled: false,
      run: { session: "agent:main:otter", run: "r-1" },
    });
  });

  it("defaults what older versions didn't save", () => {
    expect(swiftOpenClaw({ openclaw: JSON.stringify({ url: "computer.ts.net" }) })).toEqual({
      url: "computer.ts.net",
      model: "",
      enabled: true,
    });
  });

  it("finds nothing without a gateway, or in broken JSON", () => {
    expect(swiftOpenClaw({})).toBeNull();
    expect(swiftOpenClaw({ openclaw: JSON.stringify({ url: "", enabled: true }) })).toBeNull();
    expect(swiftOpenClaw({ openclaw: "{not json" })).toBeNull();
  });
});

describe("importSwiftOpenClaw", () => {
  it("hands them to core once", async () => {
    const store = storage();
    const read = vi.fn(() => ({ openclaw: settings }));
    const invoke = vi.fn(async () => ({ imported: true }));
    await importSwiftOpenClaw({ storage: store, read, invoke });
    await importSwiftOpenClaw({ storage: store, read, invoke });
    expect(read).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("agent:importOpenClaw", {
      url: "wss://computer.ts.net",
      model: "main",
      enabled: false,
    });
  });

  it("is done with nothing to import", async () => {
    const store = storage();
    const invoke = vi.fn(async () => ({}));
    await importSwiftOpenClaw({ storage: store, read: () => ({}), invoke });
    expect(invoke).not.toHaveBeenCalled();
    const read = vi.fn(() => ({ openclaw: settings }));
    await importSwiftOpenClaw({ storage: store, read, invoke });
    expect(read).not.toHaveBeenCalled();
  });

  it("tries again next launch when core failed", async () => {
    const store = storage();
    const failing = vi.fn(async () => {
      throw new Error("core isn't up");
    });
    await expect(
      importSwiftOpenClaw({
        storage: store,
        read: () => ({ openclaw: settings }),
        invoke: failing,
      }),
    ).rejects.toThrow();
    const invoke = vi.fn(async () => ({}));
    await importSwiftOpenClaw({ storage: store, read: () => ({ openclaw: settings }), invoke });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
