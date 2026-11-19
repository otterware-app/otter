import type { TaskModel } from "@otter/contracts/scheduled";

export type Request = <T>(method: string, params: unknown) => Promise<T>;

/** Which model the gateway's agents run on: its default, and each agent's own. */
export type OpenClawModels = {
  defaultModel: string | null;
  agents: { id: string; name: string; model: string | null }[];
  models: TaskModel[];
};

type ModelChoice = { id: string; name: string; provider: string; available?: boolean };

type ModelConfig = string | { primary?: string; fallbacks?: string[] } | undefined;

type AgentsConfig = {
  defaults?: { model?: ModelConfig };
  entries?: Record<string, { model?: ModelConfig }>;
};

const primaryOf = (model: ModelConfig): string | null =>
  (typeof model === "string" ? model : model?.primary) || null;

/** The models the gateway offers, as `provider/model`: what its config and its jobs name. */
export async function gatewayModels(request: Request, agentId?: string): Promise<TaskModel[]> {
  const { models } = await request<{ models?: ModelChoice[] }>("models.list", {
    ...(agentId ? { agentId } : {}),
    view: "default",
  });
  return (models ?? [])
    .filter((m) => m.available !== false)
    .map((m) => ({ id: `${m.provider}/${m.id}`, name: m.name }));
}

export async function openClawModels(request: Request): Promise<OpenClawModels> {
  const [{ sourceConfig }, { agents }, models] = await Promise.all([
    request<{ sourceConfig?: { agents?: AgentsConfig } }>("config.get", {}),
    request<{ agents?: { id: string; name?: string; identity?: { name?: string } }[] }>(
      "agents.list",
      {},
    ),
    gatewayModels(request),
  ]);
  const config = sourceConfig?.agents;
  return {
    defaultModel: primaryOf(config?.defaults?.model),
    agents: (agents ?? []).map((agent) => ({
      id: agent.id,
      name: agent.identity?.name ?? agent.name ?? agent.id,
      model: primaryOf(config?.entries?.[agent.id]?.model),
    })),
    models,
  };
}

/**
 * Sets the gateway's default model, or one agent's own (null: it follows the default). Only the
 * primary changes: fallbacks set beside it stay.
 */
export async function setOpenClawModel(
  request: Request,
  agentId: string | null,
  model: string | null,
): Promise<void> {
  if (!agentId && !model) throw new Error("Choose a model.");
  const { hash, sourceConfig } = await request<{
    hash: string;
    sourceConfig?: { agents?: AgentsConfig };
  }>("config.get", {});
  const own = agentId ? sourceConfig?.agents?.entries?.[agentId]?.model : undefined;
  const value = model
    ? { primary: model }
    : typeof own === "object" && Array.isArray(own.fallbacks)
      ? { primary: null }
      : null;
  await request("config.patch", {
    raw: JSON.stringify({
      agents: agentId
        ? { entries: { [agentId]: { model: value } } }
        : { defaults: { model: value } },
    }),
    baseHash: hash,
    note: agentId ? `Otter: ${agentId}'s model` : "Otter: the default model",
  });
}
