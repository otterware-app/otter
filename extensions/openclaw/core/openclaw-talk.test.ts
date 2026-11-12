import type { TalkEvent } from "@otter/core/extension-kit";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../../packages/core/src/platform.js", () => ({
  platform: () => ({
    kind: "desktop",
    appVersion: "test",
    log: () => {},
    onResume: () => () => {},
  }),
}));

const { endAllTalks, endTalk, onTalkFrame, startTalk, talkAudio, talkReady, talksLost } =
  await import("./openclaw-talk.js");

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
  onTalkFrame("talk.event", { relaySessionId: "talk-1", ...payload });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => endAllTalks());

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
    const start = await startTalk(g, "agent:main:otter-mail:1", (e) => events.push(e));
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
    onTalkFrame("talk.event", { relaySessionId: "another", type: "ready" });
    expect(events).toEqual([
      { talkId: "talk-1", type: "ready" },
      { talkId: "talk-1", type: "audio", audio: "AAA=" },
      { talkId: "talk-1", type: "transcript", role: "user", text: "Hello", final: false },
      { talkId: "talk-1", type: "mark", name: "m1" },
    ]);
    await talkAudio("talk-1", "BBB=");
    expect(g.calls).toHaveBeenCalledWith(
      "talk.session.appendAudio",
      { sessionId: "talk-1", audioBase64: "BBB=" },
      { timeoutMs: 8_000 },
    );
  });

  it("asks the agent for a voice that can't, and gives the voice the agent's answer", async () => {
    const g = gateway((method) => (method === "talk.client.toolCall" ? { runId: "run-9" } : {}));
    await startTalk(g, "agent:main:otter-mail:1", () => {});
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
    onTalkFrame("chat", {
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

  it("ends with its connection, and hanging up leaves the agent's work going", async () => {
    const events: TalkEvent[] = [];
    const g = gateway();
    await startTalk(g, "s", (e) => events.push(e));
    talksLost(g.connection);
    expect(events).toEqual([
      { talkId: "talk-1", type: "closed", error: "Lost the connection to your gateway." },
    ]);

    const h = gateway();
    await startTalk(h, "s", () => {});
    await endTalk("talk-1");
    expect(h.calls).toHaveBeenCalledWith("talk.session.close", {
      sessionId: "talk-1",
      disposition: "detach",
    });
  });
});
