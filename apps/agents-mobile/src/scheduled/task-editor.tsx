import { useAgentProviders } from "@otter/client/agents/agent-providers";
import { keyOf, useScheduledTasks } from "@otter/client/agents/agent-scheduled";
import {
  MONTH_DAY_OPTIONS,
  REPEATS,
  TIMED,
  UNIT_OPTIONS,
  WEEKDAY_OPTIONS,
  destinationAccount,
  destinationChannel,
  pickDestination,
  resultsDescription,
  resultsOptions,
  targetHint,
  useDeliveryTargets,
  useTaskEditor,
} from "@otter/client/agents/scheduled-editor";
import { localDateTime, type Repeat, type WhenForm } from "@otter/client/agents/scheduled-text";
import type { AgentScheduledTasks, ScheduledTask } from "@otter/contracts/scheduled";
import type { Destination } from "@otter/client/agents/agent-scheduled";
import { Chip } from "@otter/ui-native/components/chip";
import { SettingsSection } from "@otter/ui-native/components/settings";
import { Sheet } from "@otter/ui-native/components/sheet";
import { Spinner } from "@otter/ui-native/components/spinner";
import { Text } from "@otter/ui-native/components/text";
import { useTheme } from "@otter/ui-native/theme";
import { router, useLocalSearchParams, usePreventRemove } from "expo-router";
import { useRef, useState } from "react";
import { ActionSheetIOS, ScrollView, View } from "react-native";

import { agentTraits } from "../agents/registry.ts";
import { DateCell, FieldCell, PickerCell, SegmentedCell, StepperCell } from "./form.tsx";

/** Makes a scheduled task, or changes one (TaskEditor.swift): who runs it, what it does, when, and where its results go. */
export function TaskEditor() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const query = useScheduledTasks();
  const providers = useAgentProviders().data?.providers;
  const agents = query.data;
  const task = id ? agents?.flatMap((a) => a.tasks).find((t) => keyOf(t) === id) : null;
  const title = id ? "Edit task" : "New scheduled task";
  if (!agents || !providers || task === undefined)
    return (
      <Sheet title={title} onCancel={() => router.back()} tint={theme.colors.primary}>
        {query.isLoading ? (
          <Spinner />
        ) : (
          <Text size="base" color="mutedForeground" style={{ textAlign: "center" }}>
            This task is gone.
          </Text>
        )}
      </Sheet>
    );
  return <Editor title={title} task={task} agents={agents} providers={providers} />;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "HH:MM" as today's date at that time, for the time picker. */
function timeDate(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hour || 0, minute || 0, 0, 0);
  return date;
}

