import { describe, expect, it } from "vite-plus/test";
import type { ProviderModelOption, ProviderSnapshot } from "./api.ts";
import {
  agentItems,
  modelLabel,
  pickedAgent,
  pickerModels,
  searchAgentItems,
  traitsLabel,
} from "./model-picker.ts";

const provider = (over: Partial<ProviderSnapshot>) =>
  ({
    id: "p",
    kind: "hermes",
    name: "Hermes",
    enabled: true,
    installed: true,
    status: "ready",
    checkedAt: 1,
    models: [],
    model: null,
    settings: { enabled: true, model: "" },
    ...over,
  }) as ProviderSnapshot;

describe("model names", () => {
  it("reads model ids as people say them", () => {
    expect(modelLabel("claude-opus-4-1-20250805")).toBe("Claude Opus 4.1");
    expect(modelLabel("gpt-5-codex")).toBe("GPT-5 Codex");
    expect(modelLabel("o4-mini")).toBe("o4 Mini");
    expect(modelLabel("Already Named")).toBe("Already Named");
  });
});

describe("the agent picker", () => {
  const gateway = provider({
    id: "gw",
    kind: "openclaw",
    name: "Gateway",
    models: [
      { slug: "main", name: "Main" },
      { slug: "ops", name: "Ops" },
    ],
    model: "main",
  });
  const off = provider({ id: "off", name: "Off", enabled: false });
  const items = agentItems(
    [gateway, off],
    (kind) => kind === "openclaw",
    (kind) => kind,
  );

  it("lists a gateway's agents, and other agents whole, saying why one can't be picked", () => {
    expect(items.map((i) => [i.key, i.name, i.detail, i.status])).toEqual([
      ["gw:main", "Main", "Gateway", null],
      ["gw:ops", "Ops", "Gateway", null],
      ["off", "Off", "hermes", "Turned off"],
    ]);
    expect(searchAgentItems(items, "ops").map((i) => i.key)).toEqual(["gw:ops"]);
  });

  it("shows the gateway's agent a chat is with, else its default", () => {
    expect(pickedAgent(gateway, "ops", true)).toEqual({ slug: "ops", label: "Ops", key: "gw:ops" });
    expect(pickedAgent(gateway, null, true).key).toBe("gw:main");
    expect(pickedAgent(gateway, null, false)).toEqual({ slug: null, label: "Gateway", key: "gw" });
    expect(pickedAgent(undefined, null, false).label).toBe("Choose agent");
  });

  it("leaves out a gateway's agents you turned off, and the gateway with all of them off", () => {
    const research = { ...gateway, settings: { ...gateway.settings, disabledAgents: ["main"] } };
    const rows = (p: ProviderSnapshot) =>
      agentItems(
        [p],
        (kind) => kind === "openclaw",
        (kind) => kind,
      ).map((i) => i.key);
    expect(rows(research)).toEqual(["gw:ops"]);
    expect(pickedAgent(research, null, true).key).toBe("gw:ops");
    expect(pickedAgent(research, "main", true).label).toBe("Main");
    const allOff = {
      ...gateway,
      settings: { ...gateway.settings, disabledAgents: ["main", "ops"] },
    };
    expect(rows(allOff)).toEqual([]);
  });
});

describe("the model picker", () => {
  const p = provider({
    models: [
      { slug: "a", name: "Alpha", subProvider: "One" },
      { slug: "b", name: "Beta", subProvider: "One" },
      { slug: "c", name: "Gamma", subProvider: "Two" },
      { slug: "d", name: "Delta", subProvider: "Two" },
    ],
    model: "d",
  });

  it("groups by provider, favorites first, hiding the hidden but the one in use", () => {
    const shown = pickerModels(p, { favorites: ["p:b"], hidden: ["p:c", "p:d"] }, "");
    expect(shown.map((m) => m.slug)).toEqual(["b", "a", "d"]);
  });

  it("ranks a search instead", () => {
    expect(pickerModels(p, { favorites: [], hidden: [] }, "ta").map((m) => m.slug)).toEqual([
      "b",
      "d",
    ]);
  });

  it("names the traits chosen, Fast apart", () => {
    const options: ProviderModelOption[] = [
      {
        id: "reasoningEffort",
        label: "Effort",
        choices: [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ],
      },
      {
        id: "serviceTier",
        label: "Speed",
        choices: [
          { id: "std", label: "Standard", isDefault: true },
          { id: "fast", label: "Fast" },
        ],
      },
    ];
    expect(traitsLabel(options, {})).toEqual({
      label: "High",
      fast: false,
      accessible: "High",
    });
    expect(traitsLabel(options, { reasoningEffort: "low", serviceTier: "fast" })).toEqual({
      label: "Low",
      fast: true,
      accessible: "Low, Fast mode on",
    });
  });
});
