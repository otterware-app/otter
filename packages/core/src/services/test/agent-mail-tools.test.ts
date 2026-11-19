import { beforeEach, expect, it, vi } from "vite-plus/test";

import type { MessageDetail } from "../../types.ts";

const state = vi.hoisted(() => ({
  saved: [] as Record<string, unknown>[],
  messages: [] as MessageDetail[],
}));

const detail = (id: string, patch: Partial<MessageDetail> = {}): MessageDetail => ({
  id,
  threadId: "thread-1",
  fromName: "Ticket",
  fromEmail: "noreply@desk.example",
  to: "me@home.example",
  subject: "Your request",
  snippet: "",
  date: 1_000,
  unread: false,
  starred: false,
  labelIds: ["INBOX"],
  hasAttachments: false,
  bodyHtml: null,
  bodyText: "Hello",
  attachments: [],
  ...patch,
});

vi.mock("../../logger.ts", () => ({ logger: { info: vi.fn() } }));

vi.mock("../../ipc.ts", () => ({
  registeredHandlers: () =>
    new Map<string, (args: Record<string, unknown>) => unknown>([
      ["gmail:listAccounts", () => [{ id: "home", email: "me@home.example" }]],
      ["gmail:listLabels", () => []],
      ["gmail:getMessage", ({ messageId }) => state.messages.find((m) => m.id === messageId)],
      ["gmail:getDraftForMessage", ({ messageId }) => ({ draftId: `draft-of-${messageId}` })],
      [
        "gmail:saveDraft",
        (args) => {
          state.saved.push(args);
          return { draftId: "draft-1", threadId: "thread-1" };
        },
      ],
    ]),
}));

vi.mock("../mail-store.ts", () => ({
  getThreadMessages: () => state.messages,
}));

vi.mock("../../providers/index.ts", () => ({ providerFor: () => ({}) }));

const { runAgentTool } = await import("../agent/tools/index.ts");

const caller = {
  mode: () => "full-access" as const,
  turn: () => ({ requestId: "run-1", emit: () => {} }),
};

beforeEach(() => {
  state.saved = [];
  state.messages = [];
});

it("replies where the sender's Reply-To asks", async () => {
  state.messages = [
    detail("asked", { replyTo: "Help desk <help@desk.example>", cc: "Sam <sam@home.example>" }),
  ];
  await runAgentTool(caller, "save_draft", { replyTo: "asked", body: "Thanks" });
  await runAgentTool(caller, "save_draft", { replyTo: "asked", replyAll: true, body: "Thanks" });
  expect(state.saved.map(({ to, cc }) => ({ to, cc }))).toEqual([
    { to: "Help desk <help@desk.example>", cc: undefined },
    { to: "Help desk <help@desk.example>", cc: "Sam <sam@home.example>" },
  ]);
});

it("leaves a draft discarded to Trash out of the conversation", async () => {
  state.messages = [
    detail("asked"),
    detail("discarded", { labelIds: ["DRAFT", "TRASH"] }),
    detail("pending", { labelIds: ["DRAFT"] }),
  ];
  const result = await runAgentTool(caller, "get_thread", { threadId: "thread-1" });
  const text = JSON.stringify(result);
  expect(text).not.toContain("discarded");
  expect(text).toContain("draft-of-pending");
});
