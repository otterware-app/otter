import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { NotificationFailure, type Connection } from "./notification-connections.ts";
import { gmailCheck } from "./notification-providers.ts";
import type { Env } from "./worker.ts";

vi.mock("cloudflare:sockets", () => ({ connect: vi.fn() }));
vi.mock("./notification-connections.ts", async (original) => ({
  ...(await original<typeof import("./notification-connections.ts")>()),
  accessToken: vi.fn().mockResolvedValue("fake-access"),
}));
afterEach(() => vi.unstubAllGlobals());

const row = { user_id: "owner", email: "mail@example.com", provider: "gmail" } as Connection;

describe("provider reads", () => {
  it("treats a Gmail read that times out as a temporary failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        ),
    );
    const check = gmailCheck({} as Env, row, {
      provider: "gmail",
      historyId: "100",
      watchedUntil: Date.now() + 7 * 86_400_000,
    });
    await expect(check).rejects.toBeInstanceOf(NotificationFailure);
    await expect(check).rejects.toMatchObject({
      reauthorize: false,
      reason: "provider_temporary",
      detail: "history timeout",
    });
  });
});
