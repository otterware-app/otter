import { otterApi, useOtterAccount } from "@otter/client/otter-account";
import {
  SettingsButton,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@otter/ui-native/components/settings";
import { useState } from "react";
import { Alert } from "react-native";

import { MailboxSettingsSection } from "./mailbox-settings.tsx";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function OtterAccountSection() {
  const user = useOtterAccount()?.user;
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
      footer="Your connected mailboxes and settings follow your Otter account to your other devices."
    >
      {user ? (
        <SettingsRow
          title={user.name || user.email}
          value={user.name ? user.email : undefined}
          icon="person.crop.circle"
        />
      ) : null}
      {user ? (
        <SettingsButton
          title="Sign out"
          onPress={() => {
            void otterApi
              .signOut()
              .catch((error: unknown) => Alert.alert("Couldn't sign out", errorMessage(error)));
          }}
        />
      ) : (
        <SettingsButton
          title={busy ? "Signing in…" : "Sign in with Google"}
          disabled={busy}
          onPress={() => void signIn()}
        />
      )}
      {busy ? <SettingsButton title="Cancel" onPress={() => void otterApi.cancelSignIn()} /> : null}
    </SettingsSection>
  );
}

export function AccountScreen() {
  return (
    <SettingsPage keyboardShouldPersistTaps="handled">
      <OtterAccountSection />
      <MailboxSettingsSection />
    </SettingsPage>
  );
}
