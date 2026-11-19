import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
  searchableSetting,
  toast,
} from "@otter/web/extension-kit";
import { useEffect, useState } from "react";

import type { OpenClawModels } from "../core/models";
import { openClawApi } from "./api";

/** The select's value for an agent with no model of its own. */
const DEFAULT = "default";

function ModelSelect({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-56">
        <SelectValue placeholder="Choose a model" />
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

/** The model OpenClaw's agents run on: the gateway's own setting, which all they do follows. */
export function OpenClawModelsSection({ agent }: { agent: string }) {
  const [state, setState] = useState<OpenClawModels | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void openClawApi.models(agent).then(setState, () => setState(null));
  }, [agent]);

  if (!state?.models.length) return null;

  const set = async (gatewayAgent: string | null, model: string | null) => {
    setBusy(true);
    try {
      setState(await openClawApi.setModel(agent, gatewayAgent, model));
    } catch (error) {
      toast.error(
        `Could not change the model: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  };
  const named = (id: string | null) =>
    id && !state.models.some((m) => m.id === id) ? [{ id, name: id }] : [];
  const nameOf = (id: string) => state.models.find((m) => m.id === id)?.name ?? id;
  // One agent following the default needs no row of its own.
  const agents = state.agents.filter((a) => state.agents.length > 1 || a.model);

  return (
    <SettingsSection
      {...searchableSetting("openclaw-models")}
      description="Set on your gateway, so everything its agents do follows it: chats here and in its other apps, and scheduled tasks without a model of their own."
    >
      <SettingsRow
        title="Default model"
        description={agents.length ? "For each agent without one of its own." : undefined}
        control={
          <ModelSelect
            label="Default model"
            value={state.defaultModel ?? ""}
            options={[...named(state.defaultModel), ...state.models]}
            disabled={busy}
            onChange={(model) => void set(null, model)}
          />
        }
      />
      {agents.map((a) => (
        <SettingsRow
          key={a.id}
          title={a.name}
          control={
            <ModelSelect
              label={`${a.name}'s model`}
              value={a.model ?? DEFAULT}
              options={[
                {
                  id: DEFAULT,
                  name: state.defaultModel ? `Default (${nameOf(state.defaultModel)})` : "Default",
                },
                ...named(a.model),
                ...state.models,
              ]}
              disabled={busy}
              onChange={(model) => void set(a.id, model === DEFAULT ? null : model)}
            />
          }
        />
      ))}
    </SettingsSection>
  );
}
