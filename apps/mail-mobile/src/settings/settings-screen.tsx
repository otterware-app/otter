import {
  getAdvanceDirection,
  setAdvanceDirection,
  type AdvanceDirection,
} from "@otter/client/mail/advance-direction";
import { ipc } from "@otter/client/bridge";
import { mailApi, type NotificationsMode } from "@otter/client/mail/api";
import { useOtterAccount } from "@otter/client/otter-account";
import { setSyncedPreference } from "@otter/client/preferences";
import type { ErrorReportsConfig } from "@otter/core";
import { demo, setDemo } from "@otter/mobile/demo";
import { Avatar } from "@otter/ui-native/components/avatar";
import {
  SettingsFooterText,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { requestPermissionsAsync } from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import { View } from "react-native";

import otterMark from "../account/otter-mark.png";
import { mailFailure } from "../mail/mail-actions.tsx";
import { useMailboxes } from "../mail/mailboxes.ts";
import {
  effectiveLanguages,
  languageName,
  useTranslationSettings,
  useUpdateTranslationSettings,
} from "../mail/translation.ts";
import { fake } from "../core.ts";
import { errorReportsAvailable } from "../error-reports.ts";
import { mailSettingsKey } from "../notifications/use-mail-notifications.ts";
import { PickerRow } from "./picker-row.tsx";
import { setFullWidthMessages, useFullWidthMessages, usePreference } from "./preferences.ts";

const advance: Record<AdvanceDirection, string> = {
  next: "Next message",
  previous: "Previous message",
  none: "Back to the list",
};

const notifications: Record<NotificationsMode, string> = {
  off: "Off",
  inbox: "Inbox only",
  all: "All new mail",
};

const appearances = { system: "System", light: "Light", dark: "Dark" };

export function SettingsScreen() {
  const { mailboxes } = useMailboxes();
  const otter = useOtterAccount();
  const router = useRouter();
  const theme = useTheme();
  const queries = useQueryClient();
  const themeSource = usePreference("otter:theme-source");
  const grouped = usePreference("otter:group-messages-by-day") !== "false";
  const fullRows = usePreference("otter:full-width-rows") === "true";
  const fullMessages = useFullWidthMessages();
  usePreference("gmail:advance-direction");
  const settings = useQuery({ queryKey: mailSettingsKey, queryFn: mailApi.getSyncSettings });
  const translation = useTranslationSettings().data;
  const updateTranslation = useUpdateTranslationSettings();
  const read = effectiveLanguages(translation).map(languageName);
  const update = useMutation({
    mutationFn: (mode: NotificationsMode) => mailApi.setSyncSettings({ notificationsMode: mode }),
    onSuccess: (data) => {
      queries.setQueryData(mailSettingsKey, data);
      if (data.notificationsMode !== "off") void requestPermissionsAsync().catch(mailFailure);
    },
    onError: mailFailure,
  });
  const name = otter?.user?.name || otter?.user?.email;
  return (
    <SettingsPage>
      <Stack.Screen options={{ headerBackVisible: false }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="xmark"
          tintColor={theme.colors.primary}
          accessibilityLabel="Close"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      {demo ? (
        <View style={{ alignItems: "center", paddingVertical: 15, gap: 5 }}>
          <Image
            source={otterMark}
            accessible={false}
            style={{ width: 58, height: 58, borderRadius: 29 }}
          />
          <Text size="xl" weight="semibold">
            Demo mailbox
          </Text>
          <Text color="mutedForeground" style={{ textAlign: "center" }}>
            Pretend mail, to try Otter Mail. Nothing here reaches Google.
          </Text>
        </View>
      ) : name ? (
        <View style={{ alignItems: "center", paddingVertical: 15, gap: 5 }}>
          <Avatar source={otter?.user?.picture} initials={Array.from(name)[0]} size={58} />
          <Text size="xl" weight="semibold">
            {name}
          </Text>
          {otter?.user?.email !== name && <Text color="mutedForeground">{otter?.user?.email}</Text>}
        </View>
      ) : null}
      <SettingsSection
        title="Mail"
        headline
        footer={
          fake
            ? undefined
            : "Connect background notifications for each mailbox to receive alerts while the app is closed. Alerts are sent only for verified new mail; sender and preview load on this iPhone."
        }
      >
        <SettingsRow
          icon="tray.2"
          title="Mailboxes"
          value={`${mailboxes.filter(({ enabled }) => enabled).length} on`}
          onPress={() => router.push("/settings/mailboxes")}
        />
        {settings.data && (
          <PickerRow
            icon="bell"
            title="Notifications"
            value={settings.data.notificationsMode}
            options={notifications}
            onChange={(choice) => update.mutate(choice)}
          />
        )}
        {!fake && (
          <SettingsRow
            title="Background notification setup"
            onPress={() => router.push("/settings/mailboxes")}
          />
        )}
        <PickerRow
          icon="arrow.turn.down.right"
          title="After archive"
          value={getAdvanceDirection()}
          options={advance}
          onChange={setAdvanceDirection}
        />
      </SettingsSection>
      <SettingsSection
        title="Translation"
        headline
        footer="Mail in other languages is translated on this iPhone, by Apple's Translation."
      >
        <SettingsRow
          icon="character.bubble"
          title="Languages I read"
          value={read.length > 2 ? `${read[0]} +${read.length - 1}` : read.join(", ")}
          onPress={() => router.push("/settings/languages")}
        />
        <SettingsSwitchRow
          icon="translate"
          title="Translate automatically"
          value={translation?.autoTranslate ?? false}
          onValueChange={(autoTranslate) => updateTranslation.mutate({ autoTranslate })}
        />
      </SettingsSection>
      <SettingsSection title="Appearance" headline>
        <PickerRow
          icon="circle.lefthalf.filled"
          title="Color scheme"
          value={themeSource === "light" || themeSource === "dark" ? themeSource : "system"}
          options={appearances}
          onChange={(next) => setSyncedPreference("otter:theme-source", next)}
        />
        <SettingsSwitchRow
          title="Full-width messages"
          icon="arrow.left.and.right"
          value={fullMessages}
          onValueChange={setFullWidthMessages}
        />
      </SettingsSection>
      <SettingsSection title="Message list" headline>
        <SettingsSwitchRow
          title="Group messages by day"
          description="Separate messages by day. Tap a day's heading to collapse or expand it."
          value={grouped}
          onValueChange={(value) =>
            setSyncedPreference("otter:group-messages-by-day", String(value))
          }
        />
        <SettingsSwitchRow
          title="Full-width rows"
          description="Run each message edge to edge with a line between them, instead of cards."
          value={fullRows}
          onValueChange={(value) => setSyncedPreference("otter:full-width-rows", String(value))}
        />
      </SettingsSection>
      {errorReportsAvailable && <SupportSection />}
      <SettingsSection title="Account" headline>
        {demo ? (
          <SettingsRow
            icon="person.crop.circle.badge.plus"
            title="Sign in with Google"
            chevron={false}
            onPress={() => void setDemo(false)}
          />
        ) : (
          <SettingsRow
            icon="person.crop.circle"
            title="Otter account"
            onPress={() => router.push("/settings/account")}
          />
        )}
        <SettingsRow icon="info.circle" title="Version" value={Constants.expoConfig?.version} />
        <SettingsRow
          icon="doc.text"
          title="Open-source licenses"
          onPress={() => router.push("/settings/licenses")}
        />
      </SettingsSection>
    </SettingsPage>
  );
}

function SupportSection() {
  const queries = useQueryClient();
  const settings = useQuery({ queryKey: mailSettingsKey, queryFn: mailApi.getSyncSettings });
  const config = useQuery({
    queryKey: ["errorReports:config"],
    queryFn: () => ipc<ErrorReportsConfig>("errorReports:config"),
  });
  const update = useMutation({
    mutationFn: (errorReports: boolean) => mailApi.setSyncSettings({ errorReports }),
    onSuccess: (data) => queries.setQueryData(mailSettingsKey, data),
    onError: mailFailure,
  });
  if (!settings.data) return null;
  return (
    <SettingsSection
      title="Support"
      headline
      footer={
        <>
          <SettingsFooterText>
            When something fails, tell Otterware what broke, where and for whom: your Otter account,
            the screen you were on and what led to it. Never your mail itself, passwords or sign-in
            tokens.
          </SettingsFooterText>
          {config.data && (
            <SettingsFooterText selectable>Report ID {config.data.reportId}</SettingsFooterText>
          )}
        </>
      }
    >
      <SettingsSwitchRow
        icon="ant"
        title="Send error reports"
        value={update.isPending ? update.variables : settings.data.errorReports}
        onValueChange={(value) => update.mutate(value)}
      />
    </SettingsSection>
  );
}
