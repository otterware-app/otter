import {
  canStartChat,
  disabledAgents,
  enabledModels,
  isProviderUsable,
  startingModel,
} from "./agent-providers.ts";
import type {
  ProviderKind,
  ProviderModel,
  ProviderModelOption,
  ProviderSnapshot,
  RuntimeMode,
} from "./api.ts";
import { modelKey } from "./model-prefs.ts";

/** A model's id as people say it: "claude-opus-4-1-20250805" is "Claude Opus 4.1". */
export function modelLabel(name: string): string {
  if (!/^[a-z0-9.-]+$/.test(name)) return name;
  const parts = name.split("-").filter((part) => !/^\d{8}$/.test(part));
  const words: string[] = [];
  for (const part of parts) {
    const last = words[words.length - 1];
    if (/^\d+$/.test(part) && last && /\d$/.test(last)) words[words.length - 1] = `${last}.${part}`;
    else if (/^\d/.test(part) && last === "GPT") words[words.length - 1] = `GPT-${part}`;
    else if (part === "gpt") words.push("GPT");
    // OpenAI's o-series keeps its lowercase (o3, o4-mini).
    else if (/^o\d/.test(part)) words.push(part);
    else words.push(part.charAt(0).toUpperCase() + part.slice(1));
  }
  return words.join(" ");
}

/** Where `query`'s words fall in these fields (earlier fields, starts of words: better); null when one doesn't. */
export function searchScore(fields: string[], query: string): number | null {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = fields.map((f) => f.toLowerCase());
  let score = 0;
  for (const token of tokens) {
    let best: number | null = null;
    lower.forEach((field, i) => {
      const at = field.indexOf(token);
      if (at === -1) return;
      const s =
        i * 10 +
        (field === token ? 0 : at === 0 ? 2 : /[\s\-_.]/.test(field[at - 1] ?? "") ? 4 : 6);
      best = best === null ? s : Math.min(best, s);
    });
    if (best === null) return null;
    score += best;
  }
  return score;
}

/** Ranks items by `fields` against `query`, dropping those it misses; all of them, in order, without one. */
export function searchBy<T>(items: T[], query: string, fields: (item: T) => string[]): T[] {
  if (!query.trim()) return items;
  return items
    .map((item) => ({ item, score: searchScore(fields(item), query) }))
    .filter((r): r is { item: T; score: number } => r.score !== null)
    .sort((a, b) => a.score - b.score)
    .map((r) => r.item);
}

/** Why an agent can't be picked, or null when it can. */
export function agentUnavailable(p: ProviderSnapshot): string | null {
  if (isProviderUsable(p)) return null;
  if (!p.enabled) return "Turned off";
  return p.status === "error" ? "Unavailable" : "Not ready";
}

/** One row of the agent picker: an agent, or one of the agents an OpenClaw gateway runs. */
export type AgentItem = {
  key: string;
  provider: ProviderSnapshot;
  /** The gateway's agent (`ProviderModel.slug`), for a kind whose models are agents. */
  agent: string | null;
  name: string;
  detail: string;
  status: string | null;
};

/**
 * The agent picker's rows: each agent, or each of a gateway's agents (`subAgents`) that's on, with
 * what it runs on (its model, or its kind, `kindName`). A gateway with all its agents off has none.
 */
export function agentItems(
  providers: ProviderSnapshot[],
  subAgents: (kind: ProviderKind) => boolean,
  kindName: (kind: ProviderKind) => string,
): AgentItem[] {
  return providers.flatMap((p): AgentItem[] => {
    const status = agentUnavailable(p);
    if (!canStartChat(p)) return [];
    if (subAgents(p.kind) && p.models.length > 0)
      return enabledModels(p).map((m) => ({
        key: `${p.id}:${m.slug}`,
        provider: p,
        agent: m.slug,
        name: m.name,
        detail: p.name,
        status,
      }));
    const model = p.models.find((m) => m.slug === p.model);
    return [
      {
        key: p.id,
        provider: p,
        agent: null,
        name: p.name,
        detail: model && p.models.length > 1 ? modelLabel(model.name) : kindName(p.kind),
        status,
      },
    ];
  });
}

export const searchAgentItems = (items: AgentItem[], query: string) =>
  searchBy(items, query, (item) => [
    item.name,
    item.detail,
    item.provider.name,
    item.provider.kind,
  ]);

/**
 * The agent a chat's picker shows: for a gateway (`subAgents`), the gateway's agent the chat is
 * bound to (`agent`) or the one new chats start with.
 */
export function pickedAgent(
  active: ProviderSnapshot | undefined,
  agent: string | null,
  subAgents: boolean,
) {
  const chosen =
    active?.model && disabledAgents(active).includes(active.model)
      ? startingModel(active)
      : active?.model;
  const slug = active && subAgents ? (agent ?? chosen ?? null) : null;
  const shown = slug ? active?.models.find((m) => m.slug === slug) : undefined;
  return {
    /** The gateway's agent shown, or null. */
    slug,
    label: shown?.name ?? active?.name ?? "Choose agent",
    key: active ? (slug ? `${active.id}:${slug}` : active.id) : null,
  };
}

