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
  RNHostView,
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
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import { useEffect, useState, type ReactNode } from "react";
import { Image } from "react-native";

import type { RootStack } from "../../App";
import { useAgentProviders } from "../../state/chats";
import { mailboxes } from "../../state/client";
import { core, developmentVariant } from "../../state/core";
import { inDemo, otterUserAtom, realtimeAtom, setDemo } from "../../state/otter";
import { flag, setUiPreference, uiPreferencesAtom } from "../../state/preferences";
import { availableThemes, themeId, themeSource, usePalette, type Palette } from "../theme";
import { AccountSettings } from "./AccountSettings";
import { AgentSettings } from "./AgentSettings";
import { arrangeScopes, isShown, parseArrangement } from "./arrangement";
import { languageSummary } from "./languages";
import { LanguagesSettings, useTranslationSettings } from "./LanguagesSettings";
import { MailboxesSettings, MailboxSettings } from "./MailboxesSettings";
import { SupportSettings } from "./SupportSettings";
import { ThemeSettings } from "./ThemeSettings";

type Props = NativeStackScreenProps<RootStack, "Settings">;

const REALTIME: Record<string, string> = { live: "On", connecting: "Connecting…", off: "Off" };

type NotificationsMode = "off" | "inbox" | "all";

/** `settings.notificationsMode` (core's settings, synced with the Otter account). */
function useNotificationsMode(): [NotificationsMode, (mode: NotificationsMode) => void] {
  const [mode, setMode] = useState<NotificationsMode>("inbox");
  useEffect(() => {
    const load = () =>
      void core.invoke<{ notificationsMode?: NotificationsMode }>("gmail:getSyncSettings").then(
        (s) => setMode(s.notificationsMode ?? "inbox"),
        () => {},
      );
    load();
    return core.on("settings:changed", load);
  }, []);
  return [
    mode,
    (next) => {
      setMode(next);
      void core.invoke("gmail:setSyncSettings", { notificationsMode: next }).catch(() => {});
    },
  ];
}

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
  const user = useAtomValue(otterUserAtom);
  const realtime = useAtomValue(realtimeAtom);
  const [path, setPath] = useState<string[]>([]);
  const providers = useAgentProviders();
  const [notifications, setNotifications] = useNotificationsMode();
  const [translation, setTranslation] = useTranslationSettings();

  const arrangement = parseArrangement(ui["mail:mailboxes"]);
  const on = arrangeScopes(accounts, arrangement).filter((s) => isShown(s, arrangement)).length;
  const themes = availableThemes(ui);
  const label = (id: string) => themes.find((t) => t.id === id)?.label ?? id;
  const light = label(themeId(ui, "light"));
  const dark = label(themeId(ui, "dark"));
  const agent = providers.find((p) => p.auth.status === "authenticated");
  const set = (key: string) => (value: boolean | string) => setUiPreference(key, String(value));
  const picture = user?.picture;

  return (
    <Host style={{ flex: 1 }} colorScheme={colors.dark ? "dark" : "light"}>
      <NavigationStack path={path} onPathChange={setPath}>
        <Toolbar>
          <SettingsForm colors={colors} title="Settings">
            <Section modifiers={[listRowBackground("transparent")]}>
              <VStack spacing={8} modifiers={[frame({ maxWidth: Infinity })]}>
                <RNHostView matchContents>
                  <Image
                    source={picture ? { uri: picture } : require("../../../assets/otter-mark.png")}
                    style={{ width: 64, height: 64, borderRadius: 32 }}
                    accessibilityIgnoresInvertColors
                  />
                </RNHostView>
                <Text modifiers={[font({ textStyle: "headline" })]}>
                  {user ? (user.name ?? user.email) : "Demo mailbox"}
                </Text>
                <Text
                  modifiers={[
                    font({ textStyle: "subheadline" }),
                    foregroundStyle(colors.secondary),
                    multilineTextAlignment("center"),
                  ]}
                >
                  {user?.email ?? "Pretend mail, to try Otter Mail. Nothing here reaches Google."}
                </Text>
              </VStack>
            </Section>

            <Group
              colors={colors}
              title="Mail"
              footer={
                inDemo ? undefined : (
                  <Text>
                    Connect background notifications for each mailbox to receive alerts while the
                    app is closed. Alerts are sent only for verified new mail; sender and preview
                    load on this iPhone.
                  </Text>
                )
              }
            >
              <NavigationLink value="mailboxes">
                <LabeledContent label={<Label title="Mailboxes" systemImage="tray.2" />}>
                  <Text>{`${on} on`}</Text>
                </LabeledContent>
              </NavigationLink>
              <Picker
                label={<Label title="Notifications" systemImage="bell" />}
                selection={notifications}
                onSelectionChange={(mode) => setNotifications(mode as NotificationsMode)}
              >
                <Text modifiers={[tag("off")]}>Off</Text>
                <Text modifiers={[tag("inbox")]}>Inbox only</Text>
                <Text modifiers={[tag("all")]}>All new mail</Text>
              </Picker>
              {inDemo ? null : (
                <NavigationLink value="mailboxes">
                  <Text>Background notification setup</Text>
                </NavigationLink>
              )}
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

            <Group
              colors={colors}
              title="Translation"
              footer={
                <Text>
                  Mail in other languages is translated on this iPhone, by Apple's Translation.
                </Text>
              }
            >
              <NavigationLink value="languages">
                <LabeledContent
                  label={<Label title="Languages I read" systemImage="character.bubble" />}
                >
                  <Text>{languageSummary(translation.readLanguages)}</Text>
                </LabeledContent>
              </NavigationLink>
              <Toggle
                label="Translate automatically"
                systemImage="translate"
                isOn={translation.autoTranslate}
                onIsOnChange={(autoTranslate) => setTranslation({ autoTranslate })}
              />
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
              {user ? (
                <NavigationLink value="account">
                  <Label title="Otter account" systemImage="person.crop.circle" />
                </NavigationLink>
              ) : (
                <Button
                  label="Sign in with Google"
                  systemImage="person.crop.circle.badge.plus"
                  onPress={() => setDemo(false)}
                />
              )}
              {realtime && user ? (
                <LabeledContent
                  label={<Label title="Live updates" systemImage="dot.radiowaves.left.and.right" />}
                >
                  <Text>{REALTIME[realtime] ?? realtime}</Text>
                </LabeledContent>
              ) : null}
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
            onAddImap={() => {
              navigation.goBack();
              navigation.navigate("AddImap");
            }}
          />
        </NavigationDestination>
        {accounts.map((m) => (
          <NavigationDestination key={m.id} value={`mailbox:${m.id}`}>
            <MailboxSettings
              colors={colors}
              mailbox={m}
              signedIn={Boolean(user)}
              onRemoved={() => setPath(["mailboxes"])}
            />
          </NavigationDestination>
        ))}
        <NavigationDestination value="languages">
          <LanguagesSettings colors={colors} />
        </NavigationDestination>
        <NavigationDestination value="account">
          <AccountSettings colors={colors} />
        </NavigationDestination>
        <NavigationDestination value="theme">
          <ThemeSettings colors={colors} />
        </NavigationDestination>
        <NavigationDestination value="agents">
          <AgentSettings colors={colors} signedIn={Boolean(user)} />
        </NavigationDestination>
      </NavigationStack>
    </Host>
  );
}
