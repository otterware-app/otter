import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearedSession,
  noticeShows,
  pointerChat,
  pushPointer,
  pushShows,
  pushedChat,
} from "./notifications.ts";
import { useChats, type Conversation } from "./chat-store.ts";

describe("agents' notifications", () => {
  it("show what the setting says, as on the Mac", () => {
    expect(noticeShows("all", "finished")).toBe(true);
    expect(noticeShows("needs-you", "finished")).toBe(false);
    expect(noticeShows("needs-you", "approval")).toBe(true);
    expect(noticeShows("needs-you", "message")).toBe(true);
    expect(noticeShows("off", "question")).toBe(false);
  });

  it("read the chat a push points at, for this account only", () => {
    const push = (pointer: object, userId = "u") => ({
      version: 1,
      kind: "agent",
      userId,
      pointer,
    });
    const approval = {
      kind: "approval",
      agentId: "scout",
      sessionKey: "agent:scout:otter-mail:plan",
      approvalId: "ap-1",
    };
    expect(pushPointer(push(approval), "u")).toEqual({ ...approval, resolved: false });
    expect(pushPointer(push({ ...approval, resolved: true }), "u")?.resolved).toBe(true);
    expect(pushPointer(push(approval, "someone else"), "u")).toBeNull();
    expect(pushPointer(push({ kind: "unknown", agentId: "scout" }), "u")).toBeNull();
    expect(pushPointer(push({ kind: "message", agentId: "" }), "u")).toBeNull();
    expect(clearedSession({ kind: "agent-clear", userId: "u", sessionKey: "s" })).toBe("s");
    expect(clearedSession(push(approval))).toBeNull();
  });

  it("find the chat, and stay quiet about the one on screen", () => {
    const chat = { id: "c", sessionId: "agent:scout:otter-mail:plan" } as Conversation;
    const pointer = pushPointer(
      {
        kind: "agent",
        userId: "u",
        pointer: { kind: "question", agentId: "scout", sessionKey: chat.sessionId },
      },
      "u",
    )!;
    expect(pointerChat([chat], pointer)).toBe(chat);
    expect(pushShows(pointer, "all", chat)).toBe(false);
    expect(pushShows(pointer, "all", undefined)).toBe(true);
    expect(pushShows({ ...pointer, kind: "finished" }, "needs-you", undefined)).toBe(false);
  });
});

describe("a tapped push", () => {
  afterEach(() => {
    vi.useRealTimers();
    useChats.setState({ conversations: [] });
    delete (globalThis as { desktopBridge?: unknown }).desktopBridge;
  });

  const pointer = {
    kind: "message" as const,
    agentId: "scout",
    sessionKey: "agent:scout:otter:new",
    resolved: false,
  };

  it("opens the chat the agent makes for a session that had none", async () => {
    const made = {
      id: "scout-agent-scout-otter-new",
      sessionId: pointer.sessionKey,
    } as Conversation;
    const invoke = vi.fn(async () => {
      useChats.setState({ conversations: [made] });
      return { ok: true };
    });
    (globalThis as { desktopBridge?: unknown }).desktopBridge = { invoke };
    expect(await pushedChat(pointer)).toBe(made);
    expect(invoke).toHaveBeenCalledWith("agent:delivered", { sessionKey: pointer.sessionKey });
  });

  it("opens one already here without asking, and gives up on one that never comes", async () => {
    const here = { id: "c", sessionId: pointer.sessionKey } as Conversation;
    const invoke = vi.fn(async () => ({ ok: true }));
    (globalThis as { desktopBridge?: unknown }).desktopBridge = { invoke };
    useChats.setState({ conversations: [here] });
    expect(await pushedChat(pointer)).toBe(here);
    expect(invoke).not.toHaveBeenCalled();

    useChats.setState({ conversations: [] });
    vi.useFakeTimers();
    const none = pushedChat(pointer);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(await none).toBeNull();
  });
});