/**
 * The models the picker lists: hidden ones left out (unless it's the one in use); searched, best
 * first; else in their providers' groups (Hermes's "Anthropic"…), favorites first in each.
 */
export function pickerModels(
  provider: ProviderSnapshot,
  { favorites, hidden }: { favorites: string[]; hidden: string[] },
  query: string,
): ProviderModel[] {
  const key = (m: ProviderModel) => modelKey(provider.id, m.slug);
  const shown = provider.models.filter(
    (m) => !hidden.includes(key(m)) || m.slug === provider.model,
  );
  if (query.trim()) return searchBy(shown, query, (m) => [m.name, m.slug, m.subProvider ?? ""]);
  const groups = [...new Set(shown.map((m) => m.subProvider ?? null))];
  return groups.flatMap((group) => {
    const inGroup = shown.filter((m) => (m.subProvider ?? null) === group);
    const starred = (m: ProviderModel) => favorites.includes(key(m));
    return [...inGroup.filter(starred), ...inGroup.filter((m) => !starred(m))];
  });
}

/** The choice of a model's option in use: the one chosen, else its default. */
export function currentChoice(option: ProviderModelOption, chosen: string): string | undefined {
  return (
    option.choices.find((c) => c.id === chosen)?.id ?? option.choices.find((c) => c.isDefault)?.id
  );
}

/** What the traits picker says: the options chosen ("High"), and whether Fast mode is on. */
export function traitsLabel(
  options: ProviderModelOption[],
  values: Partial<Record<ProviderModelOption["id"], string>>,
): { label: string; fast: boolean; accessible: string } {
  const labels: string[] = [];
  let fast = false;
  for (const option of options) {
    const value = currentChoice(option, values[option.id] ?? "");
    const choice = option.choices.find((c) => c.id === value);
    if (option.id === "serviceTier") {
      fast = choice?.label === "Fast";
      continue;
    }
    if (choice) labels.push(choice.label);
  }
  const label = labels.join(" · ") || (fast ? "Fast" : "Standard");
  return { label, fast, accessible: fast ? `${label}, Fast mode on` : label };
}

export const RUNTIME_MODES: { value: RuntimeMode; label: string; description: string }[] = [
  {
    value: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    value: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    value: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
];

export const runtimeModeOf = (value: RuntimeMode) =>
  RUNTIME_MODES.find((o) => o.value === value) ?? RUNTIME_MODES[2];

export type ModelGroup = "favorite" | "visible" | "hidden";

/**
 * An agent's models as its settings list them: favorites, then the rest, then those hidden from
 * the picker, matching `filter`; with the counts and whether anything is set.
 */
export function modelsList(
  provider: ProviderSnapshot,
  { favorites, hidden }: { favorites: string[]; hidden: string[] },
  filter: string,
  selectedModel: string,
) {
  const key = (slug: string) => modelKey(provider.id, slug);
  const favoriteSet = new Set(favorites);
  const hiddenSet = new Set(hidden);
  const groupOf = (m: ProviderModel): ModelGroup =>
    favoriteSet.has(key(m.slug)) ? "favorite" : hiddenSet.has(key(m.slug)) ? "hidden" : "visible";
  const rank = { favorite: 0, visible: 1, hidden: 2 } as const;
  const models = provider.models;
  const query = filter.trim().toLowerCase();
  const allKeys = models.map((m) => key(m.slug));
  const mine = (k: string) => k.startsWith(`${provider.id}:`);
  return {
    query,
    shown: models
      .filter(
        (m) =>
          !query ||
          m.name.toLowerCase().includes(query) ||
          m.slug.toLowerCase().includes(query) ||
          (m.subProvider ?? "").toLowerCase().includes(query),
      )
      .sort((a, b) => rank[groupOf(a)] - rank[groupOf(b)]),
    groupOf,
    isHidden: (m: ProviderModel) => hiddenSet.has(key(m.slug)),
    favoriteCount: models.filter((m) => favoriteSet.has(key(m.slug))).length,
    hiddenCount: models.filter((m) => hiddenSet.has(key(m.slug))).length,
    allKeys,
    allHidden: allKeys.length > 0 && allKeys.every((k) => hiddenSet.has(k)),
    /** Something to reset: a default model, favorites or hidden models. */
    customized: Boolean(selectedModel) || favorites.some(mine) || hidden.some(mine),
  };
}

/** What a model offers beyond answering, for its row: its options, Fast for a service tier. */
export const modelCapabilities = (model: ProviderModel): string[] =>
  (model.options ?? []).map((o) => (o.id === "serviceTier" ? "Fast" : o.label));
