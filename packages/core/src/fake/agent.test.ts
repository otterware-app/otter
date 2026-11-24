import { describe, expect, it } from "vite-plus/test";

import type { ChatEvent } from "../services/agent/types.ts";
import { scriptedAgent } from "./agent.ts";
import { DEMO_AGENTS, STUDIO_SESSIONS } from "./chats.ts";

const turn = (kind: string, input: string, settings = {}) => {
  const provider = scriptedAgent(DEMO_AGENTS.studio, kind);
  const events: ChatEvent[] = [];
  const done = provider.sendTurn({ requestId: "r1234567890", input }, settings as never, (e) =>
    events.push(e),
  );
  return { provider, events, done };
};

describe("the scripted agent", () => {
  it("waits on a subagent when asked to delegate, then answers", async () => {
    const { events, done } = turn("hermes", "delegate the venue research");
    await done;
    const waits = events.filter((e) => e.type === "waiting");
    expect(waits.map((e) => e.type === "waiting" && e.subagents)).toEqual([
      ["Research venue prices"],
      null,
    ]);
    expect(events.at(-1)?.type).toBe("done");
  }, 15_000);

  it("stops while it waits", async () => {
    const { provider, events, done } = turn("hermes", "delegate both");
    while (!events.some((e) => e.type === "waiting")) await new Promise((r) => setTimeout(r, 50));
    provider.cancel("r1234567890");
    await done;
    expect(events.filter((e) => e.type === "waiting")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "error", message: "cancelled" });
  });

  it("starts a gateway's session on its agent that's on", async () => {
    const { provider, events } = turn("openclaw", "hello", { disabledAgents: ["main"] });
    expect(events[0]).toMatchObject({
      type: "session",
      sessionId: "agent:research:otter-mail:demo-r1234567",
    });
    provider.shutdown();
    const [session] = Object.keys(STUDIO_SESSIONS);
    expect(await provider.readSession({} as never, session!)).toHaveLength(2);
  });
});
