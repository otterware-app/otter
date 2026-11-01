/**
 * What agents' settings forms share (Settings → Agents): the models list,
 * a command to copy, and a CLI-backed agent's runtime fields. The extension
 * kit gives them to agent extensions; the pane draws the header above them.
 */

import { useState } from "react";
import { CheckIcon, StarIcon } from "lucide-react";
import { Switch } from "~/components/ui/switch";
import type { ProviderModel, ProviderSnapshot, RuntimeMode } from "../mail/api";
import { RUNTIME_MODE_OPTIONS } from "../mail/model-picker";
import {
  modelKey,
  resetModelPrefs,
  setHidden,
  toggleAllHidden,
  toggleFavorite,
  useModelPrefs,
} from "../mail/model-prefs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../mail/select";
import { Btn, cn } from "../mail/ui";
import { shortcutText } from "../keybindings/keys";
import { AgentAvatar } from "../mail/agent-providers";
import type { AgentSettingsProps } from "../extensions/types";
import { CopyButton } from "./agent-tokens-section";
import {
  DraftInput,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
  TextInput,
} from "./settings-ui";
import { searchableSetting } from "./settings-search";

/** T3's capability summary for a row: "Reasoning · Fast". */
function capabilityLabels(model: ProviderModel): string[] {
  return (model.options ?? []).map((o) => (o.id === "serviceTier" ? "Fast" : o.label));
}

/**
 * Models, as T3 Code's ProviderModelsSection: favorites and picker visibility
 * (stored on this device), a filter for long catalogs, and Enable / Disable all.
 * Clicking a name makes it the provider's default model.
 */
