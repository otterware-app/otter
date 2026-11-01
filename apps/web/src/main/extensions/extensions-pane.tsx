/**
 * Extensions in Settings, one pane per kind (the manifest's category): Agents
 * (settings/providers-pane.tsx draws chat's own settings above the list),
 * Integrations and Features, under "Extensions" in the sidebar. Each row has
 * its switch; one with something to set up opens to its page
 * (`/settings/<pane>/<id>`): its switch, where its data goes, and its
 * settings. Turning a feature off hides it everywhere (a UI choice that
 * follows the Otter account); turning an agent off stops chats on it.
 */

import { type ExtensionCategory } from "@otter-mail/contracts/extensions";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon, PuzzleIcon, ShieldIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Switch } from "~/components/ui/switch";

import {
  PROVIDER_STATUS_DOT,
  providerSummary,
  useAgentProviders,
  useSetProvidersState,
} from "../mail/agent-providers";
import { mailApi, type AgentSettingsPatch, type ProviderSnapshot } from "../mail/api";
import { toast } from "../mail/toast";
import { Btn, cn } from "../mail/ui";
import { AgentStatusSection } from "../settings/providers-pane";
import { SETTINGS_SECTION_LABELS } from "../settings/settings-search";
import { SettingsPageContainer, SettingsSection } from "../settings/settings-ui";
import {
  CATEGORY_PANE,
  availableExtensions,
  setExtensionEnabled,
  useDisabledExtensions,
} from "./registry";
import type { UiExtension } from "./types";

/** An extension as Settings shows it: on or off, and the agent behind it, if it is one. */
type Entry = { extension: UiExtension; enabled: boolean; agent?: ProviderSnapshot };

/** Whether it has a page: something to set up beyond its switch. */
const hasPage = ({ extension }: Entry) => Boolean(extension.Settings || extension.agent);

function useEntries(): { entries: Entry[]; setEnabled: (entry: Entry, on: boolean) => void } {
  const disabled = useDisabledExtensions();
  const agents = useAgentProviders().data;
  const setAgents = useSetProvidersState();
  const entries = availableExtensions().flatMap((extension): Entry[] => {
    if (!extension.agent) return [{ extension, enabled: !disabled.has(extension.manifest.id) }];
    // Agents this backend runs (the web app's has no Claude or Codex).
    const agent = agents?.providers.find((p) => p.kind === extension.manifest.id);
    return agent ? [{ extension, enabled: agent.enabled, agent }] : [];
  });
  const setEnabled = (entry: Entry, on: boolean) => {
    const { id } = entry.extension.manifest;
    console.log("[Settings:setExtensionEnabled]", { id, on });
    if (!entry.agent) return setExtensionEnabled(id, on);
    mailApi
      .updateAgentSettings({ [id]: { enabled: on } })
      .then(setAgents, (error: unknown) =>
        toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`),
      );
  };
  return { entries, setEnabled };
}

function ExtensionIcon({ extension, size }: { extension: UiExtension; size: "sm" | "lg" }) {
  const Icon = extension.Icon ?? extension.agent?.Icon ?? PuzzleIcon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center bg-foreground/[0.06] text-foreground",
        size === "lg" ? "size-12 rounded-[14px]" : "size-9 rounded-[10px]",
      )}
    >
      <Icon className={size === "lg" ? "size-6" : "size-[18px]"} />
    </span>
  );
}

function EnabledSwitch({
  entry,
  setEnabled,
}: {
  entry: Entry;
  setEnabled: (entry: Entry, on: boolean) => void;
}) {
  const { name } = entry.extension.manifest;
  return (
    <Switch
      checked={entry.enabled}
      onCheckedChange={(checked: boolean) => setEnabled(entry, Boolean(checked))}
      aria-label={`${entry.enabled ? "Turn off" : "Turn on"} ${name}`}
    />
  );
}

/**
 * A kind of extension's pane: its list (after `children`, the kind's own
 * settings), or, with an `item`, that extension's page.
 */
export function ExtensionCategoryPane({
  category,
  item,
  title,
  description,
  action,
  children,
}: {
  category: ExtensionCategory;
  item?: string;
  title: string;
  description: string;
  /** Beside the title (Agents: when they were last checked). */
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { entries, setEnabled } = useEntries();
  const entry = item ? entries.find((e) => e.extension.manifest.id === item) : undefined;
  if (entry && hasPage(entry))
    return <ExtensionPage key={item} entry={entry} setEnabled={setEnabled} />;
  return (
    <SettingsPageContainer title={title} description={description} action={action}>
      {children}
      {/* "Built-in": extensions from elsewhere will be listed beside them. */}
      <ExtensionListSection
        entries={entries.filter((e) => e.extension.manifest.category === category)}
        setEnabled={setEnabled}
      />
    </SettingsPageContainer>
  );
}

function ExtensionListSection({
  entries,
  setEnabled,
}: {
  entries: Entry[];
  setEnabled: (entry: Entry, on: boolean) => void;
}) {
  const navigate = useNavigate();
  const state = useAgentProviders().data;
  return (
    <SettingsSection title="Built-in">
      {entries.map((e) => {
        const { id, category } = e.extension.manifest;
        return (
          <ExtensionListRow
            key={id}
            entry={e}
            isDefault={state?.selected === id}
            setEnabled={setEnabled}
            onOpen={
              hasPage(e)
                ? () =>
                    void navigate({
                      to: "/settings/$pane/$item",
                      params: { pane: CATEGORY_PANE[category], item: id },
                    })
                : undefined
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function ExtensionListRow({
  entry,
  isDefault,
  setEnabled,
  onOpen,
}: {
  entry: Entry;
  isDefault: boolean;
  setEnabled: (entry: Entry, on: boolean) => void;
  /** Absent: nothing to set up, the switch is all there is. */
  onOpen?: () => void;
}) {
  const { manifest } = entry.extension;
  const { agent } = entry;
  // An agent says how it's doing; anything else, what it does.
  const status = agent ? providerSummary(agent).headline : null;
  const needsAttention = agent && (agent.status === "warning" || agent.status === "error");
  return (
    <div
      data-slot="settings-row"
      className={cn(
        "group relative flex items-center gap-3 px-4 py-3",
        onOpen && "hover:bg-foreground/[0.03]",
      )}
    >
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Set up ${manifest.name}`}
          className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
        />
      ) : null}
      <span
        className={cn(
          "pointer-events-none flex min-w-0 flex-1 items-center gap-3",
          !entry.enabled && "opacity-60",
        )}
      >
        <ExtensionIcon extension={entry.extension} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-foreground">{manifest.name}</span>
            {agent && isDefault ? (
              <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-3xs leading-none text-muted-foreground">
                Default
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {needsAttention ? (
              <span
                aria-hidden
                className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_DOT[agent.status])}
              />
            ) : null}
            <span className="line-clamp-1">{status ?? manifest.description}</span>
          </span>
        </span>
      </span>
      <span className="relative flex shrink-0 items-center gap-3">
        <EnabledSwitch entry={entry} setEnabled={setEnabled} />
        {onOpen ? (
          <ChevronRightIcon className="pointer-events-none size-4 text-muted-foreground" />
        ) : null}
      </span>
    </div>
  );
}

