import {
  Button,
  ConfirmationDialog,
  LabeledContent,
  ProgressView,
  Text,
  VStack,
} from "@expo/ui/swift-ui";
import { font, foregroundStyle, frame } from "@expo/ui/swift-ui/modifiers";
import type { OtterDevice } from "@otter-mail/contracts";
import { useEffect, useState } from "react";
import { Alert } from "react-native";

import { core } from "../../state/core";
import { deleteAccount, signOut } from "../../state/otter";
import { namedRelative } from "../../state/sync-health";
import type { Palette } from "../theme";
import { Group, SettingsForm } from "./SettingsScreen";

const loadDevices = (set: (devices: OtterDevice[]) => void) =>
  core.invoke<OtterDevice[]>("otter:listDevices").then(set, () => set([]));

const active = (ms: number) =>
  Date.now() - ms < 60_000 ? "Active now" : `Active ${namedRelative(ms)}`;

/** The Swift app's AccountSettings: the account's devices (sign one out), signing out, and deleting the account. */
export function AccountSettings({ colors }: { colors: Palette }) {
  const [devices, setDevices] = useState<OtterDevice[] | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = () => loadDevices(setDevices);
  useEffect(() => void loadDevices(setDevices), []);

  const signOutDevice = (device: OtterDevice) =>
    void core
      .invoke("otter:signOutDevice", { token: device.token })
      .catch(() => {})
      .then(load);

  const remove = async () => {
    try {
      await deleteAccount();
    } catch (e) {
      Alert.alert("Couldn't delete the account", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SettingsForm colors={colors} title="Otter account">
      <Group colors={colors} title="Devices">
        {devices ? (
          devices.map((device) => (
            <LabeledContent
              key={device.token}
              label={
                <VStack alignment="leading" spacing={2}>
                  <Text>{device.name}</Text>
                  <Text
                    modifiers={[
                      font({ textStyle: "subheadline" }),
                      foregroundStyle(colors.secondary),
                    ]}
                  >
                    {active(device.lastActiveAt)}
                  </Text>
                </VStack>
              }
            >
              {device.current ? (
                <Text>This iPhone</Text>
              ) : (
                <Button label="Sign out" role="destructive" onPress={() => signOutDevice(device)} />
              )}
            </LabeledContent>
          ))
        ) : (
          <ProgressView modifiers={[frame({ maxWidth: Infinity })]} />
        )}
      </Group>

      <Group colors={colors}>
        <ConfirmationDialog
          title="Sign out?"
          isPresented={confirmSignOut}
          onIsPresentedChange={setConfirmSignOut}
          titleVisibility="visible"
        >
          <ConfirmationDialog.Trigger>
            <Button label="Sign out of Otter Mail" onPress={() => setConfirmSignOut(true)} />
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button label="Sign out" role="destructive" onPress={() => void signOut()} />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>
              Your mail leaves this iPhone. It stays on its servers, and your mailboxes stay on your
              other devices.
            </Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
      </Group>

      <Group
        colors={colors}
        footer={
          <Text>
            Your Otter account carries your mailboxes, themes and settings to the Mac and the web.
          </Text>
        }
      >
        <ConfirmationDialog
          title="Delete your Otter account?"
          isPresented={confirmDelete}
          onIsPresentedChange={setConfirmDelete}
          titleVisibility="visible"
        >
          <ConfirmationDialog.Trigger>
            <Button
              label="Delete Otter account"
              role="destructive"
              onPress={() => setConfirmDelete(true)}
            />
          </ConfirmationDialog.Trigger>
          <ConfirmationDialog.Actions>
            <Button label="Delete account" role="destructive" onPress={() => void remove()} />
          </ConfirmationDialog.Actions>
          <ConfirmationDialog.Message>
            <Text>
              Signs out every device and forgets your mailboxes and preferences. Your mail stays on
              its servers.
            </Text>
          </ConfirmationDialog.Message>
        </ConfirmationDialog>
      </Group>
    </SettingsForm>
  );
}
