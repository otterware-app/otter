import { ipc } from "@otter/client/bridge";
import { host } from "@otter/client/host";
import {
  IosAuthorizationStatus,
  addPushTokenListener,
  getDevicePushTokenAsync,
  getPermissionsAsync,
  requestPermissionsAsync,
  type NotificationPermissionsStatus,
} from "expo-notifications";
import { useSyncExternalStore } from "react";

import { notificationsNative } from "./native.ts";

const KEY = "otter:notifications";
const listeners = new Set<() => void>();

export const deviceNotificationsEnabled = () => host().storage.get(KEY) !== "off";

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useDeviceNotifications() {
  const enabled = useSyncExternalStore(subscribe, deviceNotificationsEnabled);
  return {
    enabled,
    update(next: boolean) {
      try {
        host().storage.set(KEY, next ? "on" : "off");
        for (const listener of listeners) listener();
      } catch {
        host().notice({ tone: "error", title: "Could not save notification settings" });
      }
    },
  };
}

const authorized = (status: NotificationPermissionsStatus) =>
  status.granted || status.ios?.status === IosAuthorizationStatus.PROVISIONAL;

// Serializes updates even as the signed-in account changes, since APNs gives the same device token.
let updating = Promise.resolve();

/** Reconciles the relay registration with this iPhone's switch, system permission and APNs token. */
export function followDeviceRegistration(userId: string, canPrompt: boolean): () => void {
  const config = notificationsNative.pushConfig();
  if (!config) return () => {};
  let active = true;
  let allowed = false;
  let revision = 0;
  let wanted: string | null | undefined;
  let registered: typeof wanted;

  function register(token: string | null) {
    wanted = token;
    updating = updating
      .then(async () => {
        if (!active || token !== wanted || registered === token) return;
        await ipc("otter:setAgentPushDevice", {
          userId,
          device: token ? { ...config, token } : null,
        });
        registered = token;
      })
      .catch((error: unknown) => console.warn("Could not update iPhone notifications", error));
  }

  async function reconcile(prompt = false) {
    const latest = ++revision;
    const current = () => active && latest === revision;
    if (!deviceNotificationsEnabled()) {
      allowed = false;
      register(null);
      return;
    }
    const status = await getPermissionsAsync();
    if (!current()) return;
    const permission =
      (prompt || canPrompt) && !authorized(status) && status.canAskAgain
        ? await requestPermissionsAsync()
        : status;
    if (!current()) return;
    allowed = authorized(permission);
    if (!allowed) {
      if (!permission.canAskAgain) register(null);
      return;
    }
    const { data } = await getDevicePushTokenAsync();
    if (current() && typeof data === "string") register(data);
  }

  const refresh = (prompt = false) => {
    void reconcile(prompt).catch((error: unknown) =>
      console.warn("Could not get an APNs token", error),
    );
  };
  const tokens = addPushTokenListener(({ data }) => {
    if (allowed && typeof data === "string") register(data);
  });
  const setting = subscribe(() => refresh(true));
  const focus = host().onFocusChange(() => {
    if (host().focused()) refresh();
  });
  refresh();
  return () => {
    active = false;
    tokens.remove();
    setting();
    focus();
  };
}
