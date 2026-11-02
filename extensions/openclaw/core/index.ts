import {
  agentSettings,
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
  allowOpenClawQuestions,
  normalizeOpenClawUrl,
  openClawProvider,
  parseOpenClawSetupCode,
  resetOpenClawConnection,
} from "./openclaw.js";
import type { OpenClawSettings } from "./settings.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Saves how to reach the gateway (a setup code, or its address and token),
 * then connects in the background: the status that follows says whether the
 * device still needs approving.
 */
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
    handle("agent:allowOpenClawQuestions", async () => {
      await allowOpenClawQuestions((await agentSettings("openclaw")) as OpenClawSettings, () => {
        void refreshProvider("openclaw");
      });
      return providersState();
    });
  },
} satisfies CoreExtension;
