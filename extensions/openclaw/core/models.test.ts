import { describe, expect, it } from "vite-plus/test";

import { openClawModels, setOpenClawModel, type Request } from "./models.js";

function fakeGateway(answer: (method: string) => unknown) {
  const calls: { method: string; params: { raw?: string } & Record<string, unknown> }[] = [];
  const request: Request = async <T>(method: string, params: unknown) => {
    calls.push({ method, params: params as { raw?: string } });
    return answer(method) as T;
  };
  return { request, calls };
}

// Shaped like a 2026.11 gateway's answers.
const answers = (method: string) =>
  method === "config.get"
    ? {
        hash: "sha256:config",
        sourceConfig: {
          agents: {
            defaults: {
              model: { primary: "openai/gpt-6.1-sol", fallbacks: ["openai/gpt-6-luna"] },
            },
            entries: { main: { name: "main" }, research: { model: "anthropic/opus" } },
          },
        },
      }
    : method === "agents.list"
      ? {
          defaultId: "main",
          agents: [
            { id: "main", identity: { name: "Rowan" }, model: { primary: "openai/gpt-6.1-sol" } },
            { id: "research", model: { primary: "anthropic/opus" } },
          ],
        }
      : { models: [{ id: "gpt-6.1-sol", name: "GPT-6.1-Sol", provider: "openai" }] };

describe("openClawModels", () => {
  it("reads the default model and each agent's own, not the one it inherits", async () => {
    const { request } = fakeGateway(answers);
    expect(await openClawModels(request)).toEqual({
      defaultModel: "openai/gpt-6.1-sol",
      agents: [
        { id: "main", name: "Rowan", model: null },
        { id: "research", name: "research", model: "anthropic/opus" },
      ],
      models: [{ id: "openai/gpt-6.1-sol", name: "GPT-6.1-Sol" }],
    });
  });
});

describe("setOpenClawModel", () => {
  it("changes only the default's primary model, against the config it read", async () => {
    const { request, calls } = fakeGateway(answers);
    await setOpenClawModel(request, null, "openai/gpt-6.2-sol");
    expect(calls[1]).toEqual({
      method: "config.patch",
      params: {
        raw: JSON.stringify({ agents: { defaults: { model: { primary: "openai/gpt-6.2-sol" } } } }),
        baseHash: "sha256:config",
        note: "Otter: the default model",
      },
    });
  });

  it("gives an agent a model of its own, or puts it back on the default, keeping its fallbacks", async () => {
    const { request, calls } = fakeGateway((method) =>
      method === "config.get"
        ? {
            hash: "sha256:config",
            sourceConfig: {
              agents: {
                entries: {
                  main: { model: "openai/gpt-6.1-sol" },
                  strict: { model: { primary: "openai/gpt-6-luna", fallbacks: [] } },
                  research: {
                    model: { primary: "anthropic/opus", fallbacks: ["openai/gpt-6-luna"] },
                  },
                },
              },
            },
          }
        : { ok: true },
    );
    await setOpenClawModel(request, "research", "openai/gpt-6.2-sol");
    await setOpenClawModel(request, "research", null);
    await setOpenClawModel(request, "main", null);
    await setOpenClawModel(request, "strict", null);
    expect(
      calls.filter((c) => c.method === "config.patch").map((c) => JSON.parse(c.params.raw!)),
    ).toEqual([
      { agents: { entries: { research: { model: { primary: "openai/gpt-6.2-sol" } } } } },
      { agents: { entries: { research: { model: { primary: null } } } } },
      { agents: { entries: { main: { model: null } } } },
      { agents: { entries: { strict: { model: { primary: null } } } } },
    ]);
  });
});
