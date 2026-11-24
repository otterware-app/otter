import { describe, expect, it, vi } from "vite-plus/test";

const log = vi.hoisted(() => vi.fn());
vi.mock("./platform.ts", () => ({ platform: () => ({ log }) }));

import { logger } from "./logger.ts";

const levelOf = (message: string, error: Error) => {
  log.mockClear();
  logger.failure("handlers", message, error);
  return log.mock.calls[0]![0];
};

describe("a failure while the OpenClaw gateway restarts or is out of reach", () => {
  // OTTER-MAIL-DESKTOP-J, -K and -M: the agent's browser view asks again until the gateway is back.
  it("is the network's doing, not reported as an error", () => {
    expect(
      levelOf("agent:browserEvents failed", new Error("gateway closed (1012): service restart")),
    ).toBe("warn");
    expect(levelOf("agent:browserView failed", new Error("Can't reach the gateway."))).toBe("warn");
    // OTTER-MAIL-DESKTOP-Q: connecting as the Mac wakes, before its network is back.
    expect(levelOf("agent:browserView failed", new Error("The gateway didn't answer."))).toBe(
      "warn",
    );
    expect(
      levelOf(
        "agent:browserEvents failed",
        new Error("otter.browser.events unavailable during gateway restart"),
      ),
    ).toBe("warn");
    expect(
      levelOf(
        "agent:browserView failed",
        new Error("chat.history unavailable during gateway restart"),
      ),
    ).toBe("warn");
  });

  it("still reports what the gateway refused", () => {
    expect(
      levelOf("agent:browserEvents failed", new Error("gateway closed (1008): policy violation")),
    ).toBe("error");
    expect(
      levelOf("agent:browserView failed", new Error("unknown method: otter.browser.events")),
    ).toBe("error");
    expect(levelOf("agent:send failed", new Error("Can't reach the agent server."))).toBe("error");
  });
});
