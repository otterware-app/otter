import type { TaskModel } from "@otter/contracts/scheduled";

export type Request = <T>(method: string, params: unknown) => Promise<T>;

export type FastMode = boolean | "auto" | "ultrafast";

/** How the gateway's agents run, by default or for one agent; null: not set (an agent follows the default). */
export type OpenClawSetup = {
  model: string | null;
  /** Tried in order when the model is unavailable. */
  fallbacks: string[] | null;
  thinking: string | null;
  fast: FastMode | null;
  /** For small jobs (titles, progress notes); "": none. */
  utilityModel: string | null;
};

export type OpenClawAgent = OpenClawSetup & {
  id: string;
  name: string;
  avatar: string | null;
  emoji: string | null;
};

export type OpenClawModel = TaskModel & {
  thinkingLevels: { id: string; label: string }[];
  thinkingDefault: string | null;
  /** False when fast mode does nothing for it. */
  fast: boolean;
};

/** The gateway's agents as Settings shows them: its defaults, and each agent's own. */
export type OpenClawModels = {
  defaults: OpenClawSetup;
  agents: OpenClawAgent[];
  models: OpenClawModel[];
};

/** What a change names is set (null: back to not set); the rest stays. */
export type OpenClawChange = Partial<OpenClawSetup> & { name?: string; avatar?: string | null };

type ModelChoice = {
  id: string;
  name: string;
  provider: string;
  available?: boolean;
  thinkingLevels?: { id: string; label: string }[];
  thinkingDefault?: string;
  supportsFastMode?: boolean;
};

type ModelConfig = string | { primary?: string | null; fallbacks?: string[] } | undefined;

type SetupConfig = {
  model?: ModelConfig;
  thinkingDefault?: string;
  fastModeDefault?: FastMode;
  utilityModel?: string;
};

type AgentsConfig = { defaults?: SetupConfig; entries?: Record<string, SetupConfig> };

export type GatewayAgent = {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string; avatarUrl?: string };
};

const MAX_AVATAR_LENGTH = 512_000;

export function agentAvatar(agent: GatewayAgent): string | undefined {
  const url = agent.identity?.avatarUrl;
  if (!url || url.length > MAX_AVATAR_LENGTH) return undefined;
  return /^(https:|data:image\/)/i.test(url) ? url : undefined;
}

async function catalog(request: Request, agentId?: string): Promise<ModelChoice[]> {
  const { models } = await request<{ models?: ModelChoice[] }>("models.list", {
    ...(agentId ? { agentId } : {}),
    view: "default",
  });
  return (models ?? []).filter((m) => m.available !== false);
}

const ref = (m: ModelChoice) => `${m.provider}/${m.id}`;

/** The models the gateway offers, as `provider/model`: what its config and its jobs name. */
export async function gatewayModels(request: Request, agentId?: string): Promise<TaskModel[]> {
  return (await catalog(request, agentId)).map((m) => ({ id: ref(m), name: m.name }));
}

function setupOf(config: SetupConfig | undefined): OpenClawSetup {
  const model = config?.model;
  return {
    model: (typeof model === "string" ? model : model?.primary) || null,
    fallbacks: typeof model === "object" && Array.isArray(model.fallbacks) ? model.fallbacks : null,
    thinking: config?.thinkingDefault || null,
    fast: config?.fastModeDefault ?? null,
    utilityModel: config?.utilityModel ?? null,
  };
}

const readConfig = (request: Request) =>
  request<{ hash: string; sourceConfig?: { agents?: AgentsConfig } }>("config.get", {});

const patchAgents = (
  request: Request,
  baseHash: string,
  agents: unknown,
  note: string,
  replacePaths?: string[],
) =>
  request("config.patch", {
    raw: JSON.stringify({ agents }),
    baseHash,
    note,
    ...(replacePaths ? { replacePaths } : {}),
  });

export async function openClawModels(request: Request): Promise<OpenClawModels> {
  const [{ sourceConfig }, { agents }, models] = await Promise.all([
    readConfig(request),
    request<{ agents?: GatewayAgent[] }>("agents.list", {}),
    catalog(request),
  ]);
  const config = sourceConfig?.agents;
  return {
    defaults: setupOf(config?.defaults),
    agents: (agents ?? []).map((agent) => ({
      id: agent.id,
      name: agent.identity?.name ?? agent.name ?? agent.id,
      avatar: agentAvatar(agent) ?? null,
      emoji: agent.identity?.emoji ?? null,
      ...setupOf(config?.entries?.[agent.id]),
    })),
    models: models.map((m) => ({
      id: ref(m),
      name: m.name,
      thinkingLevels: m.thinkingLevels ?? [],
      thinkingDefault: m.thinkingDefault ?? null,
      fast: m.supportsFastMode !== false,
    })),
  };
}

