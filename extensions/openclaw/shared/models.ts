import { useCallback, useEffect, useState } from "react";
import { host } from "@otter/client/host";

import type {
  FastMode,
  OpenClawChange,
  OpenClawModel,
  OpenClawModels,
  OpenClawSetup,
} from "../core/models";
import { openClawApi } from "./api";

/** A select's value for what isn't set: an agent follows the default. */
const DEFAULT = "default";
/** The utility model's value for none. */
const NONE = "none";

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

export type Option = { id: string; name: string };

/** A choice of the setup: its value, what it offers, and the change picking one makes. */
export type SetupChoice = {
  value: string;
  options: Option[];
  description?: string;
  pick: (value: string) => Partial<OpenClawSetup>;
};

/**
 * What the defaults (no `defaults`), or one agent, run with, as its settings offer it: model,
 * fallbacks, thinking, fast mode and utility model. An agent's choices offer the default; a lone
 * agent shows only what it has of its own, as the defaults are its. A choice is null where it
 * isn't shown.
 */
export function setupChoices({
  setup,
  defaults,
  models,
  lone,
}: {
  setup: OpenClawSetup;
  defaults?: OpenClawSetup;
  models: OpenClawModel[];
  lone?: boolean;
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
  const levels = model?.thinkingLevels ?? [];
  const automaticLevel = model?.thinkingDefault ? levelName(model.thinkingDefault) : null;
  const utilityName = (value: string | null) =>
    value === null ? "Automatic" : value === "" ? "None" : nameOf(value);

  return {
    nameOf,
    model: shown(setup.model)
      ? ({
          value: setup.model ?? (defaults ? DEFAULT : ""),
          options: [
            ...inherited(defaults?.model ? nameOf(defaults.model) : "none"),
            ...unlisted(setup.model),
            ...models,
          ],
          pick: (v) => ({ model: v === DEFAULT ? null : v }),
        } satisfies SetupChoice)
      : null,
    fallbacks: shown(setup.fallbacks)
      ? {
          chain,
          description: !defaults
            ? "Tried in order when the model is unavailable."
            : setup.fallbacks
              ? chain.length
                ? "Tried in order when its model is unavailable."
                : "None."
              : setup.model
                ? "None: with a model of its own, it falls back only to its own."
                : defaults.fallbacks?.length
                  ? `The default's: ${defaults.fallbacks.map(nameOf).join(", ")}.`
                  : "None, like the default.",
          /** Back to the default's. */
          resettable: Boolean(defaults && setup.fallbacks),
          addable: models.filter((m) => m.id !== modelId && !chain.includes(m.id)),
          add: (id: string): Partial<OpenClawSetup> => ({ fallbacks: [...chain, id] }),
          remove: (id: string): Partial<OpenClawSetup> => ({
            fallbacks: chain.filter((f) => f !== id),
          }),
        }
      : null,
    thinking:
      shown(setup.thinking) && (levels.length || setup.thinking)
        ? ({
            value: setup.thinking ?? DEFAULT,
            description: defaults ? undefined : "How hard it thinks before it answers.",
            options: [
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
            ],
            pick: (v) => ({ thinking: v === DEFAULT ? null : v }),
          } satisfies SetupChoice)
        : null,
    fast:
      shown(setup.fast) && (model?.fast !== false || setup.fast !== null)
        ? ({
            value: setup.fast === null ? (defaults ? DEFAULT : "standard") : fastOf(setup.fast).id,
            description: defaults
              ? undefined
              : "Faster replies, which cost more. Auto uses it for each reply's first minute.",
            options: [
              ...inherited(fastOf(defaults?.fast ?? null).name),
              ...FAST.filter((f) => f.value !== "ultrafast" || setup.fast === "ultrafast"),
            ],
            pick: (v) => ({ fast: v === DEFAULT ? null : FAST.find((f) => f.id === v)!.value }),
          } satisfies SetupChoice)
        : null,
    utilityModel: shown(setup.utilityModel)
      ? ({
          value:
            setup.utilityModel === null
              ? DEFAULT
              : setup.utilityModel === ""
                ? NONE
                : setup.utilityModel,
          description: defaults
            ? undefined
            : "For small jobs: chat titles and progress notes. Automatic picks its provider's small model.",
          options: [
            defaults
              ? { id: DEFAULT, name: `Default (${utilityName(defaults.utilityModel)})` }
              : { id: DEFAULT, name: "Automatic" },
            { id: NONE, name: "None" },
            ...unlisted(setup.utilityModel || null),
            ...models,
          ],
          pick: (v) => ({ utilityModel: v === DEFAULT ? null : v === NONE ? "" : v }),
        } satisfies SetupChoice)
      : null,
  };
}

/**
 * How the gateway's agents run, read from it: its defaults and each agent's own. A change shows
 * at once and is set on the gateway; when it can't be, that's said and they're read again.
 */
export function useOpenClawAgents(agent: string) {
  const [state, setState] = useState<OpenClawModels | null>(null);

  const load = useCallback(() => {
    void openClawApi.models(agent).then(setState, () => setState(null));
  }, [agent]);
  useEffect(load, [load]);

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
      host().notice({
        tone: "error",
        title: `Could not change it on the gateway: ${error instanceof Error ? error.message : String(error)}`,
      });
      load();
    }
  };

  return { state, change };
}
