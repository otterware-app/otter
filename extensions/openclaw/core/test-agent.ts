import type { AgentContext } from "@otter/core/extension-kit";

/** An OpenClaw agent for tests: its secrets in `stored`. */
export function testAgent(
  secrets: Record<string, string> = { token: "test-token" },
  id = "openclaw-1",
): AgentContext & { stored: Map<string, string> } {
  const stored = new Map(Object.entries(secrets));
  return {
    id,
    stored,
    secrets: {
      get: async (name) => stored.get(name) ?? "",
      set: async (name, value) => void stored.set(name, value),
      delete: async (name) => void stored.delete(name),
    },
  };
}
