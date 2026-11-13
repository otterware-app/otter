import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatEvent } from "@otter/core/extension-kit";

const fixture = vi.hoisted(() => ({
  claude: [] as unknown[],
  codex: [] as { method: string; params: Record<string, unknown> }[],
}));
vi.mock("@otter/core/extension-kit", async () => ({
  ...(await import("../../../packages/core/src/services/agent/steps.js")),
  ...(await import("../../../packages/core/src/services/agent/text-stream.js")),
  dataUrl: vi.fn(),
}));
vi.mock("@otter/desktop/extension-kit", () => ({
  AGENT_INSTRUCTIONS: "",
  MCP_SERVER_NAME: "otter",
  agentWorkspace: async () => "/workspace",
  attachmentsDir: async () => "/attachments",
  attachmentPath: (a: { path: string }) => a.path,
  ensureShellPath: async () => {},
  logger: { info: vi.fn() },
  readAgentFile: vi.fn(),
  toolAccess: async () => ({ url: "https://tools.test", headers: {}, revoke: () => {} }),
  withAttachmentPaths: (text: string) => text,
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  deleteSession: vi.fn(),
  getSessionMessages: vi.fn(),
  listSessions: vi.fn(),
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) => ({
    async *[Symbol.asyncIterator]() {
      for await (const _message of prompt) {
        for (const event of fixture.claude) yield event;
      }
    },
    close: () => {},
  }),
}));
const { createClaude } = await import("./claude.js");
const { CLAUDE_DEFAULTS } = await import("./settings.js");
const settings = CLAUDE_DEFAULTS;
const claudeProvider = createClaude();
afterEach(() => claudeProvider.shutdown());

function text(events: ChatEvent[]): string[] {
  const messages = new Map<string, string>();
  for (const event of events) {
    if (event.type === "delta")
      messages.set(event.id!, (messages.get(event.id!) ?? "") + event.text);
    else if (event.type === "text") messages.set(event.id, event.text);
  }
  return [...messages.values()].filter(Boolean);
}

describe("Claude transcripts", () => {
  it("keeps Claude's streamed preamble and later complete text blocks", async () => {
    fixture.claude = [
      { type: "stream_event", event: { type: "message_start" } },
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "I'll check." } },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "I'll check." },
            { type: "tool_use", id: "tool", name: "Bash", input: { command: "pwd" } },
          ],
        },
      },
      {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: "tool", content: "/workspace" }] },
      },
      {
        type: "assistant",
        message: {
          content: [
            { type: "thinking", thinking: "private" },
            { type: "text", text: "Done." },
            { type: "text", text: "\n[View screenshot](/tmp/image.png)" },
          ],
        },
      },
      { type: "result", subtype: "success" },
    ];
    const events: ChatEvent[] = [];
    await claudeProvider.sendTurn({ requestId: "claude", input: "Check" }, settings, (event) =>
      events.push(event),
    );
    expect(text(events)).toEqual(["I'll check.", "Done.\n[View screenshot](/tmp/image.png)"]);
    expect(events.filter((event) => event.type === "tool")).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("done");
  });
});
