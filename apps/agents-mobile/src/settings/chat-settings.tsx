import { useAgentProviders } from "@otter/client/agents/agent-providers";
import {
  AUTO_SETTLE_DEFAULT_DAYS,
  AUTO_SETTLE_MAX_DAYS,
  setAutoSettleDays,
  useAutoSettleDays,
} from "@otter/client/agents/auto-settle";
import {
  autoSettleDaysOf,
  FOLLOW_UP_BEHAVIORS,
  useUpdateAgents,
} from "@otter/client/agents/agent-settings";
import {
  setFollowUpBehavior,
  useFollowUpBehavior,
  type FollowUpBehavior,
} from "@otter/client/agents/chat-queue";
import {
  SettingsCell,
  SettingsPage,
  SettingsSection,
  SettingsSwitchRow,
} from "@otter/ui-native/components/settings";
import { Text } from "@otter/ui-native/components/text";
import { typeStyle, useTheme } from "@otter/ui-native/theme";
import { Stack } from "expo-router";
import { useState } from "react";
import { TextInput } from "react-native";

import { PickerRow } from "./menus.tsx";

/** Settings › Chat (SettingsScreen.swift's ChatSettings): the agent new chats start with, follow-ups, settling. */
export function ChatSettings() {
  const state = useAgentProviders().data;
  const update = useUpdateAgents();
  const followUp = useFollowUpBehavior();
  const choices = (state?.providers ?? []).filter((p) => p.enabled);
  return (
    <SettingsPage>
      <Stack.Screen options={{ title: "Chat" }} />
      {choices.length > 0 ? (
        <SettingsSection footer="The agent a new chat runs on. You can switch in the chat's agent picker.">
          <PickerRow
            title="New chats start with"
            value={state?.selected ?? ""}
            options={choices.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(id) => update({ selected: id })}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection footer="Queue follow-ups while the agent runs or steer the current run. Touch and hold Send to do the opposite for one message.">
        <PickerRow
          title="Follow-up behavior"
          value={followUp}
          options={FOLLOW_UP_BEHAVIORS}
          onChange={(next) => setFollowUpBehavior(next as FollowUpBehavior)}
        />
      </SettingsSection>
      <AutoSettle />
    </SettingsPage>
  );
}

/** How many quiet days settle a chat on its own (T3 Code's auto-settle), or never. */
function AutoSettle() {
  const theme = useTheme();
  const days = useAutoSettleDays();
  const [typed, setTyped] = useState<string | null>(null);
  const save = () => {
    const next = typed === null ? null : autoSettleDaysOf(typed);
    if (next !== null) setAutoSettleDays(next);
    setTyped(null);
  };
  return (
    <SettingsSection
      title="Auto-settle"
      footer={`Chats with no new messages for a while settle on their own, after 1 to ${AUTO_SETTLE_MAX_DAYS} days. Any new message brings a chat back.`}
    >
      <SettingsSwitchRow
        title="Auto-settle inactive chats"
        value={days !== null}
        onValueChange={(on) => setAutoSettleDays(on ? AUTO_SETTLE_DEFAULT_DAYS : null)}
      />
      {days !== null ? (
        <SettingsCell>
          <Text size="base" style={{ flex: 1 }}>
            Days before auto-settle
          </Text>
          <TextInput
            value={typed ?? String(days)}
            onChangeText={setTyped}
            onEndEditing={save}
            keyboardType="number-pad"
            returnKeyType="done"
            selectTextOnFocus
            accessibilityLabel="Days of inactivity before auto-settle"
            style={[
              typeStyle(theme, "base"),
              { color: theme.colors.mutedForeground, textAlign: "right", minWidth: 60 },
            ]}
          />
        </SettingsCell>
      ) : null}
    </SettingsSection>
  );
}
