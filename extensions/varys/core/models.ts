/**
 * varys's models in Otter's picker (`varys.models`, which needs `settings:read`): each one
 * `provider::id`, with its reasoning levels and fast mode as the composer's options. The pick is
 * Otter's setting and each chat's thread's model in varys, set when the thread starts and again
 * when you pick another (`threads.setModel`); varys's default for new threads stays the owner's.
 */

import type {
  Model,
  ModelCatalog,
  ModelChoice,
  ReasoningLevel,
  Varys,
} from "@generalpursuit/varys";
import { logger, type ProviderModel, type ProviderModelOption } from "@otter/core/extension-kit";

import type { VarysSettings } from "./settings.js";

const LEVELS: Record<ReasoningLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

function optionsOf(model: Model): ProviderModelOption[] {
  const options: ProviderModelOption[] = [];
  if (model.reasoningLevels.some((level) => level !== "off"))
    options.push({
      id: "reasoningEffort",
      label: "Reasoning",
      choices: [
        { id: "", label: "Default", description: "The owner's level in varys", isDefault: true },
        ...model.reasoningLevels.map((level) => ({ id: level, label: LEVELS[level] })),
      ],
    });
  if (model.fastMode)
    options.push({
      id: "serviceTier",
      label: "Speed",
      choices: [
        { id: "default", label: "Standard", isDefault: true },
        { id: "fast", label: "Fast", description: "Sooner, at a higher price" },
      ],
    });
  return options;
}

export function modelsOf(catalog: ModelCatalog): ProviderModel[] {
  const preselected = catalog.default?.model;
  return catalog.models.map((model) => ({
    slug: `${model.provider}::${model.id}`,
    name: model.name,
    subProvider: model.providerName,
    ...(preselected?.provider === model.provider &&
      preselected.model === model.id && { isDefault: true }),
    options: optionsOf(model),
  }));
}

/** One agent's models, as its last check listed them: what a message picks from. */
export function varysModels() {
  let listed: ModelCatalog | null = null;

  /** varys's models, or why there are none to pick: a grant paired before it could list them. */
  async function list(varys: Varys): Promise<{ models: ProviderModel[] } | { refused: string }> {
    const catalog = await varys.models.list();
    if (catalog.isErr()) {
      logger.info("agent", "varys models not listed", { code: catalog.error.code });
      return { refused: catalog.error.code };
    }
    listed = catalog.value;
    return { models: modelsOf(catalog.value) };
  }

  /**
   * The model you picked, as varys takes it; null leaves the thread to varys (nothing picked, or
   * a model the owner's logins can't use now). "Default" reasoning is the owner's default level.
   */
  async function choiceOf(varys: Varys, settings: VarysSettings): Promise<ModelChoice | null> {
    const split = settings.model.indexOf("::");
    if (split < 0) return null;
    if (!listed) await list(varys);
    const provider = settings.model.slice(0, split);
    const id = settings.model.slice(split + 2);
    const model = listed?.models.find((m) => m.provider === provider && m.id === id);
    if (!model) return null;
    const level = settings.reasoningEffort as ReasoningLevel;
    return {
      model: { provider, model: id },
      reasoning: model.reasoningLevels.includes(level)
        ? level
        : (listed?.default?.reasoning ?? "medium"),
      fast: model.fastMode && settings.serviceTier === "fast",
    };
  }

  return {
    list,
    choiceOf,
    forget() {
      listed = null;
    },
  };
}

export const sameChoice = (a: ModelChoice | null, b: ModelChoice) =>
  a !== null &&
  a.model.provider === b.model.provider &&
  a.model.model === b.model.model &&
  a.reasoning === b.reasoning &&
  a.fast === b.fast;
