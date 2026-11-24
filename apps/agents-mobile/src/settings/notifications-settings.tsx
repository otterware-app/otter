import {
  AGENT_NOTIFICATIONS_OPTIONS,
  phoneNotificationsDescription,
  useAgentNotificationsMode,
} from "@otter/client/agents/agent-settings";
import {
  SettingsPage,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Stack } from "expo-router";

import { useDeviceNotifications } from "../notifications/device.ts";
import { PickerRow } from "./menus.tsx";

export function NotificationsSection() {
  const { mode, update } = useAgentNotificationsMode();
  const device = useDeviceNotifications();
  const footer = device.enabled
    ? phoneNotificationsDescription(mode)
    : "Notifications are off for this iPhone.";
  return (
    <SettingsSection footer={footer}>
      <SettingsSwitchRow
        title="Notifications"
        icon="bell.badge"
        value={device.enabled}
        onValueChange={device.update}
      />
      {device.enabled ? (
        <PickerRow
          title="Notify about"
          icon="line.3.horizontal.decrease"
          value={mode ?? "all"}
          options={AGENT_NOTIFICATIONS_OPTIONS}
          onChange={(next) => update(next as (typeof AGENT_NOTIFICATIONS_OPTIONS)[number]["value"])}
          disabled={mode === null}
        />
      ) : null}
    </SettingsSection>
  );
}

/** Settings › Notifications: what agents notify about. */
export function NotificationsSettings() {
  return (
    <SettingsPage>
      <Stack.Screen options={{ title: "Notifications" }} />
      <NotificationsSection />
    </SettingsPage>
  );
}
