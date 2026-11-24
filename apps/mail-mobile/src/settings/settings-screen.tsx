import {
  getAdvanceDirection,
  setAdvanceDirection,
  type AdvanceDirection,
} from "@otter/client/mail/advance-direction";
import { mailApi, type NotificationsMode } from "@otter/client/mail/api";
import { useOtterAccount } from "@otter/client/otter-account";
import { setSyncedPreference } from "@otter/client/preferences";
import { Avatar } from "@otter/ui-native/components/avatar";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { ActionSheetIOS, View } from "react-native";

import { version } from "../../package.json";
import { mailFailure } from "../mail/mail-actions.tsx";
import { useMailboxes } from "../mail/mailboxes.ts";
import {
  effectiveLanguages,
  languageName,
  useTranslationSettings,
  useUpdateTranslationSettings,
} from "../mail/translation.ts";
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

function picker<T extends string>(
  title: string,
  choices: Record<T, string>,
  run: (choice: T) => void,
) {
  const keys = Object.keys(choices) as T[];
  const options = keys.map((key) => choices[key]);
  ActionSheetIOS.showActionSheetWithOptions(
    { title, options: [...options, "Cancel"], cancelButtonIndex: options.length },
    (index) => {
      if (index < options.length) run(keys[index]);
    },
  );
}

export function SettingsScreen() {
  const { mailboxes } = useMailboxes();
  const otter = useOtterAccount();
  const router = useRouter();
  const queries = useQueryClient();
  const themeSource = usePreference("otter:theme-source");
  const grouped = usePreference("otter:group-messages-by-day") !== "false";
  const fullRows = usePreference("otter:full-width-rows") === "true";
  const fullMessages = useFullWidthMessages();
  usePreference("gmail:advance-direction");
  const settings = useQuery({ queryKey: ["settings:mail"], queryFn: mailApi.getSyncSettings });
  const translation = useTranslationSettings().data;
  const updateTranslation = useUpdateTranslationSettings();
  const read = effectiveLanguages(translation).map(languageName);
  const update = useMutation({
    mutationFn: (mode: NotificationsMode) => mailApi.setSyncSettings({ notificationsMode: mode }),
    onSuccess: (data) => queries.setQueryData(["settings:mail"], data),
    onError: mailFailure,
  });
  const name = otter?.user?.name || otter?.user?.email;
  return (
    <SettingsPage>
      <Stack.Screen options={{ headerBackVisible: false }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon="xmark"
          accessibilityLabel="Close settings"
          onPress={() => router.back()}
        />
      </Stack.Toolbar>
      {name ? (
        <View style={{ alignItems: "center", paddingVertical: 15, gap: 5 }}>
          <Avatar source={otter?.user?.picture} initials={Array.from(name)[0]} size={58} />
          <Text size="xl" weight="semibold">
            {name}
          </Text>
          {otter?.user?.email !== name && <Text color="mutedForeground">{otter?.user?.email}</Text>}
        </View>
      ) : null}
      <SettingsSection title="Mail">
        <SettingsRow
          icon="tray.2"
          title="Mailboxes"
          value={`${mailboxes.filter(({ enabled }) => enabled).length} on`}
          onPress={() => router.push("/settings/mailboxes")}
        />
        {settings.data && (
          <SettingsRow
            icon="bell"
            title="Notifications"
            value={notifications[settings.data.notificationsMode]}
            onPress={() =>
              picker("Notifications", notifications, (choice) => update.mutate(choice))
            }
          />
        )}
        <SettingsRow
          icon="arrow.turn.down.right"
          title="After archive"
          value={advance[getAdvanceDirection()]}
          onPress={() => picker("After archive", advance, setAdvanceDirection)}
        />
      </SettingsSection>
      <SettingsSection
        title="Translation"
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
      <SettingsSection title="Appearance">
        <SettingsRow
          icon="circle.lefthalf.filled"
          title="Color scheme"
          value={
            themeSource === "light" || themeSource === "dark"
              ? appearances[themeSource]
              : appearances.system
          }
          onPress={() =>
            picker("Color scheme", appearances, (next) =>
              setSyncedPreference("otter:theme-source", next),
            )
          }
        />
        <SettingsSwitchRow
          title="Full-width messages"
          icon="arrow.left.and.right"
          value={fullMessages}
          onValueChange={setFullWidthMessages}
        />
      </SettingsSection>
      <SettingsSection title="Message list">
        <SettingsSwitchRow
          title="Group messages by day"
          value={grouped}
          onValueChange={(value) =>
            setSyncedPreference("otter:group-messages-by-day", String(value))
          }
        />
        <SettingsSwitchRow
          title="Full-width rows"
          value={fullRows}
          onValueChange={(value) => setSyncedPreference("otter:full-width-rows", String(value))}
        />
      </SettingsSection>
      <SettingsSection title="Account">
        <SettingsRow
          icon="person.crop.circle"
          title="Otter account"
          onPress={() => router.push("/account")}
        />
        <SettingsRow icon="info.circle" title="Version" value={version} />
      </SettingsSection>
    </SettingsPage>
  );
}
