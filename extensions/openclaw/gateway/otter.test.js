import { describe, expect, it, vi } from "vite-plus/test";
import {
  accountOf,
  chatOf,
  chatTarget,
  deliver,
  finishedOf,
  isNewChat,
  isOwnerConfigured,
  messageOf,
  newChatKey,
  otterTargetsNote,
  pointerOf,
  startDetached,
  targetOf,
  tell,
  titled,
} from "./otter.js";

describe("the Otter channel plugin", () => {
  it("delivers only to one of Otter's chats, or a new one each time, like Slack", () => {
    const chat = "agent:main:otter-mail:c-1";
    expect(chatOf(chatTarget(chat))).toBe(chat);
    expect(chatOf(`otter:${chatTarget(chat)}`)).toBe(chat);
    expect(chatOf("chat:new")).toBeUndefined();
    expect(chatOf("chat:not-a-session")).toBeUndefined();
    expect(targetOf(chatTarget(chat))).toBe(chatTarget(chat));
    expect(targetOf("chat:new")).toBe("chat:new");
    expect(targetOf("otter:chat:new")).toBe("chat:new");
    // What's sent to the owner names no chat: it starts one.
    expect(targetOf("otter:owner")).toBe("chat:new");
    expect(isNewChat("owner")).toBe(true);
    for (const old of ["inbox", "new", "", undefined]) expect(targetOf(old)).toBeUndefined();
    expect(pointerOf({ sessionKey: "agent:main:cron:1", to: chatTarget(chat), at: 4 })).toEqual({
      kind: "message",
      agentId: "main",
      sessionKey: chat,
      at: 4,
    });
    // The gateway routes a delivery to "chat:new" to a new chat's session, and sends it with that key.
    const fresh = newChatKey("rowan", "n-1");
    expect(fresh).toBe("agent:rowan:otter-mail:n-1");
    expect(pointerOf({ sessionKey: fresh, to: "chat:new", at: 6 })).toEqual({
      kind: "message",
      agentId: "rowan",
      sessionKey: fresh,
      at: 6,
    });
  });

  it("tells an agent in an Otter chat where it can deliver, this chat included", () => {
    const note = otterTargetsNote("agent:main:otter-mail:c-1");
    expect(note).toContain('"chat:agent:main:otter-mail:c-1": this chat');
    expect(note).toContain('"chat:new"');
    expect(note).not.toContain("inbox");
    expect(otterTargetsNote(undefined)).toContain('"chat:<session key>": this chat');
  });

  it("sends as the owner only once commands.ownerAllowFrom lists otter:owner", () => {
    expect(isOwnerConfigured({})).toBe(false);
    expect(isOwnerConfigured({ commands: { ownerAllowFrom: ["telegram:1", "*"] } })).toBe(false);
    expect(isOwnerConfigured({ commands: { ownerAllowFrom: ["telegram:1", "otter:owner"] } })).toBe(
      true,
    );
  });

  it("takes a message for an agent's session, with its key, text or files", () => {
    const sessionKey = "agent:rowan:otter-mail:c-1";
    expect(messageOf({ sessionKey, message: "Hi", idempotencyKey: "k-1" })).toEqual({
      sessionKey,
      agentId: "rowan",
      text: "Hi",
      messageId: "k-1",
      files: [],
    });
    const file = { content: "aGk=", mimeType: "image/png", fileName: "a.png" };
    expect(messageOf({ sessionKey, idempotencyKey: "k-2", attachments: [file] }).files).toEqual([
      file,
    ]);
    expect(() => messageOf({ sessionKey: "main", message: "Hi", idempotencyKey: "k" })).toThrow();
    expect(() => messageOf({ sessionKey, message: "Hi" })).toThrow();
    expect(() => messageOf({ sessionKey, message: " ", idempotencyKey: "k" })).toThrow();
    expect(() =>
      messageOf({ sessionKey, idempotencyKey: "k", attachments: [{ content: "x" }] }),
    ).toThrow();
  });

  it("points at where a cron job's message is kept, never sending its text", () => {
    const pointer = pointerOf({
      sessionKey: "agent:rowan:otter-mail:n-2",
      to: "chat:new",
      payload: { text: "Your bank statement is ready." },
      at: 5,
    });
    expect(pointer).toEqual({
      kind: "message",
      agentId: "rowan",
      sessionKey: "agent:rowan:otter-mail:n-2",
      at: 5,
    });
    expect(JSON.stringify(pointer)).not.toContain("bank");
  });

  it("points at an approval or a question by its id, in the session that asked", () => {
    expect(
      pointerOf({
        payload: {
          text: "Allow rm -rf build?",
          channelData: {
            execApproval: {
              approvalId: "ap-1",
              approvalKind: "exec",
              agentId: "main",
              sessionKey: "agent:main:otter-mail:c-1",
              state: "pending",
            },
          },
        },
        at: 1,
      }),
    ).toEqual({
      kind: "approval",
      agentId: "main",
      sessionKey: "agent:main:otter-mail:c-1",
      approvalId: "ap-1",
      approvalKind: "exec",
      resolved: false,
      at: 1,
    });
    expect(
      pointerOf({
        sessionKey: "agent:main:main",
        payload: { channelData: { askUser: { questionId: "q-1" } } },
        at: 2,
      }),
    ).toEqual({
      kind: "question",
      agentId: "main",
      sessionKey: "agent:main:main",
      questionId: "q-1",
      at: 2,
    });
  });

  it("tells the relay with the channel's token, and nothing without one", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 202 }));
    const account = accountOf({
      channels: { otter: { relayUrl: "https://relay.test/", token: "otter_ch_x" } },
    });
    const pointer = pointerOf({ sessionKey: "agent:main:cron:1", at: 3 });
    expect(await tell(account, pointer, { fetch })).toBe(true);
    expect(fetch).toHaveBeenCalledWith("https://relay.test/channel/v1/pointers", {
      method: "POST",
      signal: undefined,
      headers: { "content-type": "application/json", authorization: "Bearer otter_ch_x" },
      body: JSON.stringify(pointer),
    });
    expect(await tell(accountOf({ channels: { otter: {} } }), pointer, { fetch })).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("tells the relay a run finished in one of Otter's chats, and of no other run", () => {
    const chat = "agent:main:otter-mail:c-1";
    const finished = { kind: "finished", agentId: "main", sessionKey: chat, at: 5 };
    expect(finishedOf({ sessionKey: chat, trigger: "user" }, 5)).toEqual(finished);
    // A session of the agent's own that you wrote to from Otter.
    expect(finishedOf({ sessionKey: "agent:rowan:main", channel: "otter" }, 5)).toEqual({
      ...finished,
      agentId: "rowan",
      sessionKey: "agent:rowan:main",
    });
    for (const other of [
      { sessionKey: "agent:main:main", channel: "telegram", trigger: "user" },
      { sessionKey: "agent:main:subagent:s-1", channel: "otter" },
      // What a schedule ran tells Otter with its delivery.
      { sessionKey: chat, jobId: "job-1" },
      { sessionKey: chat, trigger: "cron" },
      { sessionKey: chat, trigger: "heartbeat" },
      { sessionKey: chat, trigger: "memory" },
      { sessionKey: "not-a-session", channel: "otter" },
      {},
      undefined,
    ])
      expect(finishedOf(other)).toBeUndefined();
  });

  it("names the chat and the agent for an iPhone's alert, and goes without them if it can't", async () => {
    const pointer = finishedOf({ sessionKey: "agent:rowan:otter-mail:c-1", channel: "otter" }, 7);
    const look = vi.fn(async () => ({ title: "  Deploy the site ", agentName: "Rowan" }));
    expect(await titled(pointer, look)).toEqual({
      ...pointer,
      title: "Deploy the site",
      agentName: "Rowan",
    });
    expect(look).toHaveBeenCalledWith(pointer);
    const long = await titled(pointer, () => ({ title: "x".repeat(300), agentName: "" }));
    expect(long.title).toHaveLength(200);
    expect(long).not.toHaveProperty("agentName");
    for (const broken of [
      () => {
        throw new Error("no store");
      },
      async () => {
        throw new Error("no store");
      },
      () => undefined,
      undefined,
    ])
      expect(await titled(pointer, broken)).toEqual(pointer);
  });

  it("delivers even when the relay can't be told", async () => {
    const cfg = { channels: { otter: { relayUrl: "https://relay.test", token: "otter_ch_x" } } };
    const ctx = { cfg, sessionKey: "agent:main:otter-mail:c-1", to: "chat:new" };
    const warn = vi.fn();
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    expect(await deliver(ctx, undefined, { warn, fetch })).toMatchObject({ channel: "otter" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("401"));
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(deliver(ctx, undefined, { warn, fetch: down })).resolves.toBeDefined();
    const aborted = { ...ctx, signal: AbortSignal.abort() };
    await expect(deliver(aborted, undefined, { warn, fetch: down })).rejects.toThrow();
  });

  it("fails a message from Otter that can't start, and runs one that can apart from the request", async () => {
    const detached = [];
    const detach = (work) => void detached.push(work());
    await expect(
      startDetached(
        detach,
        async () => {
          throw new Error("media refused");
        },
        vi.fn(),
      ),
    ).rejects.toThrow("media refused");

    let finish;
    const run = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    await startDetached(detach, async () => "ctx", run);
    expect(run).toHaveBeenCalledWith("ctx");
    finish();

    const warn = vi.fn();
    await startDetached(
      detach,
      async () => "ctx",
      async () => Promise.reject(new Error("x")),
      warn,
    );
    await Promise.all(detached);
    expect(warn).toHaveBeenCalledWith(new Error("x"));

    await expect(
      startDetached(
        (_work, fail) => fail(new Error("busy")),
        async () => "ctx",
        vi.fn(),
      ),
    ).rejects.toThrow("busy");
  });
});
