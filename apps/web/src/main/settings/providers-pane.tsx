import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentAccess, ConnectedAgent } from "@otter-mail/contracts/agent-tokens";
import { Field } from "~/components/ui/field";
import { Text } from "~/components/ui/text";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { toast } from "../mail/toast";
import { RotateCwIcon } from "lucide-react";
import {
  DEFAULT_AGENT,
  mailApi,
  type AgentSettingsPatch,
  type ProviderSnapshot,
} from "../mail/api";
import {
  PROVIDER_STATUS_DOT,
  providerSummary,
  providerVersionLabel,
  useAgentProviders,
  useSetProvidersState,
} from "../mail/agent-providers";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../mail/select";
import { Btn, cn } from "../mail/ui";
import {
  RowSelect,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-ui";
import { searchableSetting } from "./settings-search";
import { AgentTokensSection } from "./agent-tokens-section";
import { ExtensionCategoryPane } from "../extensions/extensions-pane";
import { features } from "../features";
import {
  setFollowUpBehavior,
  useFollowUpBehavior,
  type FollowUpBehavior,
} from "../mail/chat-queue";
import { shortcutText } from "../keybindings/keys";

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function StatusDot({ status }: { status: ProviderSnapshot["status"] }) {
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", PROVIDER_STATUS_DOT[status])}
      aria-hidden
    />
  );
}

