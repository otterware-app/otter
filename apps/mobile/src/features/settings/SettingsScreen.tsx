import { useAtomValue } from "@effect/atom-react";
import {
  Button,
  Form,
  Host,
  Label,
  LabeledContent,
  NavigationDestination,
  NavigationLink,
  NavigationStack,
  Picker,
  Section,
  Text,
  Toggle,
  Toolbar,
  ToolbarItem,
  VStack,
} from "@expo/ui/swift-ui";
import {
  background,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  multilineTextAlignment,
  navigationTitle,
  scrollContentBackground,
  tag,
  toolbarTitleDisplayMode,
} from "@expo/ui/swift-ui/modifiers";
import { OTTER_ACCOUNT_STATE_CHANNEL } from "@otter-mail/contracts";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import { useEffect, useState, type ReactNode } from "react";
import { Alert } from "react-native";

import type { RootStack } from "../../App";
import { useAgentProviders } from "../../state/chats";
import { mailboxes } from "../../state/client";
import { core, developmentVariant } from "../../state/core";
import { flag, setUiPreference, uiPreferencesAtom } from "../../state/preferences";
import { availableThemes, themeId, themeSource, usePalette, type Palette } from "../theme";
import { AgentSettings } from "./AgentSettings";
import { arrangement, MailboxesSettings, MailboxSettings } from "./MailboxesSettings";
import { SupportSettings } from "./SupportSettings";
import { ThemeSettings } from "./ThemeSettings";

type Props = NativeStackScreenProps<RootStack, "Settings">;

const REALTIME: Record<string, string> = { live: "On", connecting: "Connecting…", off: "Off" };

export type OtterState = {
  user: { email: string; name: string | null; image?: string | null } | null;
  realtime?: string;
};

/** The Swift app's SettingsForm: an inset grouped list on the theme's canvas, its rows on cards. */
export function SettingsForm({
  colors,
  title,
  children,
}: {
  colors: Palette;
  title: string;
  children: ReactNode;
}) {
  return (
    <Form
      modifiers={[
        scrollContentBackground("hidden"),
        background(colors.canvas),
        foregroundStyle(colors.text),
        navigationTitle(title),
        toolbarTitleDisplayMode("inline"),
      ]}
    >
      {children}
    </Form>
  );
}

/** A section whose rows sit on the theme's cards. */
export function Group({ colors, ...props }: Parameters<typeof Section>[0] & { colors: Palette }) {
  return <Section {...props} modifiers={[listRowBackground(colors.card)]} />;
}

/**
 * The Swift app's SettingsView, in SwiftUI (@expo/ui): the Otter account, Mail,
 * Agents, Appearance, the message list, and the account. Its pages push on a
 * SwiftUI NavigationStack inside the modal.
 */
