import { useAtomValue } from "@effect/atom-react";
import {
  Button,
  ColorPicker,
  HStack,
  Image,
  LabeledContent,
  NavigationLink,
  Spacer,
  Text,
  TextField,
  Toggle,
  useNativeState,
  VStack,
} from "@expo/ui/swift-ui";
import {
  disabled,
  font,
  foregroundStyle,
  frame,
  labelsHidden,
  multilineTextAlignment,
  onSubmit,
} from "@expo/ui/swift-ui/modifiers";
import { Alert } from "react-native";

import { mailboxes, type Mailbox } from "../../state/client";
import { core } from "../../state/core";
import { setUiPreference, uiPreferencesAtom, type UiPreferences } from "../../state/preferences";
import type { Palette } from "../theme";
import { Group, SettingsForm } from "./SettingsScreen";

/** `mail:mailboxes`, as the Mac and the web keep it: the mailboxes' order and the ones turned off, by address. */
export function arrangement(ui: UiPreferences): { order: string[]; off: string[] } {
  try {
    const value = JSON.parse(ui["mail:mailboxes"] ?? "{}") as { order?: unknown; off?: unknown };
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
    return { order: strings(value.order), off: strings(value.off) };
  } catch {
    return { order: [], off: [] };
  }
}

const name = (m: Mailbox) => m.displayName ?? m.name ?? m.email;

const providerSymbol = (m: Mailbox) =>
  m.provider === "imap" ? "server.rack" : m.provider === "outlook" ? "envelope.badge" : "envelope";

/** apps/ios's MailboxesSettings: each mailbox on or off (on every device), its page, and adding one. */
export function MailboxesSettings({ colors, onAdd }: { colors: Palette; onAdd: () => void }) {
  const ui = useAtomValue(uiPreferencesAtom);
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const current = arrangement(ui);
  const shown = accounts.filter((m) => !current.off.includes(m.email));

  const setOn = (m: Mailbox, on: boolean) => {
    const off = on ? current.off.filter((e) => e !== m.email) : [...current.off, m.email];
    setUiPreference("mail:mailboxes", JSON.stringify({ ...current, off }));
  };

  return (
    <SettingsForm colors={colors} title="Mailboxes">
      <Group
        colors={colors}
        footer={
          <Text>
            Turned-off mailboxes stay signed in but aren't shown or synced, on every device.
          </Text>
        }
      >
        {accounts.map((m) => {
          const on = !current.off.includes(m.email);
          return (
            <HStack key={m.id} spacing={12}>
              <NavigationLink value={`mailbox:${m.id}`}>
                <HStack spacing={12}>
                  <Image
                    systemName={providerSymbol(m)}
                    color={m.color ?? colors.accent}
                    size={18}
                  />
                  <VStack alignment="leading" spacing={2}>
                    <Text>{name(m)}</Text>
                    <Text
                      modifiers={[
                        font({ textStyle: "subheadline" }),
                        foregroundStyle(m.signedOut ? colors.warning : colors.secondary),
                      ]}
                    >
                      {m.signedOut ? "Sign in on this iPhone" : m.email}
                    </Text>
                  </VStack>
                  <Spacer />
                </HStack>
              </NavigationLink>
              <Toggle
                label={`Show ${name(m)}`}
                isOn={on}
                onIsOnChange={(next) => setOn(m, next)}
                modifiers={[labelsHidden(), disabled(on && shown.length === 1)]}
              />
            </HStack>
          );
        })}
        <Button label="Add mailbox" systemImage="plus" onPress={onAdd} />
      </Group>
    </SettingsForm>
  );
}

/** apps/ios's MailboxSettings: its name and color (on every device), and removing it. */
export function MailboxSettings({
  colors,
  mailbox,
  onRemoved,
}: {
  colors: Palette;
  mailbox: Mailbox;
  onRemoved: () => void;
}) {
  const displayName = useNativeState(name(mailbox));
  const update = (patch: { displayName?: string; color?: string }) =>
    void core
      .invoke("gmail:updateAccount", { accountId: mailbox.id, ...patch })
      .then(() => mailboxes.refreshAccounts())
      .catch((e: unknown) =>
        Alert.alert("Couldn't save", e instanceof Error ? e.message : String(e)),
      );

  const remove = () =>
    Alert.alert(
      `Remove ${name(mailbox)}?`,
      "Removes it from your Otter account on every device and signs this iPhone out of it. Nothing is deleted from your mail provider.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            onRemoved();
            void core
              .invoke("gmail:removeAccount", { accountId: mailbox.id })
              .then(() => mailboxes.refreshAccounts());
          },
        },
      ],
    );

  return (
    <SettingsForm colors={colors} title={name(mailbox)}>
      <Group
        colors={colors}
        footer={
          <Text>
            Shown in the sidebar and on its mail, on every device. Only used in Otter Mail.
          </Text>
        }
      >
        <LabeledContent label="Display name">
          <TextField
            placeholder="Name"
            text={displayName}
            modifiers={[
              multilineTextAlignment("trailing"),
              onSubmit(() => {
                const trimmed = displayName.value.trim();
                if (trimmed && trimmed !== name(mailbox)) update({ displayName: trimmed });
              }),
            ]}
          />
        </LabeledContent>
        <ColorPicker
          label="Color"
          selection={mailbox.color ?? colors.accent}
          supportsOpacity={false}
          onSelectionChange={(color) => update({ color })}
        />
      </Group>
      <Group colors={colors}>
        <LabeledContent label="Address">
          <Text
            modifiers={[
              foregroundStyle(colors.secondary),
              frame({ maxWidth: Infinity, alignment: "trailing" }),
            ]}
          >
            {mailbox.email}
          </Text>
        </LabeledContent>
      </Group>
      <Group colors={colors}>
        <Button label="Remove mailbox" role="destructive" onPress={remove} />
      </Group>
    </SettingsForm>
  );
}
