import { Icon } from "@otter/ui-native/components/icon";
import { SettingsPage } from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { View } from "react-native";

import { OtterAccountSection } from "./account-screen.tsx";
import { MailboxSettingsSection } from "./mailbox-settings.tsx";

export function WelcomeScreen() {
  return (
    <SettingsPage keyboardShouldPersistTaps="handled">
      <View style={{ alignItems: "center", gap: 14, paddingVertical: 36 }}>
        <Icon name="envelope" size={44} color="primary" />
        <Text size="3xl" weight="semibold" accessibilityRole="header">
          Otter Mail
        </Text>
      </View>
      <OtterAccountSection />
      <MailboxSettingsSection />
    </SettingsPage>
  );
}
