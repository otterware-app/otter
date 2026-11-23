import { PictureError, mailboxPicture, searchableSetting } from "@otter/web/extension-kit";
import { toast } from "@otter/ui/components/toast";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@otter/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@otter/ui/components/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@otter/ui/components/select";
import { cn } from "@otter/ui/lib/utils";

import type {
  FastMode,
  OpenClawAgent,
  OpenClawChange,
  OpenClawModel,
  OpenClawModels,
  OpenClawSetup,
} from "../core/models";
import { openClawApi } from "./api";
import { OpenClawIcon } from "./icon";
import { SettingsResetButton, SettingsRow, SettingsSection } from "@otter/ui/components/settings";
import { DraftInput } from "@otter/ui/components/input";

/** A select's value for what isn't set: an agent follows the default. */
const DEFAULT = "default";
/** The utility model's value for none. */
const NONE = "none";

// The gateway puts the picture in the agent's prompt on every turn (IDENTITY.md): about 900 tokens at most.
const PICTURE_SIZE = { sides: [64, 48, 32], maxLength: 4_000 };

const LEVELS: Record<string, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  adaptive: "Adaptive",
  max: "Max",
  ultra: "Ultra",
};
const levelName = (id: string) => LEVELS[id] ?? id;

const FAST: { id: string; value: FastMode; name: string }[] = [
  { id: "standard", value: false, name: "Standard" },
  { id: "fast", value: true, name: "Fast" },
  { id: "auto", value: "auto", name: "Auto" },
  { id: "ultrafast", value: "ultrafast", name: "Ultrafast" },
];
const fastOf = (value: FastMode | null) => FAST.find((f) => f.value === (value ?? false))!;

type Option = { id: string; name: string };