/** One extension's page: its switch, where its data goes, then its settings. */
function ExtensionPage({
  entry,
  setEnabled,
}: {
  entry: Entry;
  setEnabled: (entry: Entry, on: boolean) => void;
}) {
  const navigate = useNavigate();
  const { extension } = entry;
  const { manifest } = extension;
  const pane = CATEGORY_PANE[manifest.category];

  return (
    <SettingsPageContainer className="space-y-8">
      <div className="space-y-5 px-[17px]">
        <Btn
          size="sm"
          variant="ghost-muted"
          className="-ml-2.5"
          onClick={() => void navigate({ to: "/settings/$pane", params: { pane } })}
        >
          <ArrowLeftIcon />
          {SETTINGS_SECTION_LABELS[pane]}
        </Btn>
        <header className="flex items-center gap-4">
          <ExtensionIcon extension={extension} size="lg" />
          <div className="min-w-0 flex-1">
            <h1
              data-slot="settings-page-title"
              className="text-[22px] font-medium leading-7 tracking-[-0.01em] text-foreground"
            >
              {manifest.name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{manifest.description}</p>
          </div>
          <EnabledSwitch entry={entry} setEnabled={setEnabled} />
        </header>
        <p className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
          <ShieldIcon className="mt-px size-3.5 shrink-0" />
          {manifest.dataUse}
        </p>
      </div>
      <ExtensionSettings entry={entry} />
    </SettingsPageContainer>
  );
}

function ExtensionSettings({ entry }: { entry: Entry }) {
  const { extension, agent } = entry;
  const state = useAgentProviders().data;
  const setState = useSetProvidersState();
  if (extension.agent && agent && state) {
    const AgentSettings = extension.agent.Settings;
    const update = (patch: AgentSettingsPatch) => {
      console.log("[Settings:updateAgent]", patch);
      mailApi
        .updateAgentSettings(patch)
        .then(setState, (error: unknown) =>
          toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`),
        );
    };
    return (
      <>
        <AgentStatusSection
          provider={agent}
          isDefault={agent.kind === state.selected}
          onMakeDefault={() => update({ selected: agent.kind })}
        />
        <AgentSettings state={state} provider={agent} update={update} />
      </>
    );
  }
  const Settings = extension.Settings;
  return Settings ? <Settings /> : null;
}
