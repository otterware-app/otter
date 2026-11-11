#!/usr/bin/env node
// Real OpenClaw and Hermes gateways for development, a pair per checkout, running the Otter
// plugins from this checkout's extensions/ (docs/development.md#agent-gateways).

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { otterHome } from "../apps/desktop/scripts/dev-home.mjs";
import type { DemoAgents } from "../packages/contracts/src/demo.ts";
import { resolvePortOffset } from "./port-offset.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

export const AGENTS = ["openclaw", "hermes"] as const;
export type Agent = (typeof AGENTS)[number];

const MODEL = "gpt-6.1-sol";

/**
 * The gateways' key, made once for this computer: a web page can reach a port on localhost,
 * so a key written in this repository would let any page run them.
 */
function gatewayKey(): string {
  const file = NodePath.join(otterHome(), "dev-agents-key");
  try {
    return NodeFS.readFileSync(file, "utf8").trim();
  } catch {
    const key = NodeCrypto.randomBytes(24).toString("hex");
    NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
    NodeFS.writeFileSync(file, key, { mode: 0o600 });
    return key;
  }
}

// Clear of the dev runner's ports, whose offsets reach 3000 above 5833 and 8787.
const OPENCLAW_PORT = 41000;
const HERMES_PORT = 45000;

function compose(offset: number, args: string[]) {
  return {
    args: [
      "compose",
      "-p",
      offset ? `otter-agents-${offset}` : "otter-agents",
      "-f",
      NodePath.join(repoRoot, "scripts/agents-server/compose.yaml"),
      ...args,
    ],
    env: {
      ...process.env,
      OTTER_DEV_OPENCLAW_PORT: String(OPENCLAW_PORT + offset),
      OTTER_DEV_HERMES_PORT: String(HERMES_PORT + offset),
    },
  };
}

function docker(offset: number, command: string[], input?: string): string {
  const { args, env } = compose(offset, command);
  return NodeChildProcess.execFileSync("docker", args, {
    input,
    encoding: "utf8",
    env,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"],
  });
}

type CodexLogin = {
  auth_mode?: string;
  last_refresh?: string;
  tokens: { access_token: string; id_token?: string; account_id?: string; refresh_token: "" };
};

/**
 * This computer's Codex sign-in, without its refresh token. The gateways run on the access
 * token alone, so Codex here stays the only one that renews the sign-in: a second holder of a
 * refresh token would rotate it and sign the other out.
 */
function codexLogin(): CodexLogin {
  const home = process.env.CODEX_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".codex");
  let login: Partial<CodexLogin>;
  let expires: number;
  try {
    login = JSON.parse(NodeFS.readFileSync(NodePath.join(home, "auth.json"), "utf8"));
    const claims = Buffer.from(login.tokens!.access_token.split(".")[1]!, "base64url");
    expires = (JSON.parse(claims.toString()) as { exp: number }).exp * 1000;
  } catch {
    throw new Error("the gateways run on your Codex sign-in: run `codex login` first.");
  }
  if (!(expires > Date.now() + 60_000)) {
    throw new Error("your Codex sign-in has run out: start `codex` once to renew it.");
  }
  const { access_token, id_token, account_id } = login.tokens!;
  return {
    auth_mode: login.auth_mode,
    last_refresh: login.last_refresh,
    tokens: { access_token, id_token, account_id, refresh_token: "" },
  };
}

const SETUP: Record<Agent, (login: CodexLogin, key: string) => { script: string; input: string }> =
  {
    openclaw: (login, key) => ({
      script: `set -e
cd /app
if [ ! -f ~/.openclaw/.otter-dev ]; then
  node openclaw.mjs onboard --non-interactive --accept-risk --skip-health --mode local \\
    --auth-choice skip --gateway-auth token --gateway-token ${key} \\
    --gateway-bind loopback --skip-channels --no-install-daemon
  node openclaw.mjs config set plugins.entries.codex.enabled true
  node openclaw.mjs config set plugins.entries.codex.config.appServer.homeScope user
  node openclaw.mjs config set agents.defaults.model.primary openai/${MODEL}
  node openclaw.mjs plugins install /otter-plugin --link --force --accept-capabilities
  node openclaw.mjs config set plugins.entries.otter.hooks.allowConversationAccess true
  touch ~/.openclaw/.otter-dev
fi
umask 077
mkdir -p "$CODEX_HOME"
cat > "$CODEX_HOME/auth.json"`,
      input: JSON.stringify(login),
    }),
    hermes: (login, key) => ({
      script: `set -e
if [ ! -f /opt/data/.otter-dev ]; then
  hermes config set model.provider openai-codex
  hermes config set model.default ${MODEL}
  hermes config set API_SERVER_KEY ${key}
  hermes plugins enable otter
  touch /opt/data/.otter-dev
fi
umask 077
cat > /opt/data/auth.json`,
      input: JSON.stringify({
        version: 1,
        providers: {
          "openai-codex": {
            tokens: { access_token: login.tokens.access_token, refresh_token: "" },
            last_refresh: login.last_refresh,
            auth_mode: "chatgpt",
          },
        },
        active_provider: "openai-codex",
      }),
    }),
  };

