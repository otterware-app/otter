import { describe, expect, it } from "vite-plus/test";
import * as NodeFS from "node:fs";

import { penVariables, resolveColors } from "./tokens.ts";

const read = (path: string) => NodeFS.readFileSync(new URL(path, import.meta.url), "utf8");
const tokensCss = read("./styles/tokens.css");
const globalsCss = read("./styles/globals.css");

describe("design tokens", () => {
  it("are what design/otter.pen draws with (pnpm design:tokens)", () => {
    const committed = JSON.parse(read("../../../design/tokens.json"));
    expect(committed).toEqual(penVariables(tokensCss, globalsCss));
  });

  it("take the sidebar's roles from its own scope", () => {
    const colors = resolveColors(tokensCss);
    expect(colors.get("sidebar-control-surface")?.dark).toBe("#121213");
    expect(colors.get("muted")?.dark).toBe("#ffffff0a");
    expect(colors.get("sidebar-icon-color")?.dark).toBe("#5b5b5d");
  });

  it("resolve var() and color-mix() as a browser does", () => {
    const colors = resolveColors(`:root {
  --canvas: #ffffff;
  --foreground: #000000;
  --half: color-mix(in srgb, var(--foreground) 50%, var(--canvas));
  --faint: color-mix(in srgb, var(--foreground) 25%, transparent);
}
.dark {
  --canvas: #000000;
  --foreground: #ffffff;
}`);
    expect(colors.get("half")).toEqual({ light: "#808080", dark: "#808080" });
    expect(colors.get("faint")).toEqual({ light: "#00000040", dark: "#ffffff40" });
  });
});
