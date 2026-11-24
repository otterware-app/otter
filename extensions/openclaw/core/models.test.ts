import { describe, expect, it } from "vite-plus/test";

import {
  changeOpenClaw,
  changeOpenClawSetup,
  openClawModels,
  setOpenClawIdentity,
  type Request,
} from "./models.ts";

function fakeGateway(answer: (method: string, params: Record<string, unknown>) => unknown) {
  const calls: { method: string; params: { raw?: string } & Record<string, unknown> }[] = [];
  const request: Request = async <T>(method: string, params: unknown) => {
    calls.push({ method, params: params as { raw?: string } });
    return answer(method, params as Record<string, unknown>) as T;
  };
  const patches = () =>
    calls.filter((c) => c.method === "config.patch").map((c) => JSON.parse(c.params.raw!));
  return { request, calls, patches };
}

const PICTURE = "data:image/webp;base64,UklGR";

// Shaped like a 2026.11 gateway's answers.
const answers = (method: string) =>
  method === "config.get"
    ? {
        hash: "sha256:config",
        sourceConfig: {
          agents: {
            defaults: {
              model: { primary: "openai/gpt-6.1-sol", fallbacks: ["openai/gpt-6-luna"] },
              thinkingDefault: "high",
              utilityModel: "",
            },
            entries: {
              main: { name: "main" },
              research: { model: "anthropic/opus", fastModeDefault: "auto" },
            },
          },
        },
      }
    : method === "agents.list"
      ? {
          defaultId: "main",
          agents: [
            {
              id: "main",
              identity: { name: "Rowan", emoji: "🦦", avatarUrl: PICTURE },
              model: { primary: "openai/gpt-6.1-sol" },
              thinkingDefault: "high",
            },
            { id: "research", model: { primary: "anthropic/opus" } },
          ],
        }
      : {
          models: [
            {
              id: "gpt-6.1-sol",
              name: "GPT-6.1-Sol",
              provider: "openai",
              thinkingLevels: [{ id: "low", label: "low" }],
              thinkingDefault: "medium",
            },
            { id: "opus", name: "Opus", provider: "anthropic", supportsFastMode: false },
            { id: "old", name: "Old", provider: "openai", available: false },
          ],
        };

describe("openClawModels", () => {
  it("reads the defaults and each agent's own, not what it inherits", async () => {
    const { request } = fakeGateway(answers);
    expect(await openClawModels(request)).toEqual({
      defaults: {
        model: "openai/gpt-6.1-sol",
        fallbacks: ["openai/gpt-6-luna"],
        thinking: "high",
        fast: null,
        utilityModel: "",
      },
      agents: [
        {
          id: "main",
          name: "Rowan",
          avatar: PICTURE,
          emoji: "🦦",
          model: null,
          fallbacks: null,
          thinking: null,
          fast: null,
          utilityModel: null,
        },
        {
          id: "research",
          name: "research",
          avatar: null,
          emoji: null,
          model: "anthropic/opus",
          fallbacks: null,
          thinking: null,
          fast: "auto",
          utilityModel: null,
        },
      ],
      models: [
        {
          id: "openai/gpt-6.1-sol",
          name: "GPT-6.1-Sol",
          thinkingLevels: [{ id: "low", label: "low" }],
          thinkingDefault: "medium",
          fast: true,
        },
        {
          id: "anthropic/opus",
          name: "Opus",
          thinkingLevels: [],
          thinkingDefault: null,
          fast: false,
        },
      ],
    });
  });
});

