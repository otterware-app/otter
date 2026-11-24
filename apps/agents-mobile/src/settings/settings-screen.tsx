import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { SettingsPage, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { Stack, router } from "expo-router";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { useBottomBarInset } from "../frame/tab-root.tsx";
import { chooseScheme, schemeChoice, type SchemeChoice } from "../frame/theme-preference.ts";
import { DEV_TOOLS } from "../core.ts";

const NEXT: Record<SchemeChoice, SchemeChoice> = { system: "light", light: "dark", dark: "system" };
const NAME: Record<SchemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** Settings (SettingsScreen.swift): the account, your agents, chat, color scheme, notifications, about. */
export function SettingsScreen() {
  const inset = useBottomBarInset();
  const providers = useAgentProviders().data?.providers ?? [];
  const scheme = schemeChoice();
  return (
    <SettingsPage contentInset={{ bottom: inset }} scrollIndicatorInsets={{ bottom: inset }}>
      <Stack.Screen options={{ title: "Settings" }} />
      <SettingsSection>
        <SettingsRow
          title="Otter account"
          icon="person.crop.circle"
          onPress={() => router.push("/settings/account")}
        />
      </SettingsSection>
      <SettingsSection title="Agents">
        {providers.map((p) => (
          <SettingsRow
            key={p.id}
            title={p.name}
            icon={<AgentAvatar agent={p.id} size={22} />}
            onPress={() => router.push({ pathname: "/settings/agents/[id]", params: { id: p.id } })}
          />
        ))}
        <SettingsRow
          title="Add agent"
          icon="plus"
          chevron={false}
          onPress={() => router.push("/settings/agents/new")}
        />
      </SettingsSection>
      <SettingsSection>
        <SettingsRow
          title="Chat"
          icon="bubble.left.and.bubble.right"
          onPress={() => router.push("/settings/chat")}
        />
        <SettingsRow
          title="Color scheme"
          icon="circle.lefthalf.filled"
          value={NAME[scheme]}
          chevron={false}
          onPress={() => chooseScheme(NEXT[scheme])}
        />
        <SettingsRow
          title="Notifications"
          icon="bell.badge"
          onPress={() => router.push("/settings/notifications")}
        />
      </SettingsSection>
      <SettingsSection title="About">
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
  );
}
