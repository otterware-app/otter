import { describe, expect, it, vi } from "vite-plus/test";
import manifest from "./openclaw.plugin.json" with { type: "json" };
import { createToolBroker, OTTER_TOOLS, POLL_MS, toolResult } from "./tools.js";

const tool = (name) => ({ name, title: name, description: `${name}.`, input: { type: "object" } });
const mail = [tool("search_mail"), tool("send_email")];
const mac = [...mail, tool("browser_open")];

describe("Otter's tools on the gateway", () => {
  it("are the ones the manifest declares", () => {
    expect(manifest.contracts.tools).toEqual(OTTER_TOOLS);
  });

  it("offers a tool only while a device that has it is asking for calls", async () => {
    let t = 0;
    const tools = createToolBroker({ now: () => t });
    expect(tools.describe("search_mail")).toBeUndefined();
    await tools.next({ device: "mac", tools: mac, waitMs: 0 });
    expect(tools.describe("browser_open")?.description).toBe("browser_open.");
    // A name Otter's tools don't have is dropped.
    await tools.next({ device: "mac", tools: [...mac, tool("rm_rf")], waitMs: 0 });
    expect(tools.describe("rm_rf")).toBeUndefined();
    t += POLL_MS * 2;
    expect(tools.describe("search_mail")).toBeUndefined();
    expect(await tools.call("search_mail", {}, "s", "r", undefined)).toEqual({
      text: "Otter isn't open on any of the user's devices.",
      isError: true,
    });
  });

  it("hands a call to the device asking, and answers with what it says", async () => {
    const tools = createToolBroker();
    const polled = tools.next({ device: "mac", tools: mac, waitMs: POLL_MS });
    const answer = tools.call("search_mail", { query: "lease" }, "agent:main:otter-mail:c", "r1");
    const [call] = await polled;
    expect(call).toEqual({
      callId: call.callId,
      name: "search_mail",
      args: { query: "lease" },
      sessionKey: "agent:main:otter-mail:c",
      runId: "r1",
    });
    // Only once it's taken, by the device it was given to.
    expect(tools.result({ callId: call.callId, device: "mac", text: "early" })).toBe(false);
    expect(tools.result({ callId: call.callId, device: "web", taken: true })).toBe(false);
    expect(tools.result({ callId: call.callId, device: "mac", taken: true })).toBe(true);
    // A claim asked again (its answer was lost) still holds.
    expect(tools.result({ callId: call.callId, device: "mac", taken: true })).toBe(true);
    expect(tools.result({ callId: call.callId, device: "mac", text: '{"threads":[]}' })).toBe(true);
    expect(await answer).toEqual({ text: '{"threads":[]}', isError: false });
    // Answered once.
    expect(tools.result({ callId: call.callId, device: "mac", text: "again" })).toBe(false);
  });

  it("keeps a call for a device between its polls", async () => {
    const tools = createToolBroker();
    await tools.next({ device: "mac", tools: mac, waitMs: 0 });
    const answer = tools.call("browser_open", { url: "otter.app" }, "s", "r");
    const [call] = await tools.next({ device: "mac", tools: mac, waitMs: POLL_MS });
    tools.result({ callId: call.callId, device: "mac", taken: true });
    tools.result({
      callId: call.callId,
      device: "mac",
      image: { image: "png", mimeType: "image/png" },
    });
    expect(await answer).toEqual({
      text: "",
      image: { image: "png", mimeType: "image/png" },
      isError: false,
    });
  });

  it("sends a call to the device the chat's message came from, else the one with the most tools", async () => {
    const tools = createToolBroker();
    const web = tools.next({ device: "web", tools: mail, waitMs: POLL_MS });
    const onMac = tools.next({ device: "mac", tools: mac, waitMs: POLL_MS });
    tools.sentFrom("run-w", "web");
    void tools.call("search_mail", {}, "chat-w", "run-w", undefined);
    expect((await web)[0].name).toBe("search_mail");
    void tools.next({ device: "web", tools: mail, waitMs: POLL_MS });
    void tools.call("search_mail", {}, "chat-other", "r", undefined);
    expect((await onMac)[0].sessionKey).toBe("chat-other");
  });

  it("moves a call no one picked up to another device", async () => {
    vi.useFakeTimers();
    try {
      const tools = createToolBroker();
      // The Mac went to sleep between polls; the web app is asking.
      const polled = tools.next({ device: "mac", tools: mac, waitMs: 0 });
      await vi.advanceTimersByTimeAsync(0);
      await polled;
      const web = tools.next({ device: "web", tools: mail, waitMs: POLL_MS });
      const answer = tools.call("send_email", { to: "a@b.c" }, "s", "r", undefined);
      await vi.advanceTimersByTimeAsync(15_000);
      const [call] = await web;
      expect(call.name).toBe("send_email");
      // The Mac waking up late can't run it too.
      expect(tools.result({ callId: call.callId, device: "mac", taken: true })).toBe(false);
      expect(tools.result({ callId: call.callId, device: "web", taken: true })).toBe(true);
      tools.result({ callId: call.callId, device: "web", text: "sent" });
      expect(await answer).toEqual({ text: "sent", isError: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a device that took a call and went silent", async () => {
    vi.useFakeTimers();
    try {
      const tools = createToolBroker();
      const polled = tools.next({ device: "mac", tools: mac, waitMs: POLL_MS });
      const answer = tools.call("search_mail", {}, "s", "r", undefined);
      const [call] = await polled;
      tools.result({ callId: call.callId, device: "mac", taken: true });
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(await answer).toEqual({ text: "Otter didn't answer in time.", isError: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends a call the agent stopped waiting for, and doesn't hand it out", async () => {
    const tools = createToolBroker();
    await tools.next({ device: "mac", tools: mac, waitMs: 0 });
    const stop = new AbortController();
    const answer = tools.call("search_mail", {}, "s", "r", stop.signal);
    stop.abort();
    expect(await answer).toEqual({ text: "The call was cancelled.", isError: true });
    expect(await tools.next({ device: "mac", tools: mac, waitMs: 0 })).toEqual([]);
  });

  it("reads as the agent's tool result: a picture, text, or an error", () => {
    expect(toolResult({ text: "ok", isError: false })).toEqual({
      content: [{ type: "text", text: "ok" }],
    });
    expect(toolResult({ image: { image: "b", mimeType: "image/png" }, isError: false })).toEqual({
      content: [{ type: "image", data: "b", mimeType: "image/png" }],
    });
    expect(() => toolResult({ text: "No such thread.", isError: true })).toThrow("No such thread.");
  });
});