describe("changeOpenClawSetup", () => {
  it("changes only the default's primary model, against the config it read", async () => {
    const { request, calls } = fakeGateway(answers);
    await changeOpenClawSetup(request, null, { model: "openai/gpt-6.2-sol" });
    expect(calls[1]).toEqual({
      method: "config.patch",
      params: {
        raw: JSON.stringify({ agents: { defaults: { model: { primary: "openai/gpt-6.2-sol" } } } }),
        baseHash: "sha256:config",
        note: "Otter: the defaults",
      },
    });
  });

  it("won't leave the defaults without a model", async () => {
    const { request } = fakeGateway(answers);
    await expect(changeOpenClawSetup(request, null, { model: null })).rejects.toThrow(
      "Choose a model.",
    );
  });

  const agents = (method: string) =>
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
                follower: { model: { fallbacks: ["openai/gpt-6-luna"] } },
              },
            },
          },
        }
      : { ok: true };

  it("gives an agent a model of its own, or puts it back on the default, keeping its fallbacks", async () => {
    const { request, patches } = fakeGateway(agents);
    await changeOpenClawSetup(request, "research", { model: "openai/gpt-6.2-sol" });
    await changeOpenClawSetup(request, "research", { model: null });
    await changeOpenClawSetup(request, "main", { model: null });
    await changeOpenClawSetup(request, "strict", { model: null });
    expect(patches()).toEqual([
      { agents: { entries: { research: { model: { primary: "openai/gpt-6.2-sol" } } } } },
      { agents: { entries: { research: { model: { primary: null } } } } },
      { agents: { entries: { main: { model: null } } } },
      { agents: { entries: { strict: { model: { primary: null } } } } },
    ]);
  });

  it("changes fallbacks beside the primary, wherever the config keeps it", async () => {
    const { request, patches } = fakeGateway(agents);
    await changeOpenClawSetup(request, "main", { fallbacks: ["openai/gpt-6-luna"] });
    await changeOpenClawSetup(request, "main", { fallbacks: null });
    await changeOpenClawSetup(request, "research", { fallbacks: [] });
    await changeOpenClawSetup(request, "follower", { fallbacks: null });
    await changeOpenClawSetup(request, "new", { fallbacks: ["openai/gpt-6-luna"] });
    expect(patches()).toEqual([
      {
        agents: {
          entries: {
            main: { model: { primary: "openai/gpt-6.1-sol", fallbacks: ["openai/gpt-6-luna"] } },
          },
        },
      },
      { agents: { entries: { research: { model: { fallbacks: [] } } } } },
      { agents: { entries: { follower: { model: null } } } },
      { agents: { entries: { new: { model: { fallbacks: ["openai/gpt-6-luna"] } } } } },
    ]);
  });

  it("lets the gateway take models out of the list", async () => {
    const { request, calls } = fakeGateway(agents);
    await changeOpenClawSetup(request, "research", { fallbacks: [] });
    await changeOpenClawSetup(request, null, { fallbacks: ["openai/gpt-6-luna"] });
    expect(
      calls.filter((c) => c.method === "config.patch").map((c) => c.params.replacePaths),
    ).toEqual([["agents.entries.research.model.fallbacks"], ["agents.defaults.model.fallbacks"]]);
  });

  it("sets thinking, fast mode and the utility model, or clears them", async () => {
    const { request, patches } = fakeGateway(agents);
    await changeOpenClawSetup(request, null, { thinking: "high", fast: true, utilityModel: "" });
    await changeOpenClawSetup(request, "main", { thinking: null, fast: null, utilityModel: null });
    expect(patches()).toEqual([
      {
        agents: { defaults: { thinkingDefault: "high", fastModeDefault: true, utilityModel: "" } },
      },
      {
        agents: {
          entries: { main: { thinkingDefault: null, fastModeDefault: null, utilityModel: null } },
        },
      },
    ]);
  });
});

describe("setOpenClawIdentity", () => {
  const identity = (listed: boolean) => (method: string) =>
    method === "config.get"
      ? {
          hash: "sha256:config",
          sourceConfig: { agents: { entries: listed ? { main: { name: "main" } } : {} } },
        }
      : method === "agents.files.get"
        ? {
            file: {
              content: `- Name: Rowan\n- Avatar: ${PICTURE}\n  _(workspace-relative path, http(s) URL, or data URI)_\n`,
              hash: "sha256:identity",
            },
          }
        : { ok: true };

  it("renames an agent and changes its picture through agents.update", async () => {
    const { request, calls } = fakeGateway(identity(true));
    await setOpenClawIdentity(request, "main", { name: "Robin" });
    await setOpenClawIdentity(request, "main", { avatar: PICTURE });
    expect(calls.filter((c) => c.method !== "config.get")).toEqual([
      { method: "agents.update", params: { agentId: "main", name: "Robin" } },
      { method: "agents.update", params: { agentId: "main", avatar: PICTURE } },
    ]);
  });

  it("lists a gateway's only agent first, which agents.update needs", async () => {
    const { request, calls, patches } = fakeGateway(identity(false));
    await setOpenClawIdentity(request, "main", { name: "Robin" });
    expect(patches()).toEqual([{ agents: { entries: { main: {} } } }]);
    expect(calls.at(-1)).toEqual({
      method: "agents.update",
      params: { agentId: "main", name: "Robin" },
    });
  });

  it("removes a picture from the config and from IDENTITY.md", async () => {
    const { request, calls, patches } = fakeGateway(identity(true));
    await setOpenClawIdentity(request, "main", { avatar: null });
    expect(patches()).toEqual([{ agents: { entries: { main: { identity: { avatar: null } } } } }]);
    expect(calls.at(-1)).toEqual({
      method: "agents.files.set",
      params: {
        agentId: "main",
        name: "IDENTITY.md",
        content:
          "- Name: Rowan\n- **Avatar:**\n  _(workspace-relative path, http(s) URL, or data URI)_\n",
        expectedHash: "sha256:identity",
      },
    });
  });
});

describe("changeOpenClaw", () => {
  it("sends a name or picture to the agent and the rest to the config", async () => {
    const { request, calls } = fakeGateway(answers);
    await changeOpenClaw(request, "main", { name: "Robin", thinking: "low" });
    expect(calls.map((c) => c.method)).toEqual([
      "config.get",
      "agents.update",
      "config.get",
      "config.patch",
    ]);
  });
});
