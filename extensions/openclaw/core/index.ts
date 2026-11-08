import {
  agentSettings,
  clearOpenClawBootstrapToken,
  clearOpenClawToken,
  logger,
  platform,
  providersState,
  refreshProvider,
  saveAgentSettings,
  setOpenClawBootstrapToken,
  setOpenClawToken,
  type CoreExtension,
} from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import {
  allowOpenClawFullAccess,
  allowOpenClawOwner,
  normalizeOpenClawUrl,
  openClawBrowserRelay,
  openClawProvider,
  parseOpenClawSetupCode,
  resetOpenClawConnection,
} from "./openclaw.js";
import type { OpenClawSettings } from "./settings.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** A secure page (and its worker) can't open a plain `ws://` socket, except to this machine. */
function reachable(url: string): string {
  if (
    platform().kind === "web" &&
    /^ws:\/\//i.test(url) &&
    !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)
  )
    throw new Error(
      "The web app can only reach a gateway over wss://. Serve it with Tailscale (step 1) and make a new setup code.",
    );
  return url;
}

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
    url = reachable(normalizeOpenClawUrl(code.url));
    await resetOpenClawConnection(url);
    await clearOpenClawToken();
    await setOpenClawBootstrapToken(code.bootstrapToken);
  } else {
    url = reachable(normalizeOpenClawUrl(input.url));
    await resetOpenClawConnection(url);
    await clearOpenClawBootstrapToken();
    await setOpenClawToken(input.token);
  }
  await saveAgentSettings("openclaw", { url });
  logger.info("agent", "openclaw connecting", {
    url,
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
    handle("agent:allowOpenClawFullAccess", async () => {
      await allowOpenClawFullAccess((await agentSettings("openclaw")) as OpenClawSettings, () => {
        void refreshProvider("openclaw");
      });
      return providersState();
    });
    handle("agent:openClawBrowserRelay", async () =>
      openClawBrowserRelay((await agentSettings("openclaw")) as OpenClawSettings),
    );
    handle("agent:allowOpenClawOwner", async () => {
      await allowOpenClawOwner((await agentSettings("openclaw")) as OpenClawSettings);
      await refreshProvider("openclaw");
      return providersState();
    });
  },
} satisfies CoreExtension;
