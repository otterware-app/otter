import {
  ACCOUNT_COLOR_PALETTE,
  getAccountColor,
  getAccountDisplayName,
} from "@otter/client/mail/account-style";
import { signatureFor, withAliasMailbox } from "@otter/client/mail/alias-mailboxes";
import { isICloud, mailServerName } from "@otter/client/mail/capabilities";
import { useUpdateAccount } from "@otter/client/mail/hooks";
import { Button } from "@otter/ui-native/components/button";
import { EmptyState } from "@otter/ui-native/components/empty-state";
import { SettingsField } from "@otter/ui-native/components/settings-field";
import {
  SettingsButton,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { htmlToPlain, plainToHtml } from "../mail/compose-text.ts";
import { mailFailure } from "../mail/mail-actions.tsx";
import { useMailboxes, type Mailbox } from "../mail/mailboxes.ts";
import { setMailboxArrangement, useMailboxArrangement } from "./preferences.ts";

export function MailboxSettingsScreen() {
  const { account } = useLocalSearchParams<{ account: string }>();
  const { mailboxes } = useMailboxes();
  const mailbox = mailboxes.find(({ look }) => look.id === account);
  if (!mailbox) return <EmptyState title="Mailbox unavailable" icon="tray" />;
  return <MailboxSettings key={account} mailbox={mailbox} mailboxes={mailboxes} />;
}

function MailboxSettings({ mailbox, mailboxes }: { mailbox: Mailbox; mailboxes: Mailbox[] }) {
  const { account, look, alias } = mailbox;
  const router = useRouter();
  const theme = useTheme();
  const updates = useUpdateAccount();
  const arrangement = useMailboxArrangement();
  const [name, setName] = useState(getAccountDisplayName(look));
  const initialSignature = htmlToPlain(signatureFor(account, alias) ?? "");
  const [signature, setSignature] = useState(initialSignature);
  const [color, setColor] = useState(getAccountColor(look));
  const dirty =
    name !== getAccountDisplayName(look) ||
    color !== getAccountColor(look) ||
    signature !== initialSignature;
  const ids = mailboxes
    .filter((entry) => (alias ? entry.account.id === account.id && entry.alias : !entry.alias))
    .map(({ look }) => look.id);
  const index = ids.indexOf(look.id);
  const enabled = !arrangement.off.includes(look.id);
  const locked = alias
    ? arrangement.off.includes(account.id)
    : enabled && mailboxes.filter((entry) => !entry.alias && entry.enabled).length === 1;
  const icon = isICloud(account) ? "icloud" : account.provider === "outlook" ? "tray" : "envelope";

  function move(delta: -1 | 1) {
    const next = index + delta;
    if (next < 0 || next >= ids.length) return;
    const order = ids.slice();
    [order[index], order[next]] = [order[next], order[index]];
    setMailboxArrangement({
      ...arrangement,
      order: [...arrangement.order.filter((id) => !ids.includes(id)), ...order],
    });
  }

  function save() {
    const signatureChange =
      signature !== initialSignature
        ? { signature: signature.trim() ? plainToHtml(signature) : "" }
        : {};
    const values = alias
      ? {
          aliasMailboxes: withAliasMailbox(account, alias, {
            name: name.trim(),
            color,
            ...signatureChange,
          }),
        }
      : { displayName: name.trim(), color, ...signatureChange };
    updates.mutate({ accountId: account.id, ...values }, { onError: mailFailure });
  }

  return (
    <SettingsPage keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: getAccountDisplayName(look) }} />
      <SettingsSection>
        <SettingsRow icon={icon} title={mailServerName(account)} value={look.email} />
        {account.signedOut && (
          <SettingsRow
            icon="exclamationmark.triangle"
            title="Reconnect mailbox"
            onPress={() => router.push("/account")}
          />
        )}
        <SettingsSwitchRow
          title="Show mailbox"
          value={mailbox.enabled}
          disabled={locked}
          onValueChange={(show) =>
            setMailboxArrangement({
              ...arrangement,
              off: show
                ? arrangement.off.filter((id) => id !== look.id)
                : [...arrangement.off, look.id],
            })
          }
        />
        {index > 0 && <SettingsButton title="Move up" onPress={() => move(-1)} />}
        {index < ids.length - 1 && <SettingsButton title="Move down" onPress={() => move(1)} />}
      </SettingsSection>
      <SettingsSection title="Appearance">
        <SettingsField placeholder="Mailbox name" value={name} onChangeText={setName} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 10, gap: 5 }}>
          {ACCOUNT_COLOR_PALETTE.map((swatch) => (
            <Pressable
              key={swatch}
              accessibilityRole="radio"
              accessibilityState={{ selected: color === swatch }}
              accessibilityLabel={colorNames[swatch]}
              onPress={() => setColor(swatch)}
              style={{ width: 43, height: 43, alignItems: "center", justifyContent: "center" }}
            >
              <View
                style={{
                  width: 29,
                  height: 29,
                  borderRadius: 15,
                  backgroundColor: swatch,
                  borderWidth: color === swatch ? 2 : 0,
                  borderColor: theme.colors.foreground,
                }}
              />
            </Pressable>
          ))}
        </View>
      </SettingsSection>
      <SettingsSection title="Signature">
        <TextInput
          accessibilityLabel="Signature"
          placeholder="Signature"
          placeholderTextColor={theme.colors.mutedForeground}
          value={signature}
          onChangeText={setSignature}
          multiline
          style={[
            typeStyle(theme, "base", "regular"),
            { minHeight: 92, padding: 15, color: theme.colors.foreground },
          ]}
        />
      </SettingsSection>
      <Button
        title={updates.isPending ? "Saving…" : "Save"}
        disabled={!dirty || updates.isPending}
        onPress={save}
      />
      {updates.isSuccess && !dirty && (
        <Text color="mutedForeground" size="sm" accessibilityLiveRegion="polite">
          Saved
        </Text>
      )}
    </SettingsPage>
  );
}

const colorNames: Record<string, string> = {
  "#ff3b30": "Red",
  "#ff9500": "Orange",
  "#ffcc00": "Yellow",
  "#34c759": "Green",
  "#00c7be": "Teal",
  "#007aff": "Blue",
  "#5856d6": "Indigo",
  "#af52de": "Purple",
  "#ff2d55": "Pink",
  "#a2845e": "Brown",
};
