import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { useAddAgent } from "@otter/client/agents/agent-settings";
import { SettingsPage, SettingsRow, SettingsSection } from "@otter/ui-native/components/settings";
import { Stack, router } from "expo-router";
import { ActionSheetIOS } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";

export function useChooseAgent(open: (id: string) => void) {
  const providers = useAgentProviders().data?.providers ?? [];
  const add = useAddAgent(open);
  return (kind: string) => {
    const existing = kind === "openclaw" ? providers.filter((p) => p.kind === kind) : [];
    if (existing.length === 0) {
      add(kind);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: "Connect OpenClaw",
        message:
          "Choose your existing gateway to connect it on this iPhone and keep using its chats.",
        options: [
          ...existing.map((p) => {
            const url = p.settings.url;
            const address =
              typeof url === "string" ? url.replace(/^\w+:\/\//, "").replace(/\/$/, "") : "";
            return address ? `${p.name} · ${address}` : `${p.name} · No gateway address`;
          }),
          "Add a separate gateway",
          "Cancel",
        ],
        cancelButtonIndex: existing.length + 1,
      },
      (index) => {
        const provider = existing[index];
        if (provider) open(provider.id);
        else if (index === existing.length) add(kind);
      },
    );
  };
}

/** Add agent: the kinds this iPhone can add; the one chosen opens its page, to connect it. */
export function AddAgent() {
  const kinds = useAgentProviders().data?.kinds ?? [];
  const choose = useChooseAgent((id) =>
    router.replace({ pathname: "/settings/agents/[id]", params: { id } }),
  );
  return (
    <>
      <Stack.Screen options={{ title: "Add agent" }} />
      <SettingsPage>
        <SettingsSection>
          {kinds.map((k) => (
            <SettingsRow
              key={k.kind}
              title={k.name}
              icon={<AgentAvatar kind={k.kind} size={22} />}
              onPress={() => choose(k.kind)}
            />
          ))}
        </SettingsSection>
      </SettingsPage>
    </>
  );
}