function Editor({
  title,
  task,
  agents,
  providers,
}: {
  title: string;
  task: ScheduledTask | null;
  agents: AgentScheduledTasks[];
  providers: NonNullable<ReturnType<typeof useAgentProviders>["data"]>["providers"];
}) {
  const theme = useTheme();
  const [changed, setChanged] = useState(false);
  const created = useRef<string | null>(null);
  const editor = useTaskEditor({
    task,
    agents,
    providers,
    subAgents: (kind) => Boolean(agentTraits(kind)?.subAgents),
    onCreated: (key) => {
      created.current = key;
    },
  });
  const { when } = editor;
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setChanged(true);
      set(value);
    };
  const setWhen = change((patch: Partial<WhenForm>) => editor.setWhen(patch));

  // SwiftUI's `interactiveDismissDisabled` with a question: Cancel, a swipe down or any other
  // way out asks before dropping changes.
  const allowLeaving = usePreventRemove(changed, ({ repeat }) =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: ["Discard changes", "Keep editing"],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index !== 0) return;
        setChanged(false);
        repeat();
      },
    ),
  );

  const save = async () => {
    try {
      await editor.save();
    } catch {
      return;
    }
    setChanged(false);
    allowLeaving();
    router.back();
    if (created.current)
      router.push({ pathname: "/scheduled/[id]", params: { id: created.current } });
  };

  return (
    <Sheet
      title={title}
      onCancel={() => router.back()}
      onDone={() => void save()}
      doneLabel={editor.busy ? "Saving…" : task ? "Save" : "Schedule"}
      doneDisabled={editor.busy || !editor.owner}
      tint={theme.colors.primary}
    >
      <Text size="sm" color="mutedForeground" style={{ paddingHorizontal: 8 }}>
        The agent runs it on its own, on time, whether or not Otter is open.
      </Text>
      {!task && editor.owners.length > 1 ? (
        <SettingsSection>
          <PickerCell
            title="Agent"
            value={editor.owner}
            options={editor.owners}
            onChange={change(editor.setOwner)}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection>
        <FieldCell placeholder="Name" value={editor.name} onChangeText={change(editor.setName)} />
        {editor.asksPrompt ? (
          <FieldCell
            placeholder="What should it do?"
            value={editor.prompt}
            onChangeText={change(editor.setPrompt)}
            multiline
          />
        ) : null}
      </SettingsSection>
      {editor.picksModel ? (
        <SettingsSection>
          <PickerCell
            title="Model"
            value={editor.modelValue}
            options={editor.modelOptions}
            onChange={change(editor.setModel)}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="When" footer={editor.summary ?? undefined}>
        <PickerCell
          title="Repeats"
          value={when.repeat}
          options={REPEATS}
          onChange={(repeat) => setWhen({ repeat: repeat as Repeat })}
        />
        {when.repeat === "weekly" ? (
          <PickerCell
            title="Day"
            value={String(when.weekday)}
            options={WEEKDAY_OPTIONS}
            onChange={(day) => setWhen({ weekday: Number(day) })}
          />
        ) : null}
        {when.repeat === "monthly" ? (
          <PickerCell
            title="Day"
            value={String(when.monthDay)}
            options={MONTH_DAY_OPTIONS}
            onChange={(day) => setWhen({ monthDay: Number(day) })}
          />
        ) : null}
        {TIMED.has(when.repeat) ? (
          <DateCell
            title="At"
            value={timeDate(when.time)}
            onChange={(date) =>
              setWhen({ time: `${pad(date.getHours())}:${pad(date.getMinutes())}` })
            }
          />
        ) : null}
        {when.repeat === "interval" ? (
          <StepperCell
            title={`Every ${when.every}`}
            value={when.every}
            min={1}
            max={999}
            onChange={(every) => setWhen({ every })}
          />
        ) : null}
        {when.repeat === "interval" ? (
          <SegmentedCell
            value={when.unit}
            options={UNIT_OPTIONS}
            onChange={(unit) => setWhen({ unit: unit as WhenForm["unit"] })}
          />
        ) : null}
        {when.repeat === "once" ? (
          <DateCell
            title="On"
            date
            value={new Date(when.once)}
            from={new Date()}
            onChange={(date) => setWhen({ once: localDateTime(date) })}
          />
        ) : null}
        {when.repeat === "cron" ? (
          <FieldCell
            placeholder="minute hour day month weekday"
            label="Cron expression"
            value={when.cron}
            onChangeText={(cron) => setWhen({ cron })}
            mono
          />
        ) : null}
        {editor.zoned ? (
          <PickerCell
            title="Time zone"
            value={editor.zoneValue}
            options={editor.zoneOptions}
            onChange={change(editor.setZone)}
          />
        ) : null}
      </SettingsSection>
      {editor.agentTasks && editor.routes ? (
        <Results
          task={task}
          agent={editor.agentTasks}
          agentId={editor.agentId}
          value={editor.destination}
          onChange={change(editor.setDestination)}
        />
      ) : null}
      {editor.needsDeliveries ? (
        <Text size="body" color="mutedForeground" style={{ paddingHorizontal: 8 }}>
          To get results in Otter, set up Messages from your agents in {editor.ownerName}'s
          settings.
        </Text>
      ) : null}
      {editor.error ? (
        <Text size="sm" color="error" accessibilityRole="alert" style={{ paddingHorizontal: 8 }}>
          {editor.error}
        </Text>
      ) : null}
    </Sheet>
  );
}

/** Where results go: Otter, a channel and who on it, a webhook, or nowhere. */
function Results({
  task,
  agent,
  agentId,
  value,
  onChange,
}: {
  task: ScheduledTask | null;
  agent: AgentScheduledTasks;
  agentId: string;
  value: Destination;
  onChange: (dest: Destination) => void;
}) {
  const channel = destinationChannel(agent, value);
  const account = destinationAccount(value, channel);
  const suggestions = useDeliveryTargets(agent, agentId, channel, account);
  const set = (patch: Partial<Destination>) => onChange({ ...value, ...patch });
  return (
    <SettingsSection title="Send results to">
      <View>
        <PickerCell
          value={value.pick}
          options={resultsOptions(task, agent)}
          onChange={(pick) => onChange(pickDestination(value, pick, task, agent))}
        />
        <Text
          size="body"
          color="mutedForeground"
          style={{ paddingHorizontal: 16, paddingBottom: 12, marginTop: -4 }}
        >
          {resultsDescription(value, channel)}
        </Text>
      </View>
      {channel && channel.accounts.length > 1 ? (
        <PickerCell
          title="Sent as"
          value={account ?? ""}
          options={channel.accounts.map((a) => ({ value: a, label: a }))}
          onChange={(next) => set({ account: next })}
        />
      ) : null}
      {channel ? (
        <View>
          <FieldCell
            placeholder={targetHint(channel.id)}
            label={`Who on ${channel.label}`}
            value={value.to}
            onChangeText={(to) => set({ to })}
            mono
          />
          {suggestions.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}
            >
              {suggestions.map((t) => (
                <Chip
                  key={`${t.accountId}|${t.target}`}
                  text={t.label ?? t.target}
                  selected={value.to === t.target}
                  onPress={() => set({ to: t.target })}
                />
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      {value.pick === "webhook" ? (
        <FieldCell
          placeholder="https://example.com/hooks/otter"
          label="Webhook address"
          value={value.url}
          onChangeText={(url) => set({ url })}
          url
        />
      ) : null}
    </SettingsSection>
  );
}