/**
 * The config's `model` after a change to its primary or its fallbacks, as a merge patch: the part
 * not changed stays. An agent with a primary of its own has no fallbacks but its own.
 */
function modelPatch(own: ModelConfig, change: Partial<OpenClawSetup>): unknown {
  if ("model" in change) {
    if (change.model) return { primary: change.model };
    return typeof own === "object" && Array.isArray(own.fallbacks) ? { primary: null } : null;
  }
  const fallbacks = change.fallbacks ?? null;
  if (typeof own === "string") return fallbacks ? { primary: own, fallbacks } : undefined;
  if (!fallbacks && !own?.primary) return own ? null : undefined;
  return { fallbacks };
}

/** Changes the gateway's defaults, or one agent's own, against the config it read. */
export async function changeOpenClawSetup(
  request: Request,
  agentId: string | null,
  change: Partial<OpenClawSetup>,
): Promise<void> {
  if (!agentId && "model" in change && !change.model) throw new Error("Choose a model.");
  const { hash, sourceConfig } = await readConfig(request);
  const config = sourceConfig?.agents;
  const own = (agentId ? config?.entries?.[agentId] : config?.defaults)?.model;
  const patch = {
    ...("model" in change || "fallbacks" in change ? { model: modelPatch(own, change) } : {}),
    ...("thinking" in change ? { thinkingDefault: change.thinking } : {}),
    ...("fast" in change ? { fastModeDefault: change.fast } : {}),
    ...("utilityModel" in change ? { utilityModel: change.utilityModel } : {}),
  };
  if (Object.values(patch).every((v) => v === undefined)) return;
  await patchAgents(
    request,
    hash,
    agentId ? { entries: { [agentId]: patch } } : { defaults: patch },
    agentId ? `Otter: ${agentId}'s settings` : "Otter: the defaults",
    // Without it the gateway refuses a patch that takes models out of the list.
    "fallbacks" in change
      ? [`agents.${agentId ? `entries.${agentId}` : "defaults"}.model.fallbacks`]
      : undefined,
  );
}

/** agents.update takes only an agent the config lists, which a gateway's only agent may not be. */
async function listAgent(request: Request, agentId: string): Promise<void> {
  const { hash, sourceConfig } = await readConfig(request);
  if (sourceConfig?.agents?.entries?.[agentId]) return;
  await patchAgents(request, hash, { entries: { [agentId]: {} } }, `Otter: ${agentId}`);
}

// A picture as OpenClaw writes it in IDENTITY.md; the template's empty one is "- **Avatar:**".
const AVATAR_LINE = /^- (?:\*\*Avatar:\*\*|Avatar:)[ \t]+\S.*$/m;

/**
 * Renames an agent, or changes its picture, through agents.update: it writes them to the agent's
 * IDENTITY.md too, which is how the agent knows its name, and which its prompt carries on every
 * turn, picture included. agents.update can't clear a picture: that patches the config and takes
 * the line out of IDENTITY.md.
 */
export async function setOpenClawIdentity(
  request: Request,
  agentId: string,
  identity: { name: string } | { avatar: string | null },
): Promise<void> {
  if (!("avatar" in identity) || identity.avatar) {
    await listAgent(request, agentId);
    await request("agents.update", { agentId, ...identity });
    return;
  }
  const { hash } = await readConfig(request);
  await patchAgents(
    request,
    hash,
    { entries: { [agentId]: { identity: { avatar: null } } } },
    `Otter: ${agentId}'s picture`,
  );
  const { file } = await request<{ file: { content?: string; hash?: string } }>(
    "agents.files.get",
    { agentId, name: "IDENTITY.md" },
  );
  if (!file.content || !AVATAR_LINE.test(file.content)) return;
  await request("agents.files.set", {
    agentId,
    name: "IDENTITY.md",
    content: file.content.replace(AVATAR_LINE, "- **Avatar:**"),
    ...(file.hash ? { expectedHash: file.hash } : {}),
  });
}

export async function changeOpenClaw(
  request: Request,
  agentId: string | null,
  { name, avatar, ...setup }: OpenClawChange,
): Promise<void> {
  if (agentId && name) await setOpenClawIdentity(request, agentId, { name });
  if (agentId && avatar !== undefined) await setOpenClawIdentity(request, agentId, { avatar });
  if (Object.keys(setup).length) await changeOpenClawSetup(request, agentId, setup);
}