function StatusLine({ provider }: { provider: ProviderSnapshot }) {
  const summary = providerSummary(provider);
  if (provider.enabled && provider.auth.status === "authenticated" && provider.auth.email) {
    return (
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
        <span>Authenticated as</span>
        <span className="text-foreground/80">{provider.auth.email}</span>
        {provider.auth.label ? <span>· {provider.auth.label}</span> : null}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
      <StatusDot status={provider.status} />
      <span>{summary.headline}</span>
      {summary.detail ? (
        <span className="min-w-0 [overflow-wrap:anywhere]">· {summary.detail}</span>
      ) : null}
    </div>
  );
}

export function AgentStatusSection({
  provider,
  isDefault,
  onMakeDefault,
  children,
}: {
  provider: ProviderSnapshot;
  isDefault: boolean;
  onMakeDefault: () => void;
  children?: ReactNode;
}) {
  const version = providerVersionLabel(provider.version);
  return (
    <SettingsSection
      title="Status"
      headerAction={
        version ? <code className="text-xs text-muted-foreground">{version}</code> : null
      }
    >
      <SettingsRow
        title={<StatusLine provider={provider} />}
        control={
          isDefault ? (
            <span className="text-xs text-muted-foreground">Used for new chats</span>
          ) : (
            <Btn size="sm" disabled={!provider.enabled} onClick={onMakeDefault}>
              Use for new chats
            </Btn>
          )
        }
      />
      {children}
    </SettingsSection>
  );
}

export function ProvidersPane({ item }: { item?: string }) {
  const query = useAgentProviders();
  const setState = useSetProvidersState();
  const state = query.data;
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(1000);

  const update = (patch: AgentSettingsPatch) => {
    console.log("[Settings:updateAgent]", patch);
    mailApi
      .updateAgentSettings(patch)
      .then(setState, (error: unknown) =>
        toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`),
      );
  };

  const refresh = () => {
    if (refreshing) return;
    setRefreshing(true);
    void mailApi.refreshAgentProviders().catch(() => {});
    setTimeout(() => setRefreshing(false), 1500);
  };

  if (!state) {
    return (
      <SettingsPageContainer title="Agents">
        <p className="text-sm text-muted-foreground">
          {query.isError ? "Agent settings are unavailable." : "Loading agents…"}
        </p>
      </SettingsPageContainer>
    );
  }

  const providers = state.providers;
  const lastChecked = Math.max(0, ...providers.map((p) => p.checkedAt ?? 0));
  const choices = providers.filter((p) => p.enabled || p.kind === state.selected);

  return (
    <ExtensionCategoryPane
      category="agent"
      item={item}
      title="Agents"
      description="The agents behind chat. A turned-off agent isn't offered for chats."
      action={
        <Btn
          size="sm"
          variant="ghost-muted"
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={refresh}
          title="Refresh agent status"
        >
          <RotateCwIcon className={cn("size-3.5", refreshing && "animate-spin")} />
          <span className="sr-only">Refresh agent status</span>
          <span className="hidden min-w-0 truncate sm:inline">
            {refreshing ? (
              "Refreshing agents"
            ) : lastChecked ? (
              <>
                Checked{" "}
                <span className="font-mono tabular-nums">{formatAgo(now - lastChecked)}</span>
              </>
            ) : (
              "Checking…"
            )}
          </span>
        </Btn>
      }
    >
      <ChatSection>
        <SettingsRow
          {...searchableSetting("agent-providers")}
          description="The agent a new chat runs on. You can switch in the chat's model picker."
          resetAction={
            state.selected !== DEFAULT_AGENT ? (
              <SettingResetButton
                label="default agent"
                onClick={() => update({ selected: DEFAULT_AGENT })}
              />
            ) : null
          }
          control={
            <RowSelect
              value={state.selected}
              onValueChange={(selected) => update({ selected })}
              options={choices.map((p) => ({ value: p.kind, label: p.displayName }))}
              ariaLabel="New chats start with"
            />
          }
        />
      </ChatSection>
      {features.localAgents ? <ConnectedAgentsSection /> : null}
    </ExtensionCategoryPane>
  );
}

function ChatSection({ children }: { children: ReactNode }) {
  const behavior = useFollowUpBehavior();
  return (
    <SettingsSection title="Chat">
      {children}
      <SettingsRow
        {...searchableSetting("follow-up-behavior")}
        resetAction={
          behavior !== "queue" ? (
            <SettingResetButton
              label="follow-up behavior"
              onClick={() => setFollowUpBehavior("queue")}
            />
          ) : null
        }
        description={`Queue follow-ups while the agent runs or steer the current run. Press ${shortcutText("mod+enter")} to do the opposite for one message.`}
        control={
          <Select
            value={behavior}
            onValueChange={(value) => setFollowUpBehavior(value as FollowUpBehavior)}
          >
            <SelectTrigger variant="pill" aria-label="Follow-up behavior">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="queue">Queue</SelectItem>
              <SelectItem value="steer">Steer</SelectItem>
            </SelectContent>
          </Select>
        }
      />
    </SettingsSection>
  );
}

const AGENT_ACCESS: { value: AgentAccess; label: string; description: string }[] = [
  {
    value: "read-only",
    label: "Read only",
    description: "Reads your mail and calendars. Changes nothing.",
  },
  {
    value: "safe",
    label: "Safe",
    description:
      "Anything you can undo: archive, label, trash, drafts. Never sends or deletes for good.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Anything, sending mail and calendar invitations included.",
  },
];

const AGENT_COMMANDS: { agent: string; text: (url: string, token: string) => string }[] = [
  {
    agent: "Claude Code",
    text: (url, token) =>
      `claude mcp add --scope user --transport http otter-mail ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    agent: "Codex",
    text: (url, token) =>
      `codex mcp remove otter-mail >/dev/null 2>&1; printf '\\n[mcp_servers.otter-mail]\\nurl = "${url}"\\nhttp_headers = { Authorization = "Bearer ${token}" }\\n' >> ~/.codex/config.toml`,
  },
  {
    agent: "Cursor",
    text: (url, token) =>
      `open 'cursor://anysphere.cursor-deeplink/mcp/install?name=otter-mail&config=${btoa(JSON.stringify({ url, headers: { Authorization: `Bearer ${token}` } }))}'`,
  },
];

/**
 * Agents on this Mac that Otter Mail doesn't run (Claude Code, Cursor, …) get
 * its tools at the Mac app's MCP server with a token made here, each with as
 * much access as it's given. Nothing asks again: making the token was the
 * user's say.
 */
function ConnectedAgentsSection() {
  const qc = useQueryClient();
  const [access, setAccess] = useState<AgentAccess>("safe");
  const change = useMutation({
    mutationFn: ({ id, access }: { id: string; access: AgentAccess }) =>
      mailApi.setConnectedAgentAccess(id, access),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["mcp:agents"] }),
    onError: (error) =>
      toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`),
  });
  return (
    <AgentTokensSection<ConnectedAgent>
      {...searchableSetting("connected-agents")}
      description="Claude Code, Codex, Cursor or any agent that speaks MCP can use your mail, calendars and views while Otter Mail is open."
      queryKey="mcp:agents"
      list={mailApi.connectedAgents}
      create={(name) => mailApi.addConnectedAgent(name, access)}
      revoke={mailApi.removeConnectedAgent}
      defaultName="Claude Code"
      newTokenFields={
        <Field label="Access" orientation="vertical">
          <ToggleGroup
            aria-label="Access"
            className="w-full"
            value={[access]}
            onValueChange={(next) => {
              if (next[0]) setAccess(next[0] as AgentAccess);
            }}
          >
            {AGENT_ACCESS.map((option) => (
              <Toggle key={option.value} value={option.value} className="flex-1">
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <Text variant="small" color="secondary">
            {AGENT_ACCESS.find((o) => o.value === access)?.description}
          </Text>
        </Field>
      }
      renderControl={(agent) => (
        <RowSelect
          value={agent.access}
          onValueChange={(next) => change.mutate({ id: agent.id, access: next as AgentAccess })}
          options={AGENT_ACCESS}
          ariaLabel={`${agent.name}'s access`}
        />
      )}
      commands={AGENT_COMMANDS}
    />
  );
}
