import {
  connectCore,
  type CoreBridge,
  type CoreHostConnection,
} from "@otter-mail/client-runtime/connection";
import type { HostEffect, HostRequest } from "@otter-mail/contracts/rpc";
import { translation } from "@otter-mail/mobile-translation";
import Constants from "expo-constants";
import { AppState, Linking } from "react-native";

import { startBackgroundRefresh } from "../features/notifications/background-refresh";
import { deviceEffect, startNotifications } from "../features/notifications/notifications";
import { startCoreRuntime } from "./core-transport";
import { startRecoveredDrafts } from "./recovered-drafts";
import { markCoreReady } from "./startup";

/**
 * The phone's connection to core: client-runtime's `connectCore` over the
 * worker runtime's port. Core's broadcasts fan out to `core.on` listeners;
 * its requests and effects for the host are answered here.
 */

type Extra = { relayUrl?: string; fakeMailbox?: boolean; agentServerUrl?: string };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

const listeners = new Map<string, Set<(params: unknown) => void>>();

function onRequest(request: HostRequest): Promise<unknown> {
  switch (request._tag) {
    case "openExternal":
      return Linking.openURL(request.url);
    case "detectLanguage":
      return translation.detect(request.text);
    case "translate":
      return translation.translate([...request.texts], request.source, request.target);
    default:
      return Promise.reject(new Error(`The phone can't ${request._tag} yet.`));
  }
}

function onEffect(effect: HostEffect): void {
  if (deviceEffect(core, effect)) return;
  if (effect._tag === "log" && effect.level !== "debug") {
    console.log(`[core:${effect.scope}] ${effect.message}`);
  }
}

export const connection: CoreHostConnection = connectCore(
  () =>
    startCoreRuntime({
      appVersion: Constants.expoConfig?.version ?? "0.0.0",
      relayUrl: extra.relayUrl ?? "https://relay.mail.otterware.app",
      demo: extra.fakeMailbox === true,
      agentServerUrl: extra.agentServerUrl,
    }),
  {
    onEvent(channel, params) {
      for (const listener of listeners.get(channel) ?? []) listener(params);
      for (const listener of listeners.get("*") ?? []) listener({ channel, params });
    },
    onRequest,
    onEffect,
  },
);

void connection.ready().then(markCoreReady, () => {});

AppState.addEventListener("change", (state) => {
  if (state === "active") connection.resume();
});

/** What client-runtime's stores need of core. `on("*")` hears every broadcast. */
export const core: CoreBridge = {
  invoke: <T>(channel: string, params?: unknown) =>
    connection.invoke(channel, params) as Promise<T>,
  on(channel, listener) {
    let set = listeners.get(channel);
    if (!set) listeners.set(channel, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  },
};

startNotifications(core, connection.ready());
startBackgroundRefresh(core, connection.ready());
startRecoveredDrafts(core, connection.ready());
