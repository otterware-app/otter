import {
  clearHermesKey,
  logger,
  preferenceChanged,
  providersState,
  refreshProvider,
  saveAgentSettings,
  setHermesKey,
  type CoreExtension,
} from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import {
  fetchHermesModels,
  hermesProvider,
  normalizeHermesBaseUrl,
  probeHermesSessions,
} from "./hermes.js";

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export default {
  manifest,
  activate({ handle, registerAgent }) {
    registerAgent(hermesProvider);
    handle("agent:connectHermes", async (params: unknown) => {
      const p = params as Record<string, unknown> | undefined;
      const baseUrl = str(p?.baseUrl);
      const apiKey = str(p?.apiKey);
      if (!baseUrl || !apiKey) throw new Error("Base URL and API key are both required.");
      const base = normalizeHermesBaseUrl(baseUrl);
      const [models, sessions] = await Promise.all([
        fetchHermesModels(base, apiKey),
        probeHermesSessions(base, apiKey),
      ]);
      await setHermesKey(apiKey);
      await saveAgentSettings("hermes", {
        baseUrl: base,
        agentModel: models[0] || "hermes-agent",
        sessions,
      });
      logger.info("agent", "hermes connected", { baseUrl: base, sessions });
      void refreshProvider("hermes");
      preferenceChanged("assistant");
      preferenceChanged("hermesKey");
      return providersState();
    });
    // apps/ios's Disconnect: the key leaves this device, and the address every device.
    handle("agent:disconnectHermes", async () => {
      await clearHermesKey();
      await saveAgentSettings("hermes", { baseUrl: "" });
      logger.info("agent", "hermes disconnected");
      hermesProvider.shutdown();
      void refreshProvider("hermes");
      preferenceChanged("assistant");
      return providersState();
    });
  },
} satisfies CoreExtension;
