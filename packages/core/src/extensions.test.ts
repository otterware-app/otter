import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./logger.js", () => ({ logger: { error: () => {}, info: () => {} } }));

import { activateExtensions, registeredAgents } from "./extensions.js";
import { handle, registeredHandlers } from "./ipc.js";
import type { ChatProvider } from "./services/agent/types.js";

const manifest = (id: string) => ({
  id,
  name: id,
  description: id,
  category: "mail" as const,
  dataUse: "",
});

describe("activating extensions", () => {
  it("drops what an extension registered when it fails, and keeps the others", async () => {
    await activateExtensions([
      {
        manifest: manifest("broken"),
        activate({ handle: serve, registerAgent }) {
          serve("broken:one", () => 1);
          registerAgent({ kind: "broken" } as ChatProvider);
          throw new Error("boom");
        },
      },
      {
        manifest: manifest("fine"),
        activate({ handle: serve }) {
          serve("fine:one", () => 1);
        },
      },
    ]);
    expect(registeredHandlers().has("broken:one")).toBe(false);
    expect(registeredAgents().has("broken")).toBe(false);
    expect(registeredHandlers().has("fine:one")).toBe(true);
  });

  it("refuses a channel another part of the app serves", async () => {
    handle("taken:channel", () => "core's");
    await activateExtensions([
      {
        manifest: manifest("greedy"),
        activate({ handle: serve }) {
          serve("taken:channel", () => "greedy's");
        },
      },
    ]);
    expect(registeredHandlers().get("taken:channel")!(undefined)).toBe("core's");
  });
});
