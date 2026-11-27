import type { TalkEvent } from "@otter/core/extension-kit";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../../packages/core/src/platform.ts", () => ({
  platform: () => ({
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    onResume: () => () => {},
  }),
}));

const { createTalks, talkReady } = await import("./openclaw-talk.ts");
let talks = createTalks();

const created = {
  sessionId: "talk-1",
  relaySessionId: "talk-1",
  audio: {
    inputEncoding: "pcm16",
    inputSampleRateHz: 24_000,
    outputEncoding: "pcm16",
    outputSampleRateHz: 24_000,
  },
};

function gateway(
  answer: (method: string, params: Record<string, unknown>) => unknown = () => ({}),
) {
  const request = vi.fn(async (method: string, params: unknown) =>
    method === "talk.session.create" ? created : answer(method, params as Record<string, unknown>),
  );
  return { connection: {}, request: request as never, detaches: true, calls: request };
}

const relay = (payload: object) =>
  talks.onTalkFrame("talk.event", { relaySessionId: "talk-1", ...payload });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  talks.endAllTalks();
  talks = createTalks();
});

describe("a call with OpenClaw", () => {
  it("is offered only when the gateway has a realtime voice that streams through it", async () => {
    const catalog = (configured: boolean) =>
      gateway(() => ({
        realtime: {
          ready: true,
          providers: [
            { configured, transports: ["webrtc", "gateway-relay"], brains: ["agent-consult"] },
          ],
        },
      }));
    expect(await talkReady(catalog(true))).toBe(true);
    expect(await talkReady(catalog(false))).toBe(false);
  });

  it("starts in the chat's session and passes on what the gateway says, its own echo aside", async () => {
    const g = gateway();
    const events: TalkEvent[] = [];
    const start = await talks.startTalk(g, "agent:main:otter-mail:1", (e) => events.push(e));
    expect(start).toEqual({
      talkId: "talk-1",
      sessionId: "agent:main:otter-mail:1",
      inputRate: 24_000,
      outputRate: 24_000,
    });
    expect(g.calls).toHaveBeenCalledWith(
      "talk.session.create",
      expect.objectContaining({
        sessionKey: "agent:main:otter-mail:1",
        transport: "gateway-relay",
        brain: "agent-consult",
      }),
    );
    relay({ type: "ready" });
    relay({ type: "inputAudio", byteLength: 1920 });
    relay({ type: "audio", audioBase64: "AAA=" });
    relay({ type: "transcript", role: "user", text: "Hello", final: false });
    relay({ type: "mark", markName: "m1" });
    talks.onTalkFrame("talk.event", { relaySessionId: "another", type: "ready" });
    expect(events).toEqual([
      { talkId: "talk-1", type: "ready" },
      { talkId: "talk-1", type: "audio", audio: "AAA=" },
      { talkId: "talk-1", type: "transcript", role: "user", text: "Hello", final: false },
      { talkId: "talk-1", type: "mark", name: "m1" },
    ]);
    await talks.talkAudio("talk-1", "BBB=");
    expect(g.calls).toHaveBeenCalledWith(
      "talk.session.appendAudio",
      { sessionId: "talk-1", audioBase64: "BBB=", timestamp: expect.any(Number) },
      { timeoutMs: 30_000 },
    );
  });

  it("ends when the gateway stops taking its audio", async () => {
    const events: TalkEvent[] = [];
    const g = gateway((method) => {
      if (method === "talk.session.appendAudio") throw new Error("timeout");
      return {};
    });
    await talks.startTalk(g, "s", (e) => events.push(e));
    await talks.talkAudio("talk-1", "BBB=");
    expect(events).toEqual([
      {
        talkId: "talk-1",
        type: "closed",
        error: "Your gateway stopped taking the call's audio. Start the call again.",
      },
    ]);
    expect(g.calls).toHaveBeenCalledWith("talk.session.close", {
      sessionId: "talk-1",
      disposition: "detach",
    });
  });

  it("asks the agent for a voice that can't, and gives the voice the agent's answer", async () => {
    const g = gateway((method) => (method === "talk.client.toolCall" ? { runId: "run-9" } : {}));
    await talks.startTalk(g, "agent:main:otter-mail:1", () => {});
    relay({
      type: "toolCall",
      callId: "call-1",
      name: "openclaw_agent_consult",
      args: '{"question":"Date?"}',
    });
    await tick();
    expect(g.calls).toHaveBeenCalledWith("talk.client.toolCall", {
      sessionKey: "agent:main:otter-mail:1",
      callId: "call-1",
      name: "openclaw_agent_consult",
      args: { question: "Date?" },
      relaySessionId: "talk-1",
    });
    talks.onTalkFrame("chat", {
      runId: "run-9",
      state: "final",
      message: { content: [{ type: "text", text: "Thursday." }] },
    });
    await tick();
    expect(g.calls).toHaveBeenCalledWith("talk.session.submitToolResult", {
      sessionId: "talk-1",
      callId: "call-1",
      result: { result: "Thursday." },
    });
    // A tool calls don't have is refused at once.
    relay({ type: "toolCall", callId: "call-2", name: "describe_view" });
    await tick();
    expect(g.calls).toHaveBeenCalledWith("talk.session.submitToolResult", {
      sessionId: "talk-1",
      callId: "call-2",
      result: { error: "Otter's calls don't have describe_view." },
    });
  });

  it("steers the agent's work when the voice asks after it, changes it or stops it", async () => {
    const g = gateway((method) =>
      method === "talk.session.steer" ? { ok: true, mode: "status", message: "Still on it." } : {},
    );
    await talks.startTalk(g, "agent:main:otter-mail:1", () => {});
    relay({
      type: "toolCall",
      callId: "call-3",
      name: "openclaw_agent_control",
      args: '{"text":"is it done?","mode":"status"}',
    });
    await tick();
    expect(g.calls).toHaveBeenCalledWith("talk.session.steer", {
      sessionId: "talk-1",
      sessionKey: "agent:main:otter-mail:1",
      text: "is it done?",
      mode: "status",
    });
    expect(g.calls).toHaveBeenCalledWith("talk.session.submitToolResult", {
      sessionId: "talk-1",
      callId: "call-3",
      result: { ok: true, mode: "status", message: "Still on it." },
    });
  });

  it("tells a forced consult's voice to wait, and holds the answer until it has finished speaking", async () => {
    const g = gateway((method) => (method === "talk.client.toolCall" ? { runId: "run-1" } : {}));
    await talks.startTalk(g, "s", () => {});
    relay({
      type: "toolCall",
      callId: "c1",
      name: "openclaw_agent_consult",
      args: {},
      forced: true,
    });
    await tick();
    expect(g.calls).toHaveBeenCalledWith(
      "talk.session.submitToolResult",
      expect.objectContaining({
        callId: "c1",
        result: expect.objectContaining({ status: "working" }),
        options: { willContinue: true },
      }),
    );
    relay({ type: "audio", audioBase64: "AAA=", talkEvent: { turnId: "t1" } });
    relay({ type: "mark", markName: "m1" });
    talks.onTalkFrame("chat", {
      runId: "run-1",
      state: "final",
      message: { content: [{ type: "text", text: "Done." }] },
    });
    await tick();
    const answered = () =>
      g.calls.mock.calls.some(
        ([method, params]) =>
          method === "talk.session.submitToolResult" &&
          (params as { result: { result?: string } }).result.result === "Done.",
      );
    expect(answered()).toBe(false);
    await talks.talkPlayed("talk-1", "m1");
    await tick();
    expect(answered()).toBe(true);
  });

  it("ignores a stale clear, and a cancelled turn cancels its consult", async () => {
    const events: TalkEvent[] = [];
    const g = gateway((method) => (method === "talk.client.toolCall" ? { runId: "run-2" } : {}));
    await talks.startTalk(g, "s", (e) => events.push(e));
    relay({ type: "audio", audioBase64: "AAA=", talkEvent: { turnId: "t2" } });
    relay({ type: "clear", talkEvent: { turnId: "t1" } });
    expect(events.some((e) => e.type === "clear")).toBe(false);
    relay({ type: "toolCall", callId: "c2", name: "openclaw_agent_consult", args: {} });
    await tick();
    relay({ type: "clear", talkEvent: { turnId: "t2", type: "turn.cancelled" } });
    await tick();
    expect(events.at(-1)).toEqual({ talkId: "talk-1", type: "clear" });
    expect(g.calls).toHaveBeenCalledWith("talk.session.submitToolResult", {
      sessionId: "talk-1",
      callId: "c2",
      result: { status: "cancelled", message: "Cancelled the active OpenClaw run." },
    });
  });

  it("sends nothing back for a call the gateway cancelled", async () => {
    const g = gateway((method) => (method === "talk.client.toolCall" ? { runId: "run-3" } : {}));
    await talks.startTalk(g, "s", () => {});
    relay({ type: "toolCall", callId: "c3", name: "openclaw_agent_consult", args: {} });
    await tick();
    relay({ type: "toolCallCancelled", callId: "c3" });
    talks.onTalkFrame("chat", { runId: "run-3", state: "final", message: { content: [] } });
    await tick();
    expect(g.calls.mock.calls.some(([m]) => m === "talk.session.submitToolResult")).toBe(false);
  });

  it("knows what the agent does for it until that's done, after the call too", async () => {
    await talks.startTalk(gateway(), "agent:main:otter-mail:1", () => {});
    const lifecycle = (sessionKey: string, runId: string, phase: string) =>
      talks.onTalkFrame("agent", { sessionKey, runId, stream: "lifecycle", data: { phase } });
    lifecycle("agent:main:otter-mail:1", "consult-1", "start");
    lifecycle("agent:main:otter-mail:2", "elsewhere", "start");
    await talks.endTalk("talk-1");
    expect(talks.isCallWork("consult-1")).toBe(true);
    expect(talks.isCallWork("elsewhere")).toBe(false);
    lifecycle("agent:main:otter-mail:1", "consult-1", "end");
    expect(talks.isCallWork("consult-1")).toBe(false);
  });

  it("ends with its connection, and hanging up leaves the agent's work going", async () => {
    const events: TalkEvent[] = [];
    const g = gateway();
    await talks.startTalk(g, "s", (e) => events.push(e));
    talks.talksLost(g.connection);
    expect(events).toEqual([
      { talkId: "talk-1", type: "closed", error: "Lost the connection to your gateway." },
    ]);

    const h = gateway();
    await talks.startTalk(h, "s", () => {});
    await talks.endTalk("talk-1");
    expect(h.calls).toHaveBeenCalledWith("talk.session.close", {
      sessionId: "talk-1",
      disposition: "detach",
    });
  });
});