export function ModelsSection({
  provider,
  onPick,
  selectedModel,
}: {
  provider: ProviderSnapshot;
  selectedModel: string;
  onPick?: (slug: string) => void;
}) {
  const { favorites, hidden } = useModelPrefs();
  const [filter, setFilter] = useState("");
  const key = (slug: string) => modelKey(provider.kind, slug);
  const favoriteSet = new Set(favorites);
  const hiddenSet = new Set(hidden);
  const groupOf = (m: ProviderModel) =>
    favoriteSet.has(key(m.slug)) ? "favorite" : hiddenSet.has(key(m.slug)) ? "hidden" : "visible";
  const rank = { favorite: 0, visible: 1, hidden: 2 } as const;
  const models = provider.models;
  const query = filter.trim().toLowerCase();
  const visible = models
    .filter(
      (m) =>
        !query ||
        m.name.toLowerCase().includes(query) ||
        m.slug.toLowerCase().includes(query) ||
        (m.subProvider ?? "").toLowerCase().includes(query),
    )
    .sort((a, b) => rank[groupOf(a)] - rank[groupOf(b)]);
  const favoriteCount = models.filter((m) => favoriteSet.has(key(m.slug))).length;
  const hiddenCount = models.filter((m) => hiddenSet.has(key(m.slug))).length;
  const allKeys = models.map((m) => key(m.slug));
  const allHidden = allKeys.length > 0 && allKeys.every((k) => hiddenSet.has(k));

  const groupLabel = (label: string, isFirst: boolean) => (
    <div className={cn("px-2 pb-1.5 text-2xs text-muted-foreground", isFirst ? "pt-1" : "pt-5")}>
      {label}
    </div>
  );

  return (
    <SettingsSection
      {...searchableSetting("agent-models")}
      headerAction={
        selectedModel ||
        favorites.some((key) => key.startsWith(`${provider.kind}:`)) ||
        hidden.some((key) => key.startsWith(`${provider.kind}:`)) ? (
          <SettingResetButton
            label={`${provider.displayName} models`}
            onClick={() => {
              onPick?.("");
              resetModelPrefs(provider.kind);
            }}
          />
        ) : null
      }
      description={`Favorites and visibility are saved on this device.${
        onPick ? " Click a model to make it the default for new chats." : ""
      }`}
    >
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {models.length > 8 ? (
            <TextInput
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter models"
              spellCheck={false}
              aria-label="Filter models"
              className="w-56 max-w-full"
            />
          ) : null}
          <div className="flex items-center gap-2">
            {models.length > 0 ? (
              <Btn size="xs" variant="ghost-muted" onClick={() => toggleAllHidden(allKeys)}>
                {allHidden ? "Enable all" : "Disable all"}
              </Btn>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {models.length} model{models.length === 1 ? "" : "s"}
              {favoriteCount > 0
                ? ` · ${favoriteCount} favorite${favoriteCount === 1 ? "" : "s"}`
                : ""}
              {hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ""}
            </span>
          </div>
        </div>
        <div className="-mx-2 mt-2 max-h-72 overflow-y-auto">
          {visible.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {query ? "No models match." : "No models reported for this provider yet."}
            </p>
          ) : null}
          {visible.map((m, index) => {
            const group = groupOf(m);
            const previous = visible[index - 1];
            const startsGroup = !previous || groupOf(previous) !== group;
            const isHidden = hiddenSet.has(key(m.slug));
            const isFavorite = group === "favorite";
            const isDefault = m.slug === provider.model;
            const caps = capabilityLabels(m);
            return (
              <div key={m.slug}>
                {startsGroup && favoriteCount > 0 && group === "favorite"
                  ? groupLabel("Favorites", index === 0)
                  : null}
                {startsGroup && favoriteCount > 0 && group === "visible"
                  ? groupLabel("All", index === 0)
                  : null}
                {startsGroup && group === "hidden"
                  ? groupLabel("Hidden from picker", index === 0)
                  : null}
                <div
                  data-model-slug={m.slug}
                  className={cn(
                    "grid h-8 grid-cols-[1.5rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg px-2 hover:bg-foreground/[0.04]",
                    isHidden && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleFavorite(key(m.slug))}
                    aria-label={`${isFavorite ? "Remove" : "Add"} ${m.name} ${isFavorite ? "from" : "to"} favorites`}
                    title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                    className="inline-flex size-5 cursor-pointer items-center justify-center rounded-sm text-muted-foreground hover:bg-accent-surface hover:text-foreground"
                  >
                    <StarIcon
                      className={cn("size-3", isFavorite && "fill-current text-yellow-500")}
                    />
                  </button>
                  <button
                    type="button"
                    disabled={!onPick}
                    onClick={() => onPick?.(m.slug)}
                    className="flex min-w-0 items-baseline gap-2 text-left enabled:cursor-pointer"
                  >
                    {m.avatar || m.emoji ? (
                      <AgentAvatar
                        kind={provider.kind}
                        agent={m.slug}
                        className="size-3.5 self-center"
                      />
                    ) : null}
                    <span
                      className={cn(
                        "truncate text-xs",
                        isHidden ? "text-muted-foreground" : "text-foreground/90",
                      )}
                    >
                      {m.name}
                    </span>
                    {m.subProvider ? (
                      <span className="truncate text-2xs text-muted-foreground/70">
                        {m.subProvider}
                      </span>
                    ) : m.name !== m.slug && m.slug ? (
                      <code className="truncate font-mono text-2xs text-muted-foreground/70">
                        {m.slug}
                      </code>
                    ) : null}
                    {isDefault ? (
                      <span className="inline-flex shrink-0 items-center gap-0.5 text-2xs text-foreground/80">
                        <CheckIcon className="size-3" />
                        default
                      </span>
                    ) : null}
                  </button>
                  <span className="text-2xs text-muted-foreground/70">
                    {caps.length > 0 ? (
                      <span className="hidden sm:inline">{caps.join(" · ")}</span>
                    ) : null}
                  </span>
                  <span
                    className="flex shrink-0 items-center"
                    title={isHidden ? "Hidden from the model picker" : "Shown in the model picker"}
                  >
                    <Switch
                      checked={!isHidden}
                      onCheckedChange={(checked: boolean) => setHidden(key(m.slug), !checked)}
                      aria-label={`Show ${m.name} in the model picker`}
                    />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SettingsSection>
  );
}

/** A command to run on the gateway's computer, with Copy. */
export function Command({ value }: { value: string }) {
  return (
    <div className="mt-2 mb-1.5 flex items-start gap-2 rounded-lg bg-input/40 py-1.5 pr-1 pl-3">
      <code className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all select-all">{value}</code>
      <CopyButton value={value} label="Copy command" />
    </div>
  );
}

/** What a CLI-backed agent's runtime fields say (Codex, Claude), per T3's provider settings. */
export type LocalAgentRuntime = {
  name: string;
  binary: string;
  home: { title: string; description: string; placeholder: string };
  /** Its launch arguments' description, when it takes any. */
  launchArgs: string | null;
};

type LocalAgentSettingsValues = {
  binaryPath: string;
  homePath: string;
  launchArgs?: string;
  runtimeMode: RuntimeMode;
  model: string;
};

/** A CLI-backed agent's settings: where it lives, its access, its models. */
export function LocalAgentSettings({
  runtime: meta,
  provider,
  update,
}: AgentSettingsProps & { runtime: LocalAgentRuntime }) {
  const kind = provider.kind;
  const settings = provider.settings as AgentSettingsProps["provider"]["settings"] &
    LocalAgentSettingsValues;
  const set = (patch: Record<string, string>) => update({ [kind]: patch });
  return (
    <>
      <SettingsSection title="Runtime">
        <SettingsRow
          {...searchableSetting("agent-binary-path")}
          resetAction={
            settings.binaryPath ? (
              <SettingResetButton
                label={`${meta.name} binary path`}
                onClick={() => set({ binaryPath: "" })}
              />
            ) : null
          }
          description={`Path to the ${meta.name} binary. Empty uses \`${meta.binary}\` from your shell's PATH.`}
          control={
            <DraftInput
              value={settings.binaryPath}
              onCommit={(binaryPath) => set({ binaryPath })}
              placeholder={meta.binary}
              aria-label={`${meta.name} binary path`}
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        <SettingsRow
          title={meta.home.title}
          resetAction={
            settings.homePath ? (
              <SettingResetButton label={meta.home.title} onClick={() => set({ homePath: "" })} />
            ) : null
          }
          description={meta.home.description}
          control={
            <DraftInput
              value={settings.homePath}
              onCommit={(homePath) => set({ homePath })}
              placeholder={meta.home.placeholder}
              aria-label={meta.home.title}
              className="font-mono @min-[32rem]/settings-row:w-56"
            />
          }
        />
        {meta.launchArgs ? (
          <SettingsRow
            title="Launch arguments"
            resetAction={
              settings.launchArgs ? (
                <SettingResetButton
                  label="launch arguments"
                  onClick={() => set({ launchArgs: "" })}
                />
              ) : null
            }
            description={meta.launchArgs}
            control={
              <DraftInput
                value={settings.launchArgs ?? ""}
                onCommit={(launchArgs) => set({ launchArgs })}
                placeholder="e.g. -c key=value"
                aria-label={`${meta.name} launch arguments`}
                className="font-mono @min-[32rem]/settings-row:w-56"
              />
            }
          />
        ) : null}
        <SettingsRow
          {...searchableSetting("agent-access")}
          resetAction={
            settings.runtimeMode !== "full-access" ? (
              <SettingResetButton
                label={`${meta.name} access`}
                onClick={() => set({ runtimeMode: "full-access" })}
              />
            ) : null
          }
          description={`Default for new turns; also switchable from the composer (${shortcutText("mod+shift+a")}).`}
          control={
            <Select
              value={settings.runtimeMode}
              onValueChange={(value) => set({ runtimeMode: value as RuntimeMode })}
            >
              <SelectTrigger variant="pill" aria-label={`${meta.name} access`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RUNTIME_MODE_OPTIONS.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </SettingsSection>
      <ModelsSection
        provider={provider}
        selectedModel={settings.model}
        onPick={(model) => set({ model })}
      />
    </>
  );
}
