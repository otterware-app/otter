import { useAtomValue } from "@effect/atom-react";
import { Button, Form, Host, LabeledContent, SecureField, Section, Text } from "@expo/ui/swift-ui";
import { OTTER_ACCOUNT_STATE_CHANNEL } from "@otter-mail/contracts";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Alert, useColorScheme } from "react-native";

import type { RootStack } from "../../App";
import { mailboxes } from "../../state/client";
import { useAgentProviders } from "../../state/chats";
import { core } from "../../state/core";
import { PHONE_SYNC_POLICY } from "../../persistence/sync-policy";

type Props = NativeStackScreenProps<RootStack, "Settings">;

type OtterState = { user: { email: string; name: string | null } | null; realtime?: string };

const REALTIME: Record<string, string> = { live: "On", connecting: "Connecting…", off: "Off" };

/** Settings, as SwiftUI's grouped Form (@expo/ui): the Otter account, mailboxes, sync. */
export function SettingsScreen({ navigation }: Props) {
  const scheme = useColorScheme();
  const accounts = useAtomValue(mailboxes.accountsAtom).value;
  const [otter, setOtter] = useState<OtterState | null>(null);
  const [busy, setBusy] = useState(false);

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

  const remove = (accountId: string) =>
    Alert.alert("Remove this mailbox?", accountId, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void core
            .invoke("gmail:removeAccount", { accountId })
            .then(() => mailboxes.refreshAccounts()),
      },
    ]);

  const providers = useAgentProviders();
  const openrouter = providers.find((p) => p.kind === "openrouter");
  const [apiKey, setApiKey] = useState("");
  const connectOpenRouter = async () => {
    try {
      await core.invoke("agent:connectOpenRouter", { apiKey });
      setApiKey("");
    } catch (e) {
      Alert.alert("Couldn't connect OpenRouter", e instanceof Error ? e.message : String(e));
    }
  };

  const mb = (bytes: number) => `${Math.round(bytes / 1048576)} MB`;

  return (
    <Host style={{ flex: 1 }} colorScheme={scheme === "dark" ? "dark" : "light"}>
      <Form>
        <Section title="Otter account">
          {otter?.user ? (
            <>
              <LabeledContent label="Signed in as">
                <Text>{otter.user.email}</Text>
              </LabeledContent>
              {otter.realtime ? (
                <LabeledContent label="Live updates">
                  <Text>{REALTIME[otter.realtime] ?? otter.realtime}</Text>
                </LabeledContent>
              ) : null}
              <Button
                label="Sign out"
                role="destructive"
                onPress={() => void core.invoke<OtterState>("otter:signOut").then(setOtter)}
              />
            </>
          ) : (
            <Button
              label={busy ? "Signing in…" : "Sign in with Google"}
              systemImage="person.crop.circle"
              onPress={() => void signIn()}
            />
          )}
        </Section>
        {openrouter ? (
          <Section title="Agent" footer={<Text>{openrouter.message ?? ""}</Text>}>
            <LabeledContent label="OpenRouter">
              <Text>
                {openrouter.auth.status === "authenticated" ? "Connected" : "Not connected"}
              </Text>
            </LabeledContent>
            {openrouter.auth.status !== "authenticated" ? (
              <>
                <SecureField placeholder="OpenRouter API key" onTextChange={setApiKey} />
                <Button
                  label="Connect"
                  systemImage="link"
                  onPress={() => void connectOpenRouter()}
                />
              </>
            ) : (
              <Button
                label="Disconnect"
                role="destructive"
                onPress={() => void core.invoke("agent:disconnectOpenRouter")}
              />
            )}
          </Section>
        ) : null}
        <Section title="Mailboxes">
          {accounts.map((account) => (
            <Button
              key={account.id}
              label={`${account.displayName ?? account.name ?? account.email}${account.signedOut ? " · Signed out" : ""}`}
              systemImage={account.provider === "imap" ? "server.rack" : "envelope"}
              onPress={() => remove(account.id)}
            />
          ))}
          <Button
            label="Add mailbox"
            systemImage="plus"
            onPress={() => navigation.navigate("Welcome")}
          />
        </Section>
        <Section
          title="On this iPhone"
          footer={
            <Text>
              The newest mail of each mailbox and what you open stay here; search and older mail
              come from your provider.
            </Text>
          }
        >
          <LabeledContent label="Keeps">
            <Text>
              {PHONE_SYNC_POLICY.initialCoverage === "inbox" ? "Newest mail" : "Everything"}
            </Text>
          </LabeledContent>
          <LabeledContent label="Message bodies">
            <Text>{PHONE_SYNC_POLICY.bodyPrefetch ? "Downloaded ahead" : "When opened"}</Text>
          </LabeledContent>
          <LabeledContent label="Up to">
            <Text>{mb(PHONE_SYNC_POLICY.retentionBytes)}</Text>
          </LabeledContent>
        </Section>
        <Section title="About">
          <LabeledContent label="Version">
            <Text>{Constants.expoConfig?.version ?? ""}</Text>
          </LabeledContent>
          <Button
            label="Phase 0 gate"
            systemImage="gauge.with.dots.needle.33percent"
            onPress={() => navigation.navigate("Gate")}
          />
        </Section>
      </Form>
    </Host>
  );
}
