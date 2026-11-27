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
import { useState } from "react";
import { ActionSheetIOS, Alert } from "react-native";

import { MailboxSettingsSection } from "./mailbox-settings.tsx";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const devicesKey = ["otter:devices"];

function SignInSection() {
  const [busy, setBusy] = useState(false);

  const signIn = async () => {
    setBusy(true);
    try {
      await otterApi.signIn();
    } catch (error) {
      Alert.alert("Couldn't sign in", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Otter account"
      headline
      footer="Your connected mailboxes and settings follow your Otter account to your other devices."
    >
      <SettingsButton
        title={busy ? "Signing in…" : "Sign in with Google"}
        disabled={busy}
        onPress={() => void signIn()}
      />
      {busy ? <SettingsButton title="Cancel" onPress={() => void otterApi.cancelSignIn()} /> : null}
    </SettingsSection>
  );
}

/** AccountSettings.swift's devices: this iPhone, and the others to sign out. */
function DevicesSection() {
  const queries = useQueryClient();
  const devices = useQuery({ queryKey: devicesKey, queryFn: otterApi.listDevices, retry: false });
  const signOutDevice = useMutation({
    mutationFn: (device: OtterDevice) => otterApi.signOutDevice(device.token),
    onSuccess: () => void queries.invalidateQueries({ queryKey: devicesKey }),
    onError: (error) => Alert.alert("Couldn't sign that device out", errorMessage(error)),
  });
  const [now] = useState(Date.now);
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

  return (
    <SettingsSection
      title="Devices"
      headline
      footer={devices.isError ? errorMessage(devices.error) : undefined}
    >
      {devices.data ? (
        [...devices.data]
          .sort((a, b) => Number(b.current) - Number(a.current) || b.lastActiveAt - a.lastActiveAt)
          .map((device) => (
            <SettingsRow
              key={device.token}
              title={device.name}
              icon="laptopcomputer.and.iphone"
              value={device.current ? "This iPhone" : `Active ${agoText(device.lastActiveAt, now)}`}
              chevron={false}
              onPress={device.current ? undefined : () => confirm(device)}
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

function confirmSignOut() {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Sign out?",
      message:
        "Your mailboxes and mail stay on this iPhone, and on your other devices. They stop following your Otter account here.",
      options: ["Sign out", "Cancel"],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    },
    (index) => {
      if (index !== 0) return;
      otterApi
        .signOut()
        .catch((error: unknown) => Alert.alert("Couldn't sign out", errorMessage(error)));
    },
  );
}

function confirmDelete() {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: "Delete your Otter account?",
      message:
        "Signs out every device and forgets your mailboxes and preferences. Your mail stays on its servers.",
      options: ["Delete account", "Cancel"],
      destructiveButtonIndex: 0,
      cancelButtonIndex: 1,
    },
    (index) => {
      if (index !== 0) return;
      otterApi
        .deleteAccount()
        .catch((error: unknown) => Alert.alert("Couldn't delete the account", errorMessage(error)));
    },
  );
}

export function AccountScreen() {
  const user = useOtterAccount()?.user;
  return (
    <SettingsPage keyboardShouldPersistTaps="handled">
      {user ? (
        <SettingsSection>
          <SettingsRow
            title={user.name || user.email}
            value={user.name ? user.email : undefined}
            icon="person.crop.circle"
          />
        </SettingsSection>
      ) : (
        <SignInSection />
      )}
      <MailboxSettingsSection />
      {user ? (
        <>
          <DevicesSection />
          <SettingsSection>
            <SettingsButton title="Sign out of Otter" onPress={confirmSignOut} />
          </SettingsSection>
          <SettingsSection footer="Your Otter account carries your mailboxes and settings to the Mac and the web.">
            <SettingsButton title="Delete Otter account" destructive onPress={confirmDelete} />
          </SettingsSection>
        </>
      ) : null}
    </SettingsPage>
  );
}