function OptionSelect({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select
      value={value}
      items={options.map((o) => ({ value: o.id, label: o.name }))}
      onValueChange={(v) => {
        if (v !== null) onChange(v);
      }}
    >
      <SelectTrigger aria-label={label} className="w-56">
        <SelectValue placeholder={placeholder ?? "Choose a model"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * What the defaults, or one agent, run with. An agent's rows offer the default; a lone agent shows
 * only what it has of its own, as the defaults are its.
 */
function SetupRows({
  who,
  setup,
  defaults,
  models,
  lone,
  onChange,
}: {
  who: string;
  setup: OpenClawSetup;
  defaults?: OpenClawSetup;
  models: OpenClawModel[];
  lone?: boolean;
  onChange: (change: Partial<OpenClawSetup>) => void;
}) {
  const nameOf = (id: string) => models.find((m) => m.id === id)?.name ?? id;
  const unlisted = (id: string | null): Option[] =>
    id && !models.some((m) => m.id === id) ? [{ id, name: id }] : [];
  const inherited = (name: string): Option[] =>
    defaults ? [{ id: DEFAULT, name: `Default (${name})` }] : [];
  const shown = (value: unknown) => !lone || value !== null;
  const modelId = setup.model ?? defaults?.model ?? null;
  const model = models.find((m) => m.id === modelId);

  const chain = setup.fallbacks ?? [];
  const fallbacksText = !defaults
    ? "Tried in order when the model is unavailable."
    : setup.fallbacks
      ? chain.length
        ? "Tried in order when its model is unavailable."
        : "None."
      : setup.model
        ? "None: with a model of its own, it falls back only to its own."
        : defaults.fallbacks?.length
          ? `The default's: ${defaults.fallbacks.map(nameOf).join(", ")}.`
          : "None, like the default.";
  const levels = model?.thinkingLevels ?? [];
  const automaticLevel = model?.thinkingDefault ? levelName(model.thinkingDefault) : null;
  const utilityName = (value: string | null) =>
    value === null ? "Automatic" : value === "" ? "None" : nameOf(value);

  return (
    <>
      {shown(setup.model) ? (
        <SettingsRow
          title="Model"
          control={
            <OptionSelect
              label={`${who} model`}
              value={setup.model ?? (defaults ? DEFAULT : "")}
              options={[
                ...inherited(defaults?.model ? nameOf(defaults.model) : "none"),
                ...unlisted(setup.model),
                ...models,
              ]}
              onChange={(v) => onChange({ model: v === DEFAULT ? null : v })}
            />
          }
        />
      ) : null}
      {shown(setup.fallbacks) ? (
        <SettingsRow
          title="Fallbacks"
          description={fallbacksText}
          resetAction={
            defaults && setup.fallbacks ? (
              <SettingsResetButton
                label={`${who} fallbacks`}
                onClick={() => onChange({ fallbacks: null })}
              />
            ) : null
          }
          control={
            <OptionSelect
              label={`${who} fallbacks: add a model`}
              value=""
              placeholder="Add a model"
              options={models.filter((m) => m.id !== modelId && !chain.includes(m.id))}
              onChange={(v) => onChange({ fallbacks: [...chain, v] })}
            />
          }
        >
          {chain.length ? (
            <ol className="flex flex-wrap gap-1.5 pb-2">
              {chain.map((id) => (
                <li
                  key={id}
                  className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-border/70 bg-surface-raised/60 pr-0.5 pl-2.5 text-body text-foreground"
                >
                  {nameOf(id)}
                  <IconButton
                    label={`Remove ${nameOf(id)}`}
                    size="icon-xs"
                    onClick={() => onChange({ fallbacks: chain.filter((f) => f !== id) })}
                    className="rounded-md"
                  >
                    <XIcon className="size-3" />
                  </IconButton>
                </li>
              ))}
            </ol>
          ) : null}
        </SettingsRow>
      ) : null}
      {shown(setup.thinking) && (levels.length || setup.thinking) ? (
        <SettingsRow
          title="Thinking"
          description={defaults ? undefined : "How hard it thinks before it answers."}
          control={
            <OptionSelect
              label={`${who} thinking`}
              value={setup.thinking ?? DEFAULT}
              options={[
                defaults
                  ? {
                      id: DEFAULT,
                      name: `Default (${defaults.thinking ? levelName(defaults.thinking) : (automaticLevel ?? "Automatic")})`,
                    }
                  : {
                      id: DEFAULT,
                      name: automaticLevel ? `Automatic (${automaticLevel})` : "Automatic",
                    },
                ...(setup.thinking && !levels.some((l) => l.id === setup.thinking)
                  ? [{ id: setup.thinking, name: levelName(setup.thinking) }]
                  : []),
                ...levels.map((l) => ({ id: l.id, name: LEVELS[l.id] ?? l.label })),
              ]}
              onChange={(v) => onChange({ thinking: v === DEFAULT ? null : v })}
            />
          }
        />
      ) : null}
      {shown(setup.fast) && (model?.fast !== false || setup.fast !== null) ? (
        <SettingsRow
          title="Fast mode"
          description={
            defaults
              ? undefined
              : "Faster replies, which cost more. Auto uses it for each reply's first minute."
          }
          control={
            <OptionSelect
              label={`${who} fast mode`}
              value={
                setup.fast === null ? (defaults ? DEFAULT : "standard") : fastOf(setup.fast).id
              }
              options={[
                ...inherited(fastOf(defaults?.fast ?? null).name),
                ...FAST.filter((f) => f.value !== "ultrafast" || setup.fast === "ultrafast"),
              ]}
              onChange={(v) =>
                onChange({ fast: v === DEFAULT ? null : FAST.find((f) => f.id === v)!.value })
              }
            />
          }
        />
      ) : null}
      {shown(setup.utilityModel) ? (
        <SettingsRow
          title="Utility model"
          description={
            defaults
              ? undefined
              : "For small jobs: chat titles and progress notes. Automatic picks its provider's small model."
          }
          control={
            <OptionSelect
              label={`${who} utility model`}
              value={
                setup.utilityModel === null
                  ? DEFAULT
                  : setup.utilityModel === ""
                    ? NONE
                    : setup.utilityModel
              }
              options={[
                defaults
                  ? { id: DEFAULT, name: `Default (${utilityName(defaults.utilityModel)})` }
                  : { id: DEFAULT, name: "Automatic" },
                { id: NONE, name: "None" },
                ...unlisted(setup.utilityModel || null),
                ...models,
              ]}
              onChange={(v) =>
                onChange({ utilityModel: v === DEFAULT ? null : v === NONE ? "" : v })
              }
            />
          }
        />
      ) : null}
    </>
  );
}

function AgentFace({ agent }: { agent: OpenClawAgent }) {
  const box = "size-8 shrink-0 rounded-lg";
  if (agent.avatar) return <img src={agent.avatar} alt="" className={cn(box, "object-cover")} />;
  return (
    <span className={cn(box, "flex items-center justify-center bg-foreground/[0.06] text-base")}>
      {agent.emoji ?? <OpenClawIcon className="size-[18px]" />}
    </span>
  );
}

function IdentityRow({
  agent,
  onChange,
}: {
  agent: OpenClawAgent;
  onChange: (change: OpenClawChange) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const usePicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      onChange({ avatar: await mailboxPicture(file, PICTURE_SIZE) });
    } catch (error) {
      toast.error("Couldn't use that picture", {
        description:
          error instanceof PictureError
            ? error.message
            : "Couldn't read it. Choose a PNG, JPEG or WebP.",
      });
    }
  };
  return (
    <SettingsRow
      title="Name and picture"
      description="What it's called here and in its other apps."
      control={
        <>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={`Picture for ${agent.name}`}
              className="cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <AgentFace agent={agent} />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => input.current?.click()}>
                {agent.avatar ? "Change picture…" : "Choose picture…"}
              </DropdownMenuItem>
              {agent.avatar ? (
                <DropdownMenuItem onClick={() => onChange({ avatar: null })}>
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
          <DraftInput
            aria-label={`${agent.name}'s name`}
            value={agent.name}
            maxLength={60}
            onCommit={(name) => {
              if (name) onChange({ name });
            }}
            className="w-46"
          />
        </>
      }
    />
  );
}

/** How the gateway's agents run, set on the gateway, which all they do follows: its defaults, and each agent's own. */
export function OpenClawAgents({ agent }: { agent: string }) {
  const [state, setState] = useState<OpenClawModels | null>(null);

  const load = useCallback(() => {
    void openClawApi.models(agent).then(setState, () => setState(null));
  }, [agent]);
  useEffect(load, [load]);

  if (!state?.models.length) return null;

  const change = async (gatewayAgent: string | null, change: OpenClawChange) => {
    setState(
      (s) =>
        s &&
        (gatewayAgent
          ? { ...s, agents: s.agents.map((a) => (a.id === gatewayAgent ? { ...a, ...change } : a)) }
          : { ...s, defaults: { ...s.defaults, ...change } }),
    );
    try {
      await openClawApi.change(agent, gatewayAgent, change);
    } catch (error) {
      toast.error(
        `Could not change it on the gateway: ${error instanceof Error ? error.message : String(error)}`,
      );
      load();
    }
  };
  const lone = state.agents.length === 1;

  return (
    <>
      <SettingsSection
        {...searchableSetting("openclaw-models")}
        description={`Set on your gateway, so everything its agents do follows it: chats here and in its other apps, and scheduled tasks without a model of their own.${lone ? "" : " Each agent below can have its own."}`}
      >
        <SetupRows
          who="Default"
          setup={state.defaults}
          models={state.models}
          onChange={(c) => void change(null, c)}
        />
      </SettingsSection>
      {state.agents.map((a) => (
        <SettingsSection key={a.id} title={a.name}>
          <IdentityRow agent={a} onChange={(c) => void change(a.id, c)} />
          <SetupRows
            who={`${a.name}'s`}
            setup={a}
            defaults={state.defaults}
            models={state.models}
            lone={lone}
            onChange={(c) => void change(a.id, c)}
          />
        </SettingsSection>
      ))}
    </>
  );
}
