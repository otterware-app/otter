import { PictureError, mailboxPicture, searchableSetting } from "@otter/web/extension-kit";
import { toast } from "@otter/ui/components/toast";
import { XIcon } from "lucide-react";
import { useRef } from "react";
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

import type { OpenClawAgent, OpenClawChange, OpenClawModel, OpenClawSetup } from "../core/models";
import { setupChoices, useOpenClawAgents, type Option, type SetupChoice } from "../shared/models";
import { OpenClawIcon } from "./icon";
import { SettingsResetButton, SettingsRow, SettingsSection } from "@otter/ui/components/settings";
import { DraftInput } from "@otter/ui/components/input";

// The gateway puts the picture in the agent's prompt on every turn (IDENTITY.md): about 900 tokens at most.
const PICTURE_SIZE = { sides: [64, 48, 32], maxLength: 4_000 };

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
  const choices = setupChoices({ setup, defaults, models, lone });
  const { nameOf, fallbacks } = choices;
  const row = (title: string, label: string, choice: SetupChoice | null) =>
    choice ? (
      <SettingsRow
        title={title}
        description={choice.description}
        control={
          <OptionSelect
            label={label}
            value={choice.value}
            options={choice.options}
            onChange={(v) => onChange(choice.pick(v))}
          />
        }
      />
    ) : null;

  return (
    <>
      {row("Model", `${who} model`, choices.model)}
      {fallbacks ? (
        <SettingsRow
          title="Fallbacks"
          description={fallbacks.description}
          resetAction={
            fallbacks.resettable ? (
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
              options={fallbacks.addable}
              onChange={(v) => onChange(fallbacks.add(v))}
            />
          }
        >
          {fallbacks.chain.length ? (
            <ol className="flex flex-wrap gap-1.5 pb-2">
              {fallbacks.chain.map((id) => (
                <li
                  key={id}
                  className="inline-flex h-7 items-center gap-0.5 rounded-lg border border-border/70 bg-surface-raised/60 pr-0.5 pl-2.5 text-body text-foreground"
                >
                  {nameOf(id)}
                  <IconButton
                    label={`Remove ${nameOf(id)}`}
                    size="icon-xs"
                    onClick={() => onChange(fallbacks.remove(id))}
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
      {row("Thinking", `${who} thinking`, choices.thinking)}
      {row("Fast mode", `${who} fast mode`, choices.fast)}
      {row("Utility model", `${who} utility model`, choices.utilityModel)}
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
  const { state, change } = useOpenClawAgents(agent);

  if (!state?.models.length) return null;

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