export function SettingsScreen({ navigation }: Props) {
  const colors = usePalette();
  const ui = useAtomValue(uiPreferencesAtom);
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const [path, setPath] = useState<string[]>([]);
  const [otter, setOtter] = useState<OtterState | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useAgentProviders();

  useEffect(() => {
    void core.invoke<OtterState>("otter:getState").then(setOtter, () => {});
    return core.on(OTTER_ACCOUNT_STATE_CHANNEL, (state) => setOtter(state as OtterState));
  }, []);

  const signIn = async () => {
    setBusy(true);
    try {
      const state = await core.invoke<OtterState | null>("otter:signIn");
      if (state) setOtter(state);
    } catch (e) {
      Alert.alert("Couldn't sign in", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const off = arrangement(ui).off;
  const on = accounts.filter((m) => !off.includes(m.email)).length;
  const themes = availableThemes(ui);
  const label = (id: string) => themes.find((t) => t.id === id)?.label ?? id;
  const light = label(themeId(ui, "light"));
  const dark = label(themeId(ui, "dark"));
  const agent = providers.find((p) => p.auth.status === "authenticated");
  const set = (key: string) => (value: boolean | string) => setUiPreference(key, String(value));

  return (
    <Host style={{ flex: 1 }} colorScheme={colors.dark ? "dark" : "light"}>
      <NavigationStack path={path} onPathChange={setPath}>
        <Toolbar>
          <SettingsForm colors={colors} title="Settings">
            <Section modifiers={[listRowBackground("transparent")]}>
              <VStack spacing={6} modifiers={[frame({ maxWidth: Infinity })]}>
                <Text modifiers={[font({ textStyle: "headline" })]}>
                  {otter?.user ? (otter.user.name ?? otter.user.email) : "Not signed in"}
                </Text>
                <Text
                  modifiers={[
                    font({ textStyle: "subheadline" }),
                    foregroundStyle(colors.secondary),
                    multilineTextAlignment("center"),
                  ]}
                >
                  {otter?.user
                    ? otter.user.email
                    : "Sign in to your Otter account for your mailboxes, preferences and chats on every device."}
                </Text>
              </VStack>
            </Section>

            <Group colors={colors} title="Mail">
              <NavigationLink value="mailboxes">
                <LabeledContent label={<Label title="Mailboxes" systemImage="tray.2" />}>
                  <Text>{`${on} on`}</Text>
                </LabeledContent>
              </NavigationLink>
              <Picker
                label={<Label title="After archive" systemImage="arrow.turn.down.right" />}
                selection={ui["gmail:advance-direction"] ?? "next"}
                onSelectionChange={set("gmail:advance-direction")}
              >
                <Text modifiers={[tag("next")]}>Next message</Text>
                <Text modifiers={[tag("previous")]}>Previous message</Text>
                <Text modifiers={[tag("none")]}>Back to the list</Text>
              </Picker>
            </Group>

            <Group colors={colors}>
              <NavigationLink value="agents">
                <LabeledContent label={<Label title="Agents" systemImage="sparkles" />}>
                  <Text>{agent ? agent.displayName : "Off"}</Text>
                </LabeledContent>
              </NavigationLink>
            </Group>

            <Group colors={colors} title="Appearance">
              <Picker
                label={<Label title="Color scheme" systemImage="circle.lefthalf.filled" />}
                selection={themeSource(ui)}
                onSelectionChange={set("otter:theme-source")}
              >
                <Text modifiers={[tag("system")]}>System</Text>
                <Text modifiers={[tag("light")]}>Light</Text>
                <Text modifiers={[tag("dark")]}>Dark</Text>
              </Picker>
              <NavigationLink value="theme">
                <LabeledContent label={<Label title="Theme" systemImage="paintpalette" />}>
                  <Text>{light === dark ? light : `${light}, ${dark}`}</Text>
                </LabeledContent>
              </NavigationLink>
              <Toggle
                label="Full-width messages"
                systemImage="arrow.left.and.right"
                isOn={flag(ui, "otter:full-width-messages", false)}
                onIsOnChange={set("otter:full-width-messages")}
              />
            </Group>

            <Group colors={colors} title="Message list">
              <Toggle
                isOn={flag(ui, "otter:group-messages-by-day", true)}
                onIsOnChange={set("otter:group-messages-by-day")}
              >
                <Text>Group messages by day</Text>
                <Text
                  modifiers={[font({ textStyle: "footnote" }), foregroundStyle(colors.secondary)]}
                >
                  Separate messages by day. Tap a day's heading to collapse or expand it.
                </Text>
              </Toggle>
              <Toggle
                isOn={flag(ui, "otter:full-width-rows", false)}
                onIsOnChange={set("otter:full-width-rows")}
              >
                <Text>Full-width rows</Text>
                <Text
                  modifiers={[font({ textStyle: "footnote" }), foregroundStyle(colors.secondary)]}
                >
                  Run each message edge to edge with a line between them, instead of cards.
                </Text>
              </Toggle>
            </Group>

            <SupportSettings colors={colors} />

            <Group colors={colors} title="Account">
              {otter?.realtime ? (
                <LabeledContent
                  label={<Label title="Live updates" systemImage="dot.radiowaves.left.and.right" />}
                >
                  <Text>{REALTIME[otter.realtime] ?? otter.realtime}</Text>
                </LabeledContent>
              ) : null}
              {otter?.user ? (
                <Button
                  label="Sign out of your Otter account"
                  systemImage="person.crop.circle.badge.minus"
                  role="destructive"
                  onPress={() => void core.invoke<OtterState>("otter:signOut").then(setOtter)}
                />
              ) : (
                <Button
                  label={busy ? "Signing in…" : "Sign in with Google"}
                  systemImage="person.crop.circle.badge.plus"
                  onPress={() => void signIn()}
                />
              )}
              <LabeledContent label={<Label title="Version" systemImage="info.circle" />}>
                <Text>{Constants.expoConfig?.version ?? ""}</Text>
              </LabeledContent>
              {developmentVariant ? (
                <Button
                  label="Phase 0 gate"
                  systemImage="gauge.with.dots.needle.33percent"
                  onPress={() => {
                    navigation.goBack();
                    navigation.navigate("Gate");
                  }}
                />
              ) : null}
            </Group>
          </SettingsForm>
          <Toolbar.Content>
            <ToolbarItem placement="cancellationAction">
              <Button systemImage="xmark" label="Close" onPress={() => navigation.goBack()} />
            </ToolbarItem>
          </Toolbar.Content>
        </Toolbar>

        <NavigationDestination value="mailboxes">
          <MailboxesSettings
            colors={colors}
            onAdd={() => {
              navigation.goBack();
              navigation.navigate("Welcome");
            }}
          />
        </NavigationDestination>
        {accounts.map((m) => (
          <NavigationDestination key={m.id} value={`mailbox:${m.id}`}>
            <MailboxSettings colors={colors} mailbox={m} onRemoved={() => setPath([])} />
          </NavigationDestination>
        ))}
        <NavigationDestination value="theme">
          <ThemeSettings colors={colors} />
        </NavigationDestination>
        <NavigationDestination value="agents">
          <AgentSettings colors={colors} signedIn={Boolean(otter?.user)} />
        </NavigationDestination>
      </NavigationStack>
    </Host>
  );
}
