/**
 * The Otter Mail agent (openrouter.ts): runs on the relay for the signed-in
 * Otter account, through OpenRouter with the user's API key, and calls Otter
 * Mail's tools on this device.
 */

import {
  onOtterAccountChange,
  preferenceChanged,
  providersState,
  refreshProvider,
  updateProviderSettings,
  type CoreExtension,
} from "@otter-mail/core/extension-kit";

import { manifest } from "../manifest.ts";
import {
  connectOpenRouter,
  disconnectOpenRouter,
  openRouterConnection,
  openRouterProvider,
} from "./openrouter.js";

export default {
  manifest,
  activate({ handle, registerAgent }) {
    registerAgent(openRouterProvider);
    // Another Otter account, another agent: its runs and connection are the account's.
    onOtterAccountChange(() => {
      openRouterProvider.shutdown();
      void refreshProvider("openrouter");
    });
    handle("agent:openrouterConnection", () => openRouterConnection());
    handle("agent:connectOpenRouter", async (params: unknown) => {
      const key = (params as { apiKey?: unknown } | undefined)?.apiKey;
      await connectOpenRouter(typeof key === "string" ? key.trim() : "");
      await updateProviderSettings({ selected: "openrouter", openrouter: { enabled: true } });
      await refreshProvider("openrouter");
      preferenceChanged("assistant");
      return providersState();
    });
    handle("agent:disconnectOpenRouter", async () => {
      await disconnectOpenRouter();
      await refreshProvider("openrouter");
      return providersState();
    });
  },
} satisfies CoreExtension;
