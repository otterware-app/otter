import { useOtterAccount } from "@otter/client/otter-account";
import { onSyncedPreferenceChange } from "@otter/client/preferences";
import { Avatar } from "@otter/ui-native/components/avatar";
import { Icon } from "@otter/ui-native/components/icon";
import {
  SettingsCell,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import Constants from "expo-constants";
import { Stack, router } from "expo-router";
import { useSyncExternalStore } from "react";
import { Linking, Pressable, View } from "react-native";

import { DEV_TOOLS } from "../core.ts";
import { useBottomBarInset } from "../frame/tab-root.tsx";
import { chooseScheme, schemeChoice, type SchemeChoice } from "../frame/theme-preference.ts";
import { AgentsSection } from "./agents-section.tsx";
import { PickerRow } from "./menus.tsx";
import { NotificationsSection } from "./notifications-settings.tsx";

const SCHEMES = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const subscribeScheme = (listener: () => void) =>
  onSyncedPreferenceChange((key) => key === "otter:theme-source" && listener());

/** Settings (SettingsScreen.swift): the account, your agents, chat, color scheme, notifications, about. */
export function SettingsScreen() {
  const inset = useBottomBarInset();
  const scheme = useSyncExternalStore(subscribeScheme, schemeChoice);
  return (
    <>
      <Stack.Screen options={{ title: "Settings" }} />
      <SettingsPage contentInset={{ bottom: inset }} scrollIndicatorInsets={{ bottom: inset }}>
        <SettingsSection>
          <AccountRow />
        </SettingsSection>
        <AgentsSection title="Agents" />
        <SettingsSection>
          <SettingsRow
            title="Chat"
            icon="bubble.left.and.bubble.right"
            onPress={() => router.push("/settings/chat")}
          />
          <PickerRow
            title="Color scheme"
            icon="circle.lefthalf.filled"
            value={scheme}
            options={SCHEMES}
            onChange={(next) => chooseScheme(next as SchemeChoice)}
          />
        </SettingsSection>
        <NotificationsSection />
        <SettingsSection title="About">
          <SettingsRow
            title="Version"
            icon="info.circle"
            value={Constants.expoConfig?.version ?? "0"}
            chevron={false}
          />
          <SettingsRow
            title="Privacy policy"
            icon="hand.raised"
            onPress={() => void Linking.openURL("https://otterware.app/mail/privacy")}
          />
          <SettingsRow
            title="Terms"
            icon="doc.text"
            onPress={() => void Linking.openURL("https://otterware.app/mail/terms")}
          />
          <SettingsRow
            title="Open-source licenses"
            icon="doc.plaintext"
            onPress={() => router.push("/settings/licenses")}
          />
        </SettingsSection>
        {DEV_TOOLS ? (
          <SettingsSection title="Development">
            <SettingsRow
              title="Components"
              icon="square.grid.2x2"
              onPress={() => router.push("/gallery")}
            />
            <SettingsRow
              title="Self-test"
              icon="checkmark.seal"
              onPress={() => router.push("/self-test")}
            />
          </SettingsSection>
        ) : null}
      </SettingsPage>
    </>
  );
}

/** Who you are: your initial on the accent, your name and address, to the account's page. */
function AccountRow() {
  const user = useOtterAccount()?.user;
  const name = user?.name || "Otter account";
  return (
    <Pressable
      onPress={() => router.push("/settings/otter")}
      accessibilityRole="button"
      accessibilityLabel={user ? `${name}, ${user.email}` : name}
      style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, paddingVertical: 8 })}
    >
      <SettingsCell>
        <Avatar size={38} initials={(user?.name || user?.email || "O").slice(0, 1).toUpperCase()} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text size="base" weight="medium" numberOfLines={1}>
            {name}
          </Text>
          {user ? (
            <Text size="sm" color="mutedForeground" numberOfLines={1}>
              {user.email}
            </Text>
          ) : null}
        </View>
        <Icon name="chevron.right" size={13} weight="semibold" color="faintForeground" />
      </SettingsCell>
    </Pressable>
  );
}
