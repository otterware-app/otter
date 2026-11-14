import {
  agentProvider,
  logger,
  providersState,
  refreshProvider,
  saveAgentSettings,
  type CoreExtension,
} from "@otter/core/extension-kit";

import { manifest } from "../manifest.ts";
import {
  fetchHermesModels,
  hermesAgent,
  normalizeHermesBaseUrl,
  probeHermesSessions,
  type HermesProvider,
} from "./hermes.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export default {
  manifest,
  activate({ handle, registerAgent }) {
    registerAgent(hermesAgent);
    handle("agent:connectHermes", async (params: unknown) => {
      const p = params as Record<string, unknown> | undefined;
      const agent = str(p?.agent);
      const baseUrl = str(p?.baseUrl);
      const apiKey = str(p?.apiKey);
      if (!agent) throw new Error("Which agent to connect is missing.");
      if (!baseUrl || !apiKey) throw new Error("Base URL and API key are both required.");
      const hermes = (await agentProvider(agent)) as HermesProvider;
      const base = normalizeHermesBaseUrl(baseUrl);
      const [models, sessions] = await Promise.all([
        fetchHermesModels(base, apiKey),
        probeHermesSessions(base, apiKey),
      ]);
      await hermes.saveKey(apiKey);
      await saveAgentSettings(agent, {
        baseUrl: base,
        agentModel: models[0] || "hermes-agent",
        sessions,
      });
      logger.info("agent", "hermes connected", { agent, baseUrl: base, sessions });
      void refreshProvider(agent);
      return providersState();
    });
  },
} satisfies CoreExtension;
