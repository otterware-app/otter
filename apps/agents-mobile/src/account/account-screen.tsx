import { agoText } from "@otter/client/agents/scheduled-text";
import { otterApi, useOtterAccount } from "@otter/client/otter-account";
import type { OtterDevice } from "@otter/contracts";
import {
  SettingsButton,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@otter/ui-native/components/settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useState } from "react";
import { ActionSheetIOS, Alert } from "react-native";

const DEVICES_KEY = ["otter:devices"];

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The Otter account (SettingsScreen.swift's AccountSettings): who you are, your devices, sign out, delete. */
export function AccountScreen() {
  const user = useOtterAccount()?.user;
  return (
    <>
      <Stack.Screen options={{ title: "Otter account" }} />
      <SettingsPage>
        {user ? (
          <>
            <SettingsSection footer="Your chats, agents and settings follow your Otter account to the Mac, the web and Otter Mail.">
              <SettingsRow title="Signed in as" icon="person.crop.circle" value={user.email} />
            </SettingsSection>
            <Devices />
            <SettingsSection>
              <SettingsButton
                title="Sign out"
                onPress={() =>
                  void otterApi
                    .signOut()
                    .catch((error: unknown) => Alert.alert("Couldn't sign out", errorText(error)))
                }
              />
            </SettingsSection>
            <SettingsSection footer="Deletes your Otter account everywhere: its chats, linked mailboxes and settings. Your mail itself stays with your mail provider.">
              <SettingsButton title="Delete Otter account…" destructive onPress={confirmDelete} />
            </SettingsSection>
          </>
        ) : null}
      </SettingsPage>
    </>
  );
}

function confirmDelete() {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Delete your Otter account?",
      message: "This can't be undone.",
      options: ["Delete account", "Cancel"],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    },
    (index) => {
      if (index !== 0) return;
      otterApi
        .deleteAccount()
        .catch((error: unknown) => Alert.alert("Couldn't delete the account", errorText(error)));
    },
  );
}

/** Where the account is signed in: this iPhone first, the others to sign out. */
function Devices() {
  const qc = useQueryClient();
  const devices = useQuery({
    queryKey: DEVICES_KEY,
    queryFn: otterApi.listDevices,
    retry: false,
  });
  const signOutDevice = useMutation({
    mutationFn: (device: OtterDevice) => otterApi.signOutDevice(device.token),
    onSuccess: () => void qc.invalidateQueries({ queryKey: DEVICES_KEY }),
    onError: (error) => Alert.alert("Couldn't sign that device out", errorText(error)),
  });
  const confirm = (device: OtterDevice) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `Sign out ${device.name}?`,
        options: ["Sign out", "Cancel"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) signOutDevice.mutate(device);
      },
    );
  const [now] = useState(Date.now);

  return (
    <SettingsSection
      title="Devices"
      footer={devices.isError ? errorText(devices.error) : undefined}
    >
      {devices.data ? (
        devices.data.map((device) => (
          <SettingsRow
            key={device.token}
            title={device.name}
            icon="laptopcomputer.and.iphone"
            value={device.current ? "This device" : `Active ${agoText(device.lastActiveAt, now)}`}
            onPress={device.current ? undefined : () => confirm(device)}
            chevron={false}
            accessibilityHint={device.current ? undefined : "Signs this device out"}
          />
        ))
      ) : (
        <SettingsRow
          title={devices.isError ? "Couldn't load your devices" : "Loading devices…"}
          icon="laptopcomputer.and.iphone"
          tone="mutedForeground"
        />
      )}
    </SettingsSection>
  );
}
