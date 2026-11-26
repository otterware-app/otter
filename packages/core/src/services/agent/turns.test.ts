import { describe, expect, it, vi } from "vite-plus/test";

const outcomes: Record<string, unknown> = {};
const provider = {
  sendTurn: async (input: { requestId: string; input: string }, _: unknown, emit: Function) => {
    const outcome = outcomes[input.input];
    if (outcome instanceof Error) throw outcome;
    emit({ requestId: input.requestId, ...(outcome as object) });
  },
};
const types = new Map([
  [
    "openclaw",
    {
      kind: "openclaw",
      displayName: "OpenClaw",
      defaults: { enabled: true },
      create: () => provider,
    },
  ],
]);
vi.mock("../../extensions.ts", () => ({ registeredAgents: () => types }));
vi.mock("./settings.ts", () => ({
  agentSecrets: () => ({}),
  getProviderSettings: async () => ({
    selected: "home",
    agents: [{ id: "home", kind: "openclaw", name: "Home", settings: {} }],
  }),
}));
const broadcast = vi.fn();
vi.mock("../../ipc.ts", () => ({ broadcast }));
const failure = vi.fn();
vi.mock("../../logger.ts", () => ({ logger: { info: vi.fn(), failure } }));

const { sendTurn } = await import("./service.ts");

async function send(input: string, outcome: unknown) {
  outcomes[input] = outcome;
  failure.mockClear();
  await sendTurn("home", { requestId: input, input } as never);
  await new Promise((resolve) => setTimeout(resolve));
}

describe("an agent's turn", () => {
  it("reports how it failed, tagged with the agent", async () => {
    await send("a", { type: "error", message: "agent_error: model overloaded" });
    expect(failure).toHaveBeenCalledWith(
      "agent",
      "An agent's turn failed",
      new Error("agent_error: model overloaded"),
      { agent: "openclaw", phase: "turn" },
    );
  });

  it("doesn't report what the user did or has to fix", async () => {
    await send("b", { type: "error", message: "cancelled" });
    await send("c", { type: "error", message: "unauthorized" });
    await send("d", { type: "done", responseId: null });
    expect(failure).not.toHaveBeenCalled();
  });

  it("reports a crash once and tells the chat", async () => {
    const crash = new Error("boom");
    await send("e", crash);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith("agent", "An agent's turn crashed", crash, {
      agent: "openclaw",
      phase: "turn",
    });
    expect(broadcast).toHaveBeenCalledWith("agent:chatEvent", {
      requestId: "e",
      type: "error",
      message: "unreachable",
    });
  });
});
