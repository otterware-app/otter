import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const ui = vi.hoisted(() => ({ values: {} as Record<string, string> }));

vi.mock("../preferences.ts", () => ({
  getUiPreferences: async () => ({ ...ui.values }),
  setUiPreference: async (key: string, value: string) => {
    ui.values[key] = value;
  },
}));

const { themeTools } = await import("../agent/tools/themes.ts");

const confirmed: string[] = [];
const ctx = {
  caller: { mode: () => "approval-required" as const, turn: () => null },
  confirm: async (detail: string) => {
    confirmed.push(detail);
  },
};

function tool(name: string) {
  const found = themeTools.find((t) => t.name === name);
  if (!found) throw new Error(`No tool ${name}`);
  return (args: Record<string, unknown> = {}) => found.run(args, ctx) as Promise<any>;
}

const stored = () => JSON.parse(ui.values["otter:themes:v1"] ?? "[]");

beforeEach(() => {
  ui.values = { "otter:theme:light": "grove", "otter:theme:dark": "ocean" };
  confirmed.length = 0;
});

describe("theme tools", () => {
  it("lists the themes and what's worn", async () => {
    const list = await tool("list_themes")();
    expect(list.wearing).toEqual({ light: "grove", dark: "ocean" });
    expect(list.themes.find((t: { id: string }) => t.id === "ocean")).toMatchObject({
      builtIn: true,
      appearances: ["light", "dark"],
    });
  });

  it("reads a built-in as painted, with only the roles the app paints", async () => {
    const ocean = await tool("get_theme")({ theme: "ocean" });
    expect(ocean.builtIn).toBe(true);
    expect(ocean.dark.canvas).toBeTruthy();
    expect(ocean.dark.border).toMatch(/^#[0-9a-f]{6}$/);
    expect(ocean.dark).not.toHaveProperty("terminalBackground");
  });

  it("changing the worn built-in makes a copy and wears it in its place", async () => {
    const saved = await tool("save_theme")({
      theme: "ocean",
      dark: { canvas: "#1A1B26", messageAction: "#f97316" },
    });
    expect(saved).toMatchObject({ id: "ocean-copy", name: "Ocean copy" });
    expect(ui.values["otter:theme:dark"]).toBe("ocean-copy");
    expect(ui.values["otter:theme:light"]).toBe("grove");
    const [copy] = stored();
    const dark = copy.appearance === "dark" ? copy.colors : copy.variants.dark;
    expect(dark).toMatchObject({ canvas: "#1a1b26", messageAction: "#f97316" });
    expect(confirmed[0]).toContain("Make the theme “Ocean copy” from Ocean and wear it (dark)");
    expect(confirmed[0]).toContain("dark canvas #1a1b26");
  });

  it("changes a theme of the user's own in place, keeping what the user wears", async () => {
    await tool("save_theme")({ name: "Dusk", from: "ocean", wear: false });
    expect(ui.values["otter:theme:dark"]).toBe("ocean");
    await tool("save_theme")({ theme: "dusk", light: { text: "#111111" }, name: "Dusk 2" });
    const [dusk] = stored();
    expect(dusk).toMatchObject({ id: "dusk", label: "Dusk 2" });
    const light = dusk.appearance === "light" ? dusk.colors : dusk.variants.light;
    expect(light.text).toBe("#111111");
  });

  it("wears a theme for one appearance", async () => {
    await tool("use_theme")({ theme: "grove", appearance: "light" });
    expect(ui.values["otter:theme:light"]).toBe("grove");
    expect(ui.values["otter:theme:dark"]).toBe("ocean");
    expect(confirmed).toEqual(["Wear the theme “Grove” (light)"]);
  });

  it("turns down what the app can't paint", async () => {
    await expect(tool("save_theme")({ dark: { canvas: "blue" } })).rejects.toThrow(/color like/);
    await expect(tool("save_theme")({ dark: { nope: "#000000" } })).rejects.toThrow(
      /isn't a theme role/,
    );
    await expect(tool("get_theme")({ theme: "missing" })).rejects.toThrow(/No theme/);
    expect(stored()).toEqual([]);
  });
});