const SERVICES: Record<Agent, string[]> = {
  openclaw: ["openclaw", "openclaw-loopback"],
  hermes: ["hermes"],
};

async function waitFor(name: string, url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    const up = await fetch(url, { signal: AbortSignal.timeout(2_000) }).then(
      (response) => response.ok,
      () => false,
    );
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${name} didn't start.`);
}

/**
 * Starts `agents` for the checkout at this port `offset`, restarting the ones already up so
 * they load the plugins as they are now. Returns where the app finds them.
 */
export async function startAgents(agents: readonly Agent[], offset: number): Promise<DemoAgents> {
  const login = codexLogin();
  const key = gatewayKey();
  for (const agent of agents) {
    const { script, input } = SETUP[agent](login, key);
    // OpenClaw's image starts its commands through an entrypoint of its own; Hermes's sets up
    // its data and user first.
    const shell = agent === "openclaw" ? ["--entrypoint", "sh", agent, "-c"] : [agent, "sh", "-c"];
    console.log(`[agents] Starting ${agent} (its first start sets it up: a minute or two)`);
    docker(offset, ["run", "--rm", "-T", "--no-deps", ...shell, script], input);
  }
  docker(offset, ["up", "-d", "--force-recreate", ...agents.flatMap((agent) => SERVICES[agent])]);
  const openclaw = `localhost:${OPENCLAW_PORT + offset}`;
  const hermes = `http://localhost:${HERMES_PORT + offset}`;
  await Promise.all([
    agents.includes("openclaw") && waitFor("OpenClaw", `http://${openclaw}/readyz`),
    agents.includes("hermes") && waitFor("Hermes", `${hermes}/health`),
  ]);
  return {
    ...(agents.includes("openclaw") ? { openclaw: { url: `ws://${openclaw}`, token: key } } : {}),
    ...(agents.includes("hermes") ? { hermes: { baseUrl: hermes, apiKey: key } } : {}),
  };
}

/** Stops the checkout's gateways without waiting; their data stays for the next start. */
export function stopAgents(offset: number): void {
  const { args, env } = compose(offset, ["stop", "--timeout", "2"]);
  NodeChildProcess.spawn("docker", args, { env, detached: true, stdio: "ignore" }).unref();
}

/**
 * Approves the devices waiting to pair with the checkout's OpenClaw. The desktop app pairs by
 * itself; the gateway never does that for a browser, so the web app waits for this once.
 */
function approveDevices(offset: number): number {
  const openclaw = (...args: string[]) =>
    docker(offset, ["exec", "-T", "openclaw", "node", "openclaw.mjs", "devices", ...args]);
  const list = openclaw("list", "--json");
  const { pending } = JSON.parse(list.slice(list.indexOf("{"))) as {
    pending: { requestId: string }[];
  };
  for (const { requestId } of pending) openclaw("approve", requestId);
  return pending.length;
}

export function parseAgents(list: string): Agent[] {
  const names = list.split(",").map((name) => name.trim());
  const unknown = names.find((name) => !AGENTS.includes(name as Agent));
  if (unknown !== undefined) {
    throw new Error(`Unknown agent "${unknown}": ${AGENTS.join(" or ")}.`);
  }
  return [...new Set(names)] as Agent[];
}

async function main(): Promise<void> {
  const { offset } = resolvePortOffset(process.env, repoRoot);
  const [command, ...rest] = process.argv.slice(2);
  if (command === "down") {
    docker(offset, ["down", ...rest]);
    return;
  }
  if (command === "approve") {
    const approved = approveDevices(offset);
    console.log(approved ? `Approved ${approved}.` : "No device is waiting to pair.");
    return;
  }
  const agents = command ? parseAgents([command, ...rest].join(",")) : [...AGENTS];
  const started = await startAgents(agents, offset);
  console.log(`Up, on your Codex sign-in, with the Otter plugins from this checkout's extensions/.
Connect to them in Settings → Agents:
${[
  started.openclaw && `  OpenClaw  ${started.openclaw.url}, token ${started.openclaw.token}`,
  started.hermes && `  Hermes    ${started.hermes.baseUrl}, API key ${started.hermes.apiKey}`,
]
  .filter(Boolean)
  .join("\n")}

The web app's first connection to OpenClaw waits for \`pnpm agents-server approve\`.
Run it again after changing a plugin. Stop them with \`pnpm agents-server down\`
(\`down --volumes\` also forgets their chats and settings).`);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[agents] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
