import { providerVersionLabel, useAgentProviders } from "@otter/client/agents/agent-providers";
import { agentStatus, useRemoveAgent, useUpdateAgents } from "@otter/client/agents/agent-settings";
import { agentApi, type ProviderSnapshot } from "@otter/client/agents/api";
import { MAILBOX_PICTURE_MAX_LENGTH } from "@otter/contracts/relay";
import type { AgentSettingsControls } from "@otter/mobile/extension-kit";
import { native } from "@otter/mobile/native";
import { Icon } from "@otter/ui-native/components/icon";
import {
  SettingsButton,
  SettingsCell,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "@otter/ui-native/components/settings";
import { Switch } from "@otter/ui-native/components/switch";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { setStringAsync } from "expo-clipboard";
import { launchImageLibraryAsync } from "expo-image-picker";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { TextInput, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { agentKind } from "./agent-kinds.ts";
import { Confirmation, MenuButton, PickerRow } from "./menus.tsx";
import { QRScanner, type Scanning } from "./qr-scanner.tsx";

/** An agent's page (AgentSettings.swift): its name, picture, switch, connection, and Remove. */
export function AgentPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useAgentProviders().data;
  const provider = state?.providers.find((p) => p.id === id);
  if (!provider) return <Stack.Screen options={{ title: "" }} />;
  const kindName = state?.kinds.find((k) => k.kind === provider.kind)?.name ?? "Name";
  return <Page key={provider.id} provider={provider} kindName={kindName} />;
}

function Page({ provider, kindName }: { provider: ProviderSnapshot; kindName: string }) {
  const theme = useTheme();
  const update = useUpdateAgents();
  const [name, setName] = useState(provider.name);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState<
    (Scanning & { done: (code: string | null) => void }) | null
  >(null);
  const { remove } = useRemoveAgent(provider.id, () => router.back());
  const status = agentStatus(provider);
  const Settings = agentKind(provider.kind)?.Settings;
  const version = providerVersionLabel(provider.version);
  const problem = error ?? (status.tone === "failed" ? (provider.message ?? null) : null);

  const { id, enabled } = provider;
  useEffect(() => {
    if (enabled) void agentApi.refreshProviders(id).catch(() => {});
  }, [id, enabled]);

  const rename = () => {
    const next = name.trim();
    if (next && next !== provider.name) update({ [provider.id]: { name: next } });
  };

  const choosePicture = async () => {
    setError(null);
    try {
      const picked = await launchImageLibraryAsync({ mediaTypes: ["images"] });
      if (picked.canceled) return;
      const picture = await native.makeAgentPicture(
        picked.assets[0].uri,
        MAILBOX_PICTURE_MAX_LENGTH,
      );
      update({ [provider.id]: { avatar: picture } });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  };

  const controls: AgentSettingsControls = {
    PickerRow,
    copy: (text) => void setStringAsync(text),
    scan: (what) => new Promise((done) => setScanning({ ...what, done })),
  };
  const endScan = (code: string | null) => {
    scanning?.done(code);
    setScanning(null);
  };

  return (
    <SettingsPage>
      <Stack.Screen options={{ title: provider.name }} />
      <SettingsSection>
        <View style={{ paddingVertical: 8 }}>
          <SettingsCell>
            <MenuButton
              accessibilityLabel="Picture"
              actions={[
                { title: "Choose a picture", icon: "photo", onPress: () => void choosePicture() },
                ...(provider.avatar
                  ? [
                      {
                        title: "Remove picture",
                        icon: "trash" as const,
                        destructive: true,
                        onPress: () => update({ [provider.id]: { avatar: "" } }),
                      },
                    ]
                  : []),
              ]}
            >
              <View style={{ width: 48, height: 48 }}>
                <AgentAvatar agent={provider.id} size={44} />
                <View
                  style={{
                    position: "absolute",
                    right: 0,
                    bottom: 0,
                    width: 16,
                    height: 16,
                    borderRadius: 8,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: theme.colors.card,
                  }}
                >
                  <Icon name="pencil" size={9} weight="semibold" color="foreground" />
                </View>
              </View>
            </MenuButton>
            <View style={{ flex: 1, gap: 1 }}>
              <TextInput
                value={name}
                onChangeText={setName}
                onEndEditing={rename}
                placeholder={kindName}
                placeholderTextColor={theme.colors.mutedForeground}
                returnKeyType="done"
                accessibilityLabel="Name"
                style={[typeStyle(theme, "base", "medium"), { color: theme.colors.foreground }]}
              />
              <Text
                size="sm"
                color={
                  status.tone === "ready"
                    ? "successForeground"
                    : status.tone === "failed"
                      ? "error"
                      : "mutedForeground"
                }
              >
                {status.text}
              </Text>
            </View>
            <Switch
              value={provider.enabled}
              onValueChange={(enabled) => update({ [provider.id]: { enabled } })}
              accessibilityLabel={provider.name}
            />
          </SettingsCell>
        </View>
      </SettingsSection>
      {provider.enabled && Settings ? (
        <Settings provider={provider} update={update} controls={controls} />
      ) : null}
      {provider.enabled && problem ? (
        <Text size="sm" color="error" style={{ paddingHorizontal: 8 }}>
          {problem}
        </Text>
      ) : null}
      {version ? (
        <SettingsSection>
          <SettingsRow title="Version" icon="info.circle" value={version} />
        </SettingsSection>
      ) : null}
      <SettingsSection
        footer={`${provider.name} goes from your agents on every device${provider.kind === "varys" ? ", and this iPhone's access to it ends" : ""}. Its chats stay.`}
      >
        <Confirmation
          title={`Remove ${provider.name}?`}
          message="It goes from every device, with its connection on this iPhone. Its chats stay."
          action="Remove agent"
          onConfirm={remove}
        >
          {(present) => <SettingsButton title="Remove agent" destructive onPress={present} />}
        </Confirmation>
      </SettingsSection>
      <QRScanner
        scanning={scanning}
        onScanned={(code) => endScan(code)}
        onCancel={() => endScan(null)}
      />
    </SettingsPage>
  );
}
