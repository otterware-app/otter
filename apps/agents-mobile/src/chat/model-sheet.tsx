import { Button as MenuButton, Host, Menu, RNHostView } from "@expo/ui/swift-ui";
import { accessibilityLabel, buttonStyle } from "@expo/ui/swift-ui/modifiers";
import {
  isProviderUsable,
  useAgentProviders,
  useSetProvidersState,
} from "@otter/client/agents/agent-providers";
import {
  agentApi,
  type AgentSettingsPatch,
  type ProviderModel,
  type ProviderModelOption,
  type ProviderSnapshot,
} from "@otter/client/agents/api";
import { agentPick, composerControls } from "@otter/client/agents/composer";
import {
  agentItems,
  agentUnavailable,
  currentChoice,
  pickerModels,
  RUNTIME_MODES,
  runtimeModeOf,
  searchAgentItems,
  type AgentItem,
} from "@otter/client/agents/model-picker";
import { modelKey, toggleFavorite, useModelPrefs } from "@otter/client/agents/model-prefs";
import { host } from "@otter/client/host";
import { Button } from "@otter/ui-native/components/button";
import { Glass } from "@otter/ui-native/components/glass";
import { Icon } from "@otter/ui-native/components/icon";
import { Separator } from "@otter/ui-native/components/separator";
import { Sheet } from "@otter/ui-native/components/sheet";
import { Switch } from "@otter/ui-native/components/switch";
import { Text } from "@otter/ui-native/components/text";
import { haptics } from "@otter/ui-native/haptics";
import { alpha, typeStyle, useTheme } from "@otter/ui-native/theme";
import { router, useLocalSearchParams } from "expo-router";
import { Fragment, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";

import { AgentAvatar } from "../agents/agent-avatar.tsx";
import { agentTraits } from "../agents/registry.ts";
import { useChatAgent } from "./chat-agent.ts";

/** The maker's mark for a group of models, where the app has it: Anthropic's Claude, OpenAI's. */
const MAKERS: Record<string, string> = { anthropic: "claude", openai: "codex" };

/**
 * Who a chat talks to (ModelSheet.swift). A chat not started yet can go to any of your agents, a
 * gateway's agents each a row of their own; once it has turns it stays with its agent. Under the
 * chosen agent come its models and how hard they think, where it has a choice.
 */
export function ModelSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const chat = useChatAgent(id);
  const state = useAgentProviders().data;
  const setState = useSetProvidersState();
  const prefs = useModelPrefs();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const current = chat.provider;
  const controls = composerControls(current, chat.traits);
  const subAgents = (kind: string) => Boolean(agentTraits(kind)?.subAgents);
  const kindName = (kind: string) => state?.kinds.find((k) => k.kind === kind)?.name ?? kind;

  const update = (patch: AgentSettingsPatch) => void agentApi.updateSettings(patch).then(setState);
  const pickAgent = (item: AgentItem) => {
    if (!chat.blank) return;
    haptics.tap();
    update(agentPick(item.provider.id, item.agent));
  };
  const pickModel = (provider: ProviderSnapshot, model: ProviderModel) => {
    haptics.tap();
    update({
      ...(chat.blank ? agentPick(provider.id, null) : {}),
      [provider.id]: { model: model.slug },
    });
  };

  const offered = chat.blank ? (state?.providers ?? []) : current ? [current] : [];
  const items = searchAgentItems(agentItems(offered, subAgents, kindName), query).filter(
    (item) => chat.blank || item.agent === null || item.agent === chat.gatewayAgent,
  );
  const choosable = (p: ProviderSnapshot) =>
    isProviderUsable(p) && !subAgents(p.kind) && p.models.length > 1;
  const favorites = offered.filter(choosable).flatMap((p) =>
    pickerModels(p, prefs, query)
      .filter((m) => prefs.favorites.includes(modelKey(p.id, m.slug)))
      .map((model) => ({ provider: p, model })),
  );
  const models = current && controls.pickModels ? pickerModels(current, prefs, query) : [];
  const groups = [...new Set(models.map((m) => m.subProvider ?? ""))];
  const usable = isProviderUsable(current);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await agentApi.refreshProviders(chat.blank ? undefined : current?.id);
    } catch {
      host().notice({ tone: "error", title: "Couldn't refresh agents" });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Sheet
      title={chat.blank ? "Agent and model" : "Model"}
      onDone={() => router.back()}
      scrolls={false}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        alwaysBounceVertical
        contentContainerStyle={{ gap: 18 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        <Glass
          interactive
          style={{
            height: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 14,
          }}
        >
          <Icon name="magnifyingglass" size={17} color="mutedForeground" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find an agent or model"
            placeholderTextColor={theme.colors.mutedForeground}
            accessibilityLabel="Find an agent or model"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            selectionColor={theme.colors.ring}
            style={[typeStyle(theme, "lg"), { flex: 1, color: theme.colors.foreground }]}
          />
        </Glass>
        {offered.length === 0 ? (
          <View style={{ alignItems: "center", gap: 8, paddingHorizontal: 14, paddingTop: 40 }}>
            <Text size="xl" weight="semibold">
              No agents yet
            </Text>
            <Text size="md" color="mutedForeground" style={{ textAlign: "center" }}>
              Chats run on your agents: add Hermes, OpenClaw or varys in Settings › Agents.
            </Text>
            <Button
              variant="primary"
              title="Open Settings"
              style={{ marginTop: 6, alignSelf: "center" }}
              onPress={() => {
                router.back();
                router.navigate("/settings/agents");
              }}
            />
          </View>
        ) : null}
        {favorites.length > 0 ? (
          <Group header="Favorites" star>
            {favorites.map(({ provider, model }, index) => (
              <ModelRow
                key={modelKey(provider.id, model.slug)}
                first={index === 0}
                last={index === favorites.length - 1}
                provider={provider}
                model={model}
                showAgent
                selected={current?.id === provider.id && provider.model === model.slug}
                starred
                onPick={() => pickModel(provider, model)}
              />
            ))}
          </Group>
        ) : null}
        {items.length > 0 ? (
          <Group header="Agent">
            {items.map((item, index) => (
              <AgentRow
                key={item.key}
                first={index === 0}
                last={index === items.length - 1}
                item={item}
                selected={
                  current?.id === item.provider.id &&
                  (item.agent === null || item.agent === chat.gatewayAgent)
                }
                onPick={() => pickAgent(item)}
              />
            ))}
          </Group>
        ) : null}
        {current && usable && models.length > 0 ? (
          <Group header="Model">
            {groups.map((group) => {
              const rows = models.filter((m) => (m.subProvider ?? "") === group);
              return (
                <Fragment key={group}>
                  {groups.length > 1 ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        paddingHorizontal: 14,
                        paddingTop: 8,
                      }}
                    >
                      {MAKERS[group.toLowerCase()] ? (
                        <AgentAvatar kind={MAKERS[group.toLowerCase()]} size={14} />
                      ) : null}
                      <Text size="xs" weight="medium" color="mutedForeground">
                        {group}
                      </Text>
                    </View>
                  ) : null}
                  <View>
                    {rows.map((model, index) => (
                      <ModelRow
                        key={model.slug}
                        first={index === 0}
                        last={index === rows.length - 1}
                        provider={current}
                        model={model}
                        selected={current.model === model.slug}
                        starred={prefs.favorites.includes(modelKey(current.id, model.slug))}
                        onPick={() => pickModel(current, model)}
                      />
                    ))}
                  </View>
                </Fragment>
              );
            })}
          </Group>
        ) : null}
        {current && usable && (controls.traitOptions.length > 0 || controls.runtimeMode) ? (
          <Group header="Options">
            <View
              style={{
                backgroundColor: theme.colors.card,
                borderRadius: 14,
                borderCurve: "continuous",
              }}
            >
              {controls.runtimeMode ? (
                <ChoiceRow
                  title="Mode"
                  value={runtimeModeOf(controls.runtimeMode).label}
                  choices={RUNTIME_MODES.map((m) => ({ id: m.value, label: m.label }))}
                  onChoose={(value) => update({ [current.id]: { runtimeMode: value } })}
                />
              ) : null}
              {controls.traitOptions.map((option, index) => (
                <Fragment key={option.id}>
                  {index > 0 || controls.runtimeMode ? <Separator inset={16} /> : null}
                  <OptionRow
                    option={option}
                    value={controls.traitValues[option.id]}
                    onChange={(value) => update({ [current.id]: { [option.id]: value } })}
                  />
                </Fragment>
              ))}
            </View>
          </Group>
        ) : null}
        {!chat.blank && current ? (
          <Text size="body" color="mutedForeground" style={{ paddingHorizontal: 14 }}>
            This chat runs on {current.name}. Start a new chat to switch agents.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

function Group({
  header,
  star = false,
  children,
}: {
  header: string;
  star?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14 }}>
        {star ? <Icon name="star.fill" size={12} color="mutedForeground" /> : null}
        <Text size="sm" weight="medium" color="mutedForeground">
          {header}
        </Text>
      </View>
      <View>{children}</View>
    </View>
  );
}

