import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ChatEvent } from "@otter-mail/core/extension-kit";

const fixture = vi.hoisted(() => ({
  codex: [] as { method: string; params: Record<string, unknown> }[],
}));
vi.mock("@otter-mail/core/extension-kit", async () => ({
  ...(await import("../../../packages/core/src/services/agent/steps.js")),
  ...(await import("../../../packages/core/src/services/agent/text-stream.js")),
  dataUrl: vi.fn(),
}));
vi.mock("@otter-mail/desktop/extension-kit", () => ({
  AGENT_INSTRUCTIONS: "",
  MCP_SERVER_NAME: "otter-mail",
  agentWorkspace: async () => "/workspace",
  attachmentsDir: async () => "/attachments",
  attachmentPath: (a: { path: string }) => a.path,
  ensureShellPath: async () => {},
  logger: { info: vi.fn() },
  readAgentFile: vi.fn(),
  toolAccess: async () => ({ url: "https://tools.test", headers: {}, revoke: () => {} }),
  withAttachmentPaths: (text: string) => text,
}));
vi.mock("./codex-app-server.js", () => ({
  CodexSpawnError: class extends Error {},
  CodexAppServer: class {
    alive = true;
    onNotification?: (event: unknown) => void;
    static async start() {
      return new this();
    }
    async request(method: string) {
      if (method === "thread/start") return { thread: { id: "thread" } };
      if (method === "turn/start") {
        for (const event of fixture.codex) this.onNotification?.(event);
        return { turn: { id: "turn" } };
      }
      return {};
    }
    kill() {
      this.alive = false;
    }
  },
}));

const { codexProvider } = await import("./codex.js");
const { CODEX_DEFAULTS } = await import("./settings.js");
const settings = CODEX_DEFAULTS;
afterEach(() => codexProvider.shutdown());

function text(events: ChatEvent[]): string[] {
  const messages = new Map<string, string>();
  for (const event of events) {
    if (event.type === "delta")
      messages.set(event.id!, (messages.get(event.id!) ?? "") + event.text);
    else if (event.type === "text") messages.set(event.id, event.text);
  }
  return [...messages.values()].filter(Boolean);
}

describe("Codex transcripts", () => {
  it("keeps Codex commentary when a later message is delivered without deltas", async () => {
    fixture.codex = [
      {
        method: "item/started",
        params: { item: { type: "agentMessage", id: "intro", phase: "commentary" } },
      },
      { method: "item/agentMessage/delta", params: { delta: "I'll check.", itemId: "intro" } },
      {
        method: "item/completed",
        params: { item: { type: "agentMessage", id: "intro", text: "I'll check." } },
      },
      {
        method: "item/started",
        params: { item: { type: "commandExecution", id: "tool", command: "pwd" } },
      },
      {
        method: "item/completed",
        params: {
          item: {
            type: "commandExecution",
            id: "tool",
            command: "pwd",
            aggregatedOutput: "/workspace",
          },
        },
      },
      { method: "item/started", params: { item: { type: "agentMessage", id: "answer" } } },
      {
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "answer",
            text: "Done.\n[View screenshot](/tmp/image.png)",
          },
        },
      },
      { method: "turn/completed", params: { turn: { id: "turn", status: "completed" } } },
    ];
    const events: ChatEvent[] = [];
    await codexProvider.sendTurn({ requestId: "codex", input: "Check" }, settings, (event) =>
      events.push(event),
    );
    expect(text(events)).toEqual(["I'll check.", "Done.\n[View screenshot](/tmp/image.png)"]);
    expect(events.at(-1)?.type).toBe("done");
  });
});
