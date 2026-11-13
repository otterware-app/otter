import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AgentAccess, ConnectedAgent } from "@otter/contracts/agent-tokens";
import { Field } from "~/components/ui/field";
import { Dialog } from "~/components/ui/dialog";
import { Switch } from "~/components/ui/switch";
import { Text } from "~/components/ui/text";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { toast } from "../mail/toast";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, ChevronRightIcon, PlusIcon, RotateCwIcon, ShieldIcon } from "lucide-react";
import {
  mailApi,
  type AgentSettingsPatch,
  type ProviderSnapshot,
  type ProvidersState,
} from "../mail/api";
import {
  PROVIDER_STATUS_DOT,
  ProviderIcon,
  kindName,
  providerSummary,
  providerVersionLabel,
  useAgentProviders,
  useSetProvidersState,
} from "../agent/agent-providers";
import { AgentIcon } from "../agent/agent-icon";
import { EXTENSIONS } from "../extensions/registry";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../mail/menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../mail/select";
import { Btn, cn } from "../mail/ui";
import { PictureError, mailboxPicture } from "./mailbox-picture-image";
import {
  DraftInput,
  RowSelect,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-ui";
import { searchableSetting } from "./settings-search";
import { AgentTokensSection } from "./agent-tokens-section";
import { features } from "../features";
import {
  setFollowUpBehavior,
  useFollowUpBehavior,
  type FollowUpBehavior,
} from "../agent/chat-queue";
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

function useUpdateAgents() {
  const setState = useSetProvidersState();
  return (patch: AgentSettingsPatch) => {
    console.log("[Settings:updateAgent]", patch);
    mailApi
      .updateAgentSettings(patch)
      .then(setState, (error: unknown) =>
        toast.error(`Could not save: ${error instanceof Error ? error.message : String(error)}`),
      );
  };
}

/** The kinds this device can add, as a menu: the new agent's page opens to set it up. */
function AddAgentMenu({
  kinds,
  label = "Add agent",
}: {
  kinds: ProvidersState["kinds"];
  label?: string;
}) {
  const navigate = useNavigate();
  const setState = useSetProvidersState();
  const add = (kind: string) => {
    console.log("[Settings:addAgent]", { kind });
    mailApi.addAgent(kind).then(
      ({ id, state }) => {
        setState(state);
        void navigate({ to: "/settings/$pane/$item", params: { pane: "agents", item: id } });
      },
      (error: unknown) =>
        toast.error(`Could not add it: ${error instanceof Error ? error.message : String(error)}`),
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Btn size="sm" {...searchableSetting("add-agent")} title={undefined}>
          <PlusIcon />
          {label}
        </Btn>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {kinds.map((k) => (
          <DropdownMenuItem
            key={k.kind}
            icon={<ProviderIcon kind={k.kind} className="size-4" />}
            onSelect={() => add(k.kind)}
          >
            {k.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProvidersPane({ item }: { item?: string }) {
  const query = useAgentProviders();
  const update = useUpdateAgents();
  const state = query.data;
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(1000);

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
  const shown = item ? providers.find((p) => p.id === item) : undefined;
  if (shown) return <AgentPage key={shown.id} state={state} provider={shown} update={update} />;

  const lastChecked = Math.max(0, ...providers.map((p) => p.checkedAt ?? 0));
  const choices = providers.filter((p) => p.enabled || p.id === state.selected);

  return (
    <SettingsPageContainer
      title="Agents"
      description="The agents behind chat. Add as many as you work with: several Hermes servers, OpenClaw gateways, Claude or Codex setups."
      action={
        <>
          {providers.length > 0 ? (
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
          ) : null}
          {state.kinds.length > 0 ? <AddAgentMenu kinds={state.kinds} /> : null}
        </>
      }
    >
      {providers.length > 0 ? (
        <SettingsSection title="Your agents">
          {providers.map((p) => (
            <AgentListRow
              key={p.id}
              provider={p}
              isDefault={p.id === state.selected}
              onEnabled={(enabled) => update({ [p.id]: { enabled } })}
            />
          ))}
        </SettingsSection>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center">
          <AgentIcon className="size-7 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm text-foreground">No agents yet</p>
            <p className="max-w-80 text-[13px] text-pretty text-muted-foreground">
              Add the agents you work with, then chat with any of them beside your mail.
            </p>
          </div>
          {state.kinds.length > 0 ? (
            <AddAgentMenu kinds={state.kinds} label="Add an agent" />
          ) : null}
        </div>
      )}
      <ChatSection>
        {providers.length > 0 ? (
          <SettingsRow
            {...searchableSetting("agent-providers")}
            description="The agent a new chat runs on. You can switch in the chat's agent picker."
            control={
              <RowSelect
                value={state.selected ?? ""}
                onValueChange={(selected) => update({ selected })}
                options={choices.map((p) => ({ value: p.id, label: p.name }))}
                ariaLabel="New chats start with"
              />
            }
          />
        ) : null}
      </ChatSection>
      {features.localAgents ? <ConnectedAgentsSection /> : null}
    </SettingsPageContainer>
  );
}

function AgentListRow({
  provider,
  isDefault,
  onEnabled,
}: {
  provider: ProviderSnapshot;
  isDefault: boolean;
  onEnabled: (enabled: boolean) => void;
}) {
  const navigate = useNavigate();
  const needsAttention = provider.status === "warning" || provider.status === "error";
  return (
    <div
      data-slot="settings-row"
      className="group relative flex items-center gap-3 px-4 py-3 hover:bg-foreground/[0.03]"
    >
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: "/settings/$pane/$item",
            params: { pane: "agents", item: provider.id },
          })
        }
        aria-label={`Set up ${provider.name}`}
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
      />
      <span
        className={cn(
          "pointer-events-none flex min-w-0 flex-1 items-center gap-3",
          !provider.enabled && "opacity-60",
        )}
      >
        <AgentPicture provider={provider} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm text-foreground">{provider.name}</span>
            {isDefault ? (
              <span className="shrink-0 rounded bg-muted/60 px-1 py-0.5 text-3xs leading-none text-muted-foreground">
                Default
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
            {needsAttention ? <StatusDot status={provider.status} /> : null}
            <span className="line-clamp-1">
              {kindName(provider.kind)} · {providerSummary(provider).headline}
            </span>
          </span>
        </span>
      </span>
      <span className="relative flex shrink-0 items-center gap-3">
        <Switch
          checked={provider.enabled}
          onCheckedChange={(checked: boolean) => onEnabled(Boolean(checked))}
          aria-label={`${provider.enabled ? "Turn off" : "Turn on"} ${provider.name}`}
        />
        <ChevronRightIcon className="pointer-events-none size-4 text-muted-foreground" />
      </span>
    </div>
  );
}

/** The picture you gave the agent, else its kind's mark on a tile. */
function AgentPicture({ provider, size }: { provider: ProviderSnapshot; size: "sm" | "lg" }) {
  const box = size === "lg" ? "size-12 rounded-[14px]" : "size-9 rounded-[10px]";
  if (provider.avatar)
    return <img src={provider.avatar} alt="" className={cn(box, "shrink-0 object-cover")} />;
  return (
    <span
      className={cn(
        box,
        "flex shrink-0 items-center justify-center bg-foreground/[0.06] text-foreground",
      )}
    >
      <ProviderIcon kind={provider.kind} className={size === "lg" ? "size-6" : "size-[18px]"} />
    </span>
  );
}

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

/** One agent's page: its name and picture, its status, its kind's settings, and removing it. */
function AgentPage({
  state,
  provider,
  update,
}: {
  state: ProvidersState;
  provider: ProviderSnapshot;
  update: (patch: AgentSettingsPatch) => void;
}) {
  const navigate = useNavigate();
  const setState = useSetProvidersState();
  const extension = EXTENSIONS.find((e) => e.manifest.id === provider.kind);
  const Settings = extension?.agent?.Settings;
  const input = useRef<HTMLInputElement>(null);
  const [dropping, setDropping] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const back = () => void navigate({ to: "/settings/$pane", params: { pane: "agents" } });

  const usePicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      update({ [provider.id]: { avatar: await mailboxPicture(file) } });
    } catch (err) {
      toast.error("Couldn't use that picture", {
        description:
          err instanceof PictureError
            ? err.message
            : "Couldn't read it. Choose a PNG, JPEG or WebP.",
      });
    }
  };

  const remove = () => {
    setRemoving(true);
    console.log("[Settings:removeAgent]", { id: provider.id });
    mailApi.removeAgent(provider.id).then(
      (next) => {
        setState(next);
        setConfirmRemove(false);
        back();
      },
      (error: unknown) => {
        setRemoving(false);
        toast.error(
          `Could not remove it: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  };

  return (
    <SettingsPageContainer className="space-y-8">
      <div className="space-y-5 px-[17px]">
        <Btn size="sm" variant="ghost-muted" className="-ml-2.5" onClick={back}>
          <ArrowLeftIcon />
          Agents
        </Btn>
        <header
          className={cn(
            "-mx-2 flex items-center gap-4 rounded-xl p-2 transition-colors",
            dropping && "bg-accent-surface",
          )}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropping(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDropping(false);
          }}
          onDrop={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDropping(false);
            void usePicture(event.dataTransfer.files[0]);
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`Picture for ${provider.name}`}
                className="cursor-pointer rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <AgentPicture provider={provider} size="lg" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => input.current?.click()}>
                {provider.avatar ? "Change picture…" : "Choose picture…"}
              </DropdownMenuItem>
              {provider.avatar ? (
                <DropdownMenuItem onSelect={() => update({ [provider.id]: { avatar: "" } })}>
                  Remove picture
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <input
            ref={input}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              void usePicture(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <div className="min-w-0 flex-1">
            <DraftInput
              aria-label="Name"
              value={provider.name}
              maxLength={60}
              onCommit={(name) => {
                if (name) update({ [provider.id]: { name } });
              }}
              className="h-9 border-transparent bg-transparent px-1.5 text-[22px] font-medium tracking-[-0.01em] hover:border-border/70 focus-visible:bg-canvas"
            />
            <p className="mt-0.5 px-1.5 text-sm text-muted-foreground">
              {extension ? `${extension.manifest.name} · ${extension.manifest.description}` : null}
            </p>
          </div>
          <Switch
            checked={provider.enabled}
            onCheckedChange={(checked: boolean) =>
              update({ [provider.id]: { enabled: Boolean(checked) } })
            }
            aria-label={`${provider.enabled ? "Turn off" : "Turn on"} ${provider.name}`}
          />
        </header>
        {extension?.manifest.dataUse ? (
          <p className="flex items-start gap-2 text-[13px] leading-[18px] text-muted-foreground">
            <ShieldIcon className="mt-px size-3.5 shrink-0" />
            {extension.manifest.dataUse}
          </p>
        ) : null}
      </div>
      <AgentStatusSection
        provider={provider}
        isDefault={provider.id === state.selected}
        onMakeDefault={() => update({ selected: provider.id })}
      />
      {Settings ? <Settings state={state} provider={provider} update={update} /> : null}
      <SettingsSection title="Remove">
        <SettingsRow
          title="Remove agent"
          description="Its settings and keys leave every device. Its chats stay, with nothing to run on."
          control={
            <Btn size="sm" variant="destructive" onClick={() => setConfirmRemove(true)}>
              Remove…
            </Btn>
          }
        />
      </SettingsSection>
      <Dialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove ${provider.name}?`}
        confirmLabel={removing ? "Removing…" : "Remove agent"}
        confirmVariant="accent"
        onConfirm={remove}
      >
        <Text variant="small">
          Otter forgets {provider.name} and its key on all your devices. Nothing changes on the
          agent itself. You can add it again any time.
        </Text>
      </Dialog>
    </SettingsPageContainer>
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
      `claude mcp remove --scope user otter-mail >/dev/null 2>&1; claude mcp add --scope user --transport http otter ${url} --header "Authorization: Bearer ${token}"`,
  },
  {
    agent: "Codex",
    text: (url, token) =>
      `codex mcp remove otter-mail >/dev/null 2>&1; codex mcp remove otter >/dev/null 2>&1; printf '\\n[mcp_servers.otter]\\nurl = "${url}"\\nhttp_headers = { Authorization = "Bearer ${token}" }\\n' >> ~/.codex/config.toml`,
  },
  {
    agent: "Cursor",
    text: (url, token) =>
      `open 'cursor://anysphere.cursor-deeplink/mcp/install?name=otter&config=${btoa(JSON.stringify({ url, headers: { Authorization: `Bearer ${token}` } }))}'`,
  },
];

/**
 * Agents on this Mac that Otter doesn't run (Claude Code, Cursor, …) get
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
      description="Claude Code, Codex, Cursor or any agent that speaks MCP can use your mail, calendars and views while Otter is open."
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
