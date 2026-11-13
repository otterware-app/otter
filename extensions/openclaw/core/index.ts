import {
  agentProvider,
  agentSettings,
  logger,
  platform,
  providersState,
  refreshProvider,
  saveAgentSettings,
  type AgentId,
  type CoreExtension,
} from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import {
  normalizeOpenClawUrl,
  openClawAgent,
  parseOpenClawSetupCode,
  type OpenClawProvider,
} from "./openclaw.js";
import type { OpenClawSettings } from "./settings.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function agentOf(params: unknown): AgentId {
  const id = str((params as Record<string, unknown> | undefined)?.agent);
  if (!id) throw new Error("Choose an agent.");
  return id;
}

const providerOf = async (id: AgentId) => (await agentProvider(id)) as OpenClawProvider;

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

async function connect(id: AgentId, input: { code: string } | { url: string; token: string }) {
  const provider = await providerOf(id);
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
    await provider.connect(url, { bootstrapToken: code.bootstrapToken });
  } else {
    url = reachable(normalizeOpenClawUrl(input.url));
    await provider.connect(url, { token: input.token });
  }
  await saveAgentSettings(id, { url });
  logger.info("agent", "openclaw connecting", {
    url,
    with: "code" in input ? "setup code" : "token",
  });
  void refreshProvider(id);
  return providersState();
}

export default {
  manifest,
  activate({ handle, registerAgent }) {
    registerAgent(openClawAgent);
    handle("agent:connectOpenClaw", async (params: unknown) => {
      const id = agentOf(params);
      const p = params as Record<string, unknown>;
      const code = str(p.code);
      if (code) return connect(id, { code });
      const url = str(p.url);
      const token = str(p.token);
      if (!url || !token) throw new Error("Paste a setup code, or the gateway address and token.");
      return connect(id, { url, token });
    });
    handle("agent:allowOpenClawFullAccess", async (params: unknown) => {
      const id = agentOf(params);
      const provider = await providerOf(id);
      await provider.allowFullAccess((await agentSettings(id)) as OpenClawSettings, () => {
        void refreshProvider(id);
      });
      return providersState();
    });
    handle("agent:allowOpenClawOwner", async (params: unknown) => {
      const id = agentOf(params);
      const provider = await providerOf(id);
      await provider.allowOwner((await agentSettings(id)) as OpenClawSettings);
      await refreshProvider(id);
      return providersState();
    });
  },
} satisfies CoreExtension;