/** A grouped card's row: rounded at the group's ends, a hairline above all but the first. */
function Card({
  first,
  last,
  inset,
  children,
}: {
  first: boolean;
  last: boolean;
  inset: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderTopLeftRadius: first ? 14 : 0,
        borderTopRightRadius: first ? 14 : 0,
        borderBottomLeftRadius: last ? 14 : 0,
        borderBottomRightRadius: last ? 14 : 0,
        borderCurve: "continuous",
      }}
    >
      {first ? null : <Separator inset={inset} />}
      {children}
    </View>
  );
}

function AgentRow({
  item,
  first,
  last,
  selected,
  onPick,
}: {
  item: AgentItem;
  first: boolean;
  last: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const status = agentUnavailable(item.provider);
  const detail = [item.agent ? item.provider.name : null, status].filter(Boolean).join(" · ");
  return (
    <Card first={first} last={last} inset={54}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={detail ? `${item.name}, ${detail}` : item.name}
        onPress={onPick}
        style={{
          minHeight: 54,
          paddingHorizontal: 16,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <AgentAvatar agent={item.provider.id} gatewayAgent={item.agent} size={28} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text size="base" weight="medium" numberOfLines={1}>
            {item.name}
          </Text>
          {detail ? (
            <Text size="body" color="mutedForeground" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        {selected ? <Icon name="checkmark" size={14} weight="semibold" /> : null}
      </Pressable>
    </Card>
  );
}

function ModelRow({
  provider,
  model,
  first,
  last = true,
  showAgent = false,
  selected,
  starred,
  onPick,
}: {
  provider: ProviderSnapshot;
  model: ProviderModel;
  first: boolean;
  last?: boolean;
  showAgent?: boolean;
  selected: boolean;
  starred: boolean;
  onPick: () => void;
}) {
  const theme = useTheme();
  return (
    <Card first={first} last={last} inset={16}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingLeft: 16,
          paddingRight: 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected }}
          accessibilityLabel={model.name}
          onPress={onPick}
          style={{ flex: 1, minHeight: 46, flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          {showAgent ? <AgentAvatar agent={provider.id} size={20} /> : null}
          <Text size="base" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
            {model.name}
          </Text>
          {model.isDefault ? (
            <View
              style={{
                height: 18,
                paddingHorizontal: 6,
                justifyContent: "center",
                borderRadius: theme.radius.pill,
                backgroundColor: alpha(theme.colors.foreground, 0.07),
              }}
            >
              <Text size="3xs" weight="bold" color="mutedForeground" style={{ letterSpacing: 0.5 }}>
                DEFAULT
              </Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {selected ? <Icon name="checkmark" size={14} weight="semibold" /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={starred ? "Remove from favorites" : "Add to favorites"}
          onPress={() => toggleFavorite(modelKey(provider.id, model.slug))}
          style={{ width: 32, height: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon
            name={starred ? "star.fill" : "star"}
            size={16}
            color={starred ? "warning" : "faintForeground"}
          />
        </Pressable>
      </View>
    </Card>
  );
}

/** A model's option: Fast as a switch, the rest a choice from the system's menu of them. */
function OptionRow({
  option,
  value,
  onChange,
}: {
  option: ProviderModelOption;
  value: string;
  onChange: (value: string) => void;
}) {
  const chosen = currentChoice(option, value);
  const fast = option.choices.find((c) => c.label === "Fast");
  if (option.id === "serviceTier" && fast) {
    const standard = option.choices.find((c) => c.id !== fast.id);
    return (
      <View
        style={{ minHeight: 46, paddingHorizontal: 16, flexDirection: "row", alignItems: "center" }}
      >
        <Text size="base" style={{ flex: 1 }}>
          Fast
        </Text>
        <Switch
          accessibilityLabel="Fast"
          value={chosen === fast.id}
          onValueChange={(on) => onChange(on ? fast.id : (standard?.id ?? ""))}
        />
      </View>
    );
  }
  return (
    <ChoiceRow
      title={option.label}
      value={option.choices.find((c) => c.id === chosen)?.label ?? ""}
      choices={option.choices}
      onChoose={onChange}
    />
  );
}

function ChoiceRow<T extends string>({
  title,
  value,
  choices,
  onChoose,
}: {
  title: string;
  value: string;
  choices: { id: T; label: string }[];
  onChoose: (id: T) => void;
}) {
  const theme = useTheme();
  return (
    <Host matchContents={{ vertical: true }} colorScheme={theme.scheme}>
      <Menu
        modifiers={[buttonStyle("plain"), accessibilityLabel(`${title}, ${value}`)]}
        label={
          <RNHostView matchContents={{ vertical: true }}>
            <View
              style={{
                minHeight: 46,
                paddingLeft: 16,
                paddingRight: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Text size="base" style={{ flex: 1 }}>
                {title}
              </Text>
              <Text size="base" color="mutedForeground">
                {value}
              </Text>
              <Icon
                name="chevron.up.chevron.down"
                size={12}
                weight="semibold"
                color="mutedForeground"
              />
            </View>
          </RNHostView>
        }
      >
        {choices.map((choice) => (
          <MenuButton
            key={choice.id}
            label={choice.label}
            systemImage={choice.label === value ? "checkmark" : undefined}
            onPress={() => onChoose(choice.id)}
          />
        ))}
      </Menu>
    </Host>
  );
}
