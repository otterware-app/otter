import { describe, expect, it } from "vite-plus/test";
import { canRunChat, canStartChat, enabledModels, startingModel } from "./agent-providers.ts";
import type { ProviderSnapshot } from "./api.ts";
import { agentNameOf } from "./chat-list.ts";

const gateway = (disabledAgents: string[]) =>
  ({
    id: "gw",
    kind: "openclaw",
    name: "Studio",
    enabled: true,
    installed: true,
    status: "ready",
    checkedAt: 1,
    models: [
      { slug: "main", name: "Main", isDefault: true },
      { slug: "research", name: "Research" },
    ],
    model: "research",
    settings: { enabled: true, model: "research", disabledAgents },
  }) as unknown as ProviderSnapshot;

describe("a gateway's agents turned off", () => {
  it("stay named, but run no chat and start none", () => {
    const research = "agent:research:otter-mail:existing";
    expect(canRunChat(gateway([]), research)).toBe(true);

    const off = gateway(["research"]);
    expect(off.models.map((m) => m.slug)).toEqual(["main", "research"]);
    expect(enabledModels(off).map((m) => m.slug)).toEqual(["main"]);
    expect(startingModel(off)).toBe("main");
    expect(canRunChat(off, research)).toBe(false);
    expect(agentNameOf({ providers: [off], others: [] }, "gw", "research")).toBe("Research");

    const allOff = gateway(["main", "research"]);
    expect(canStartChat(allOff)).toBe(false);
    expect(canRunChat(allOff, null)).toBe(false);
    expect(canStartChat(gateway(["main"]))).toBe(true);
    expect(startingModel(gateway(["main"]))).toBe("research");
  });
});

describe("a chat's agent by name", () => {
  it("names one this device can't run, from the account", () => {
    const agents = { providers: [], others: [{ id: "cc", name: "Claude", kind: "claude" }] };
    expect(agentNameOf(agents, "cc", null)).toBe("Claude");
    expect(agentNameOf(agents, "gone", null)).toBe("Removed agent");
    expect(agentNameOf(agents, "gone", "main")).toBe("Removed agent");
  });
});
