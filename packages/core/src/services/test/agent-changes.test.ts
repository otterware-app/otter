import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatEvent } from "../agent/types.ts";

const state = vi.hoisted(() => ({
  failDraft: false,
  failThread: null as string | null,
  onSave: null as (() => void) | null,
  refreshed: false,
}));

vi.mock("../../logger.ts", () => ({ logger: { info: vi.fn() } }));

vi.mock("../../ipc.ts", () => ({
  registeredHandlers: () =>
    new Map<string, (args: Record<string, unknown>) => unknown>([
      ["gmail:listAccounts", () => [{ id: "home", email: "me@home.example" }]],
      ["gmail:listLabels", () => [{ id: "label-1", name: "Receipts" }]],
      [
        "gmail:saveDraft",
        () => {
          if (state.failDraft) throw new Error("Couldn't save");
          state.onSave?.();
          return { draftId: "draft-1", threadId: "thread-1" };
        },
      ],
      [
        "gmail:modifyThread",
        ({ threadId }) => {
          if (state.failThread === threadId) throw new Error("Couldn't update");
          state.refreshed = true;
          return { ok: true };
        },
      ],
      ["gmail:createLabel", () => ({ id: "label-1", name: "Receipts" })],
    ]),
}));

vi.mock("../mail-store.ts", () => ({
  getThreadMessages: (_accountId: string, threadId: string) => [
    { subject: state.refreshed ? "" : `Subject ${threadId}` },
  ],
}));

const { runAgentTool, answerToolApproval } = await import("../agent/tools/index.ts");

beforeEach(() => {
  state.failDraft = false;
  state.failThread = null;
  state.onSave = null;
  state.refreshed = false;
});

describe("agent changes", () => {
  it("records created and edited drafts independently of the tool's input preview", async () => {
    const events: ChatEvent[] = [];
    const caller = {
      mode: () => "full-access" as const,
      turn: () => ({ requestId: "run-1", emit: (event: ChatEvent) => events.push(event) }),
    };
    const args = { body: "A".repeat(5000), subject: "Dinner Saturday", to: "maya@example.com" };
    expect((await runAgentTool(caller, "save_draft", args)).isError).toBe(false);
    expect(
      (await runAgentTool(caller, "save_draft", { ...args, draftId: "draft-1" })).isError,
    ).toBe(false);
    expect(events).toEqual([
      {
        requestId: "run-1",
        type: "change",
        change: {
          action: "created",
          title: "Dinner Saturday",
          target: { kind: "draft", id: "draft-1", accountId: "home" },
        },
      },
      {
        requestId: "run-1",
        type: "change",
        change: {
          action: "updated",
          title: "Dinner Saturday",
          target: { kind: "draft", id: "draft-1", accountId: "home" },
        },
      },
    ]);
  });

  it("doesn't claim a failed save created a draft", async () => {
    state.failDraft = true;
    const emit = vi.fn();
    const result = await runAgentTool(
      { mode: () => "full-access", turn: () => ({ requestId: "run-1", emit }) },
      "save_draft",
      { subject: "Dinner" },
    );
    expect(result.isError).toBe(true);
    expect(emit).not.toHaveBeenCalled();
  });

  it("keeps confirmed changes when a later conversation in the batch fails", async () => {
    state.failThread = "second";
    const emit = vi.fn();
    const result = await runAgentTool(
      { mode: () => "full-access", turn: () => ({ requestId: "run-1", emit }) },
      "update_threads",
      { threadIds: ["first", "second"], read: true },
    );
    expect(result.isError).toBe(true);
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      requestId: "run-1",
      type: "change",
      change: {
        action: "updated",
        title: "Subject first",
        target: { kind: "thread", id: "first", accountId: "home" },
      },
    });
  });

  it.each([
    { archive: true },
    { moveToInbox: true },
    { read: true },
    { read: false },
    { starred: true },
    { starred: false },
    { addLabels: ["Receipts"] },
    { removeLabels: ["Receipts"] },
  ])("records conversation changes for %j", async (operation) => {
    const emit = vi.fn();
    const result = await runAgentTool(
      { mode: () => "full-access", turn: () => ({ requestId: "run-1", emit }) },
      "update_threads",
      { threadIds: ["first"], ...operation },
    );
    expect(result.isError).toBe(false);
    expect(emit).toHaveBeenCalledExactlyOnceWith({
      requestId: "run-1",
      type: "change",
      change: {
        action: "updated",
        title: "Subject first",
        target: { kind: "thread", id: "first", accountId: "home" },
      },
    });
  });

  it("doesn't list changes the user declined", async () => {
    const events: ChatEvent[] = [];
    const emit = (event: ChatEvent) => {
      events.push(event);
      if (event.type === "approval") answerToolApproval(event.approval.id, "deny");
    };
    const result = await runAgentTool(
      { mode: () => "approval-required", turn: () => ({ requestId: "run-1", emit }) },
      "create_label",
      { name: "Receipts" },
    );
    expect(result.isError).toBe(true);
    expect(events.some((event) => event.type === "change")).toBe(false);
  });

  it("attributes a late result to the turn that started it", async () => {
    let requestId = "run-1";
    const emit = vi.fn();
    state.onSave = () => {
      requestId = "run-2";
    };
    await runAgentTool(
      { mode: () => "full-access", turn: () => ({ requestId, emit }) },
      "save_draft",
      { subject: "Dinner" },
    );
    expect(emit.mock.calls[0][0].requestId).toBe("run-1");
  });

  it("doesn't make a change that was stopped while it waited behind another", async () => {
    const emit = vi.fn();
    const caller = {
      mode: () => "full-access" as const,
      turn: () => ({ requestId: "run-1", emit }),
    };
    const stop = new AbortController();
    const first = runAgentTool(caller, "save_draft", { subject: "First" });
    const second = runAgentTool(caller, "save_draft", { subject: "Second" }, stop.signal);
    stop.abort();
    expect((await first).isError).toBe(false);
    expect(await second).toEqual({ text: "Stopped by the user.", isError: true });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
