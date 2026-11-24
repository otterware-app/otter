import { describe, expect, it } from "vite-plus/test";
import { agentStatus, phoneNotificationsDescription } from "./agent-settings.ts";
import type { ProviderSnapshot } from "./api.ts";

const agent = (over: Partial<ProviderSnapshot>, settings: Record<string, unknown> = {}) =>
  ({
    id: "a",
    kind: "hermes",
    name: "brokk",
    enabled: true,
    installed: true,
    status: "ready",
    checkedAt: 1,
    models: [],
    model: null,
    ...over,
    settings: { enabled: true, model: "", ...settings },
  }) as unknown as ProviderSnapshot;

describe("agentStatus", () => {
  it("says where the agent is, in a word or two", () => {
    expect(agentStatus(agent({}))).toEqual({ text: "Connected", tone: "ready" });
    expect(agentStatus(agent({ enabled: false })).text).toBe("Off");
    expect(agentStatus(agent({ checkedAt: null })).text).toBe("Checking…");
    expect(agentStatus(agent({ installed: false, status: "warning" })).text).toBe("Not connected");
    expect(agentStatus(agent({ status: "error" }))).toEqual({
      text: "Not answering",
      tone: "failed",
    });
    expect(agentStatus(agent({ status: "warning" }, { pairingRequest: "req-1" })).text).toBe(
      "Waiting for approval",
    );
    expect(agentStatus(agent({ status: "warning" }, { pairingRequest: null })).text).toBe(
      "Not answering",
    );
  });
});

describe("phoneNotificationsDescription", () => {
  it("names what notifies for each choice", () => {
    expect(phoneNotificationsDescription("off")).toMatch(/^None, on any of your devices\./);
    expect(phoneNotificationsDescription("needs-you")).toMatch(/^Only approvals/);
    expect(phoneNotificationsDescription(null)).toMatch(/^Approvals, questions/);
  });
});
