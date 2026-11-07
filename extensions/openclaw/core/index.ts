import {
  agentSettings,
  broadcast,
  clearOpenClawBootstrapToken,
  clearOpenClawToken,
  logger,
  providersState,
  refreshProvider,
  saveAgentSettings,
  setOpenClawBootstrapToken,
  setOpenClawToken,
  type CoreExtension,
} from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import {
  allowOpenClawFullAccess,
  normalizeOpenClawUrl,
  openClawProvider,
  parseOpenClawSetupCode,
  resetOpenClawConnection,
} from "./openclaw.js";
import type { OpenClawSettings } from "./settings.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

async function connect(input: { code: string } | { url: string; token: string }) {
  let url: string;
  if ("code" in input) {
    const code = parseOpenClawSetupCode(input.code);
    if (!code)
      throw new Error("That isn't a setup code. Copy what openclaw qr --setup-code-only prints.");
    if (code.expiresAtMs && code.expiresAtMs < Date.now())
      throw new Error(
        "That setup code has expired. Make a new one with openclaw qr --setup-code-only.",
      );
    url = code.url;
    await resetOpenClawConnection();
    await clearOpenClawToken();
    await setOpenClawBootstrapToken(code.bootstrapToken);
  } else {
    url = input.url;
    await resetOpenClawConnection();
    await clearOpenClawBootstrapToken();
    await setOpenClawToken(input.token);
  }
  await saveAgentSettings("openclaw", { url: normalizeOpenClawUrl(url) });
  logger.info("agent", "openclaw connecting", {
    url: normalizeOpenClawUrl(url),
    with: "code" in input ? "setup code" : "token",
  });
  void refreshProvider("openclaw");
  return providersState();
}

/**
 * The Swift iPhone app's OpenClaw settings (its UserDefaults), on the Expo
 * app's first launch: taken only when core has no gateway. A run it left open
 * is picked up as the session's chat.
 */
export async function importSwiftSettings(params: unknown): Promise<{ imported: boolean }> {
  const p = params as Record<string, unknown> | undefined;
  const url = str(p?.url);
  if (!url || ((await agentSettings("openclaw")) as OpenClawSettings).url)
    return { imported: false };
  await saveAgentSettings("openclaw", {
    url: normalizeOpenClawUrl(url),
    model: str(p?.model),
    enabled: p?.enabled !== false,
  });
  logger.info("agent", "openclaw imported from the Swift app", { run: Boolean(p?.run) });
  void refreshProvider("openclaw");
  const run = p?.run as Record<string, unknown> | undefined;
  const sessionId = str(run?.session);
  const requestId = str(run?.run);
  if (sessionId && requestId)
    broadcast("agent:runStarted", {
      provider: "openclaw",
      sessionId,
      requestId,
      chat: { title: "OpenClaw" },
    });
  return { imported: true };
}

export default {
  manifest,
  activate({ handle, registerAgent }) {
    registerAgent(openClawProvider);
    handle("agent:connectOpenClaw", async (params: unknown) => {
      const p = params as Record<string, unknown> | undefined;
      const code = str(p?.code);
      if (code) return connect({ code });
      const url = str(p?.url);
      const token = str(p?.token);
      if (!url || !token) throw new Error("Paste a setup code, or the gateway address and token.");
      return connect({ url, token });
    });
    // apps/ios's Disconnect: the gateway's tokens go; this device's key (its identity there) stays.
    handle("agent:disconnectOpenClaw", async () => {
      await resetOpenClawConnection();
      await clearOpenClawToken();
      await clearOpenClawBootstrapToken();
      await saveAgentSettings("openclaw", { url: "" });
      logger.info("agent", "openclaw disconnected");
      void refreshProvider("openclaw");
      return providersState();
    });
    handle("agent:importOpenClaw", (params: unknown) => importSwiftSettings(params));
    handle("agent:allowOpenClawFullAccess", async () => {
      await allowOpenClawFullAccess((await agentSettings("openclaw")) as OpenClawSettings, () => {
        void refreshProvider("openclaw");
      });
      return providersState();
    });
  },
} satisfies CoreExtension;
