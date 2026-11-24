import { describe, expect, it } from "vite-plus/test";

import { cn } from "./utils.ts";

describe("cn", () => {
  it("lets a caller's rounded-pill replace a component's radius", () => {
    expect(cn("rounded-lg border", "rounded-pill")).toBe("border rounded-pill");
  });

  it("lets a caller's shadow replace shadow-overlay", () => {
    expect(cn("shadow-overlay", "shadow-none")).toBe("shadow-none");
  });
});
