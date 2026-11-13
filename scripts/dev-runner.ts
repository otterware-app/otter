#!/usr/bin/env node
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import { parseArgs, parseEnv } from "node:util";

import type { DevData } from "../packages/contracts/src/dev-data.ts";
import { localConfig } from "../infra/relay/scripts/local-config.ts";
import { buildTranslator, findTranslatorBinary, repoRoot } from "./build-translator.ts";
import { desktopDataHome, desktopStateDir, prepareData, type DevApp } from "./dev-data.ts";
import { parseAgents, stopAgents } from "./agents-server.ts";
import { imapServerCa } from "./imap-server.ts";
import { BASE_RELAY_PORT, BASE_WEB_PORT, resolvePortOffset } from "./port-offset.ts";

const SHUTDOWN_GRACE_MS = 3_000;

/** Each command is an app and what it opens on (scripts/dev-data.ts). */
const MODES = {
  dev: { app: "web", data: "empty" },
  "dev:fake": { app: "web", data: "fake" },
  "dev:demo": { app: "web", data: "demo" },
  "dev:desktop": { app: "desktop", data: "empty" },
  "dev:desktop:fake": { app: "desktop", data: "fake" },
  "dev:desktop:demo": { app: "desktop", data: "demo" },
  "dev:desktop:real": { app: "desktop", data: "real" },
} as const satisfies Record<string, { app: DevApp; data: DevData }>;
type Mode = keyof typeof MODES;

const HELP = `Usage: pnpm dev[:desktop][:fake|:demo|:real] [options]

  pnpm dev                The web app (apps/web) and a local relay (infra/relay) to sign in
                          through. Open the printed URL in a browser.
  pnpm dev:desktop        The desktop app: the web dev server, \`vp pack --watch\`
                          (apps/desktop) and Electron against them.

  What they open on (docs/development.md#what-a-dev-run-opens-on):
    (nothing)  An empty sandbox: add what you need.
    :fake      Made-up mailboxes from pretend services: no accounts, no network.
    :demo      The demo accounts in .env.local, signed in, and the local IMAP
               server's (\`pnpm imap-server\`, started for it).
    :real      Desktop only: a copy of your installed app, signed in to your own
               mail, calendars and agents, but not your Otter account. Only when
               asked; nothing lasting without your say.

Ctrl-C stops everything.

Options:
  --home <dir>    The desktop app's data home. Default: one per kind in this
                  checkout's .otter (the main checkout's: ~/.otter/dev for the empty
                  one, ~/.otter/<kind> for the rest), never the installed app's.
  --reset         Desktop: start its data over (for :real, a fresh copy).
  --login         :demo: sign the demo Gmail mailboxes in to Google (Outlook ones to
                  Microsoft) first, once per machine, saving the sign-ins in .env.local.
  --agents <list> :demo: start local agent gateways and connect the app to them:
                  openclaw, hermes or both (\`pnpm agents-server\`). They run the Otter
                  plugins from this checkout and stop with the run.
  --dry-run       Print the resolved ports and commands, then exit.
  -h, --help      Show this help.

Environment:
  OTTER_HOME              Data home, same as --home.
  OTTER_REMOTE_DEBUGGING_PORT
                          Chrome DevTools port of the dev app (default: dev server
                          port + 1000; 0 turns it off). Playwright and agents attach
                          here with connectOverCDP.
  PORT                    Exact dev server port.
  OTTER_PORT_OFFSET       Offset added to ${BASE_WEB_PORT} and the relay's ${BASE_RELAY_PORT}
                          (default: hashed from the worktree path in linked
                          worktrees, 0 otherwise). Google sign-in through the
                          local relay only works on ${BASE_RELAY_PORT}.
`;

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = NodeNet.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(start: number): Promise<number> {
  for (let port = start; port < Math.min(start + 100, 65536); port += 1) {
    if (await portIsFree(port)) return port;
  }
  throw new Error(`No free dev server port between ${start} and ${start + 99}.`);
}

function ensureTranslator(): void {
  if (findTranslatorBinary()) return;
  console.log("[dev] Building native/translator (first run only)...");
  try {
    console.log(`[dev] Translator ready: ${buildTranslator({ quiet: true })}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[dev] Skipping the translator; in-app translation will be unavailable.\n${message}`,
    );
  }
}

function prepareRelay(wrangler: string): void {
  const relayDir = NodePath.join(repoRoot, "infra/relay");
  const varsFile = NodePath.join(relayDir, ".dev.vars");
  const vars = NodeFS.existsSync(varsFile) ? parseEnv(NodeFS.readFileSync(varsFile, "utf8")) : {};
  // Without them the relay starts, then fails every sign-in with a bare 500.
  const missing = ["BETTER_AUTH_SECRET", "GOOGLE_GMAIL_CLIENT_SECRET"].filter(
    (name) => !vars[name],
  );
  if (missing.length > 0) {
    throw new Error(
      `infra/relay/.dev.vars needs ${missing.join(" and ")} (see docs/development.md#the-web-app).`,
    );
  }
  const migrate = NodeChildProcess.spawnSync(
    wrangler,
    ["d1", "migrations", "apply", "otter-mail-relay", "--local"],
    { cwd: relayDir, env: { ...process.env, CI: "1" }, encoding: "utf8" },
  );
  if (migrate.status !== 0) {
    throw new Error(`Couldn't migrate the relay's local database:\n${migrate.stderr}`);
  }
}

const COLORS = ["\u001b[36m", "\u001b[35m", "\u001b[33m"];
const RESET = "\u001b[0m";

interface Task {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      home: { type: "string" },
      login: { type: "boolean", default: false },
      agents: { type: "string" },
      reset: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(HELP);
    return;
  }
  const mode = (positionals[0] ?? "dev") as Mode;
  if (!(mode in MODES)) throw new Error(`Unknown mode "${mode}".\n\n${HELP}`);
  const { app, data } = MODES[mode];
  const desktop = app === "desktop";
  const agents = values.agents ? parseAgents(values.agents) : [];
  if (agents.length > 0 && data !== "demo") throw new Error("--agents goes with a :demo run.");
  // The web app signs in through a relay; the made-up mailbox needs none.
  const relay = app === "web" && data !== "fake";

  const { offset, source } = resolvePortOffset(process.env, repoRoot);
  const explicitPort = process.env.PORT?.trim();
  let port: number;
  let portSource: string;
  if (explicitPort) {
    port = Number(explicitPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new Error(`PORT must be a valid port number; received "${explicitPort}".`);
    }
    portSource = `PORT=${port}`;
  } else {
    const preferred = BASE_WEB_PORT + offset;
    port = values["dry-run"] ? preferred : await findFreePort(preferred);
    portSource = port === preferred ? source : `${source}; ${preferred} was busy`;
  }
  const devServerUrl = `http://localhost:${port}`;
  // The relay's origin is baked into the web app's sign-in and its CORS, so it
  // doesn't move to a free port: a busy one fails loudly instead.
  const relayPort = BASE_RELAY_PORT + offset;
  const relayUrl = `http://localhost:${relayPort}`;

  const vp = NodePath.join(repoRoot, "node_modules", ".bin", "vp");
  const wrangler = NodePath.join(repoRoot, "infra/relay/node_modules/.bin/wrangler");
  // Beside wrangler.jsonc, so Wrangler still finds the relay's .dev.vars.
  const relayConfig = NodePath.join(repoRoot, "infra/relay/.wrangler.local.jsonc");
  const tasks: Task[] = [
    { name: "web", command: vp, args: ["dev"], cwd: NodePath.join(repoRoot, "apps/web") },
  ];
  if (relay) {
    tasks.push({
      name: "relay",
      command: wrangler,
      args: [
        "dev",
        "--config",
        relayConfig,
        "--port",
        String(relayPort),
        "--local-upstream",
        `localhost:${relayPort}`,
        "--var",
        `BETTER_AUTH_URL:${relayUrl}`,
        "--var",
        `APP_ORIGIN:${devServerUrl}`,
        "--var",
        "COOKIE_DOMAIN:",
        "--var",
        "TUNNEL_ALLOW_PRIVATE:true",
        ...(data === "demo" ? ["--var", "DEV_DEMO:true"] : []),
      ],
      cwd: NodePath.join(repoRoot, "infra/relay"),
    });
  }
  if (desktop) {
    tasks.push(
      {
        name: "pack",
        command: vp,
        args: ["pack", "--watch"],
        cwd: NodePath.join(repoRoot, "apps/desktop"),
      },
      {
        name: "electron",
        command: process.execPath,
        args: ["scripts/dev-electron.mjs"],
        cwd: NodePath.join(repoRoot, "apps/desktop"),
      },
    );
  }

  const dataHome = desktop ? desktopDataHome(data, values.home) : undefined;
  const configuredDebugPort = process.env.OTTER_REMOTE_DEBUGGING_PORT?.trim();
  const debugPort = !desktop
    ? 0
    : configuredDebugPort !== undefined && configuredDebugPort !== ""
      ? Number(configuredDebugPort)
      : values["dry-run"]
        ? port + 1000
        : await findFreePort(port + 1000);
  console.log(`[dev] ${devServerUrl} (${portSource})`);
  if (app === "web" && data === "fake") {
    console.log("[dev] Made-up mailbox (?reset-demo starts it over)");
  }
  if (relay) console.log(`[dev] Relay: ${relayUrl}`);
  if (desktop) console.log(`[dev] Data (${data}): ${desktopStateDir(dataHome)}`);
  if (debugPort > 0) console.log(`[dev] DevTools: http://127.0.0.1:${debugPort}`);
  if (values["dry-run"]) {
    for (const task of tasks) {
      console.log(
        `[dev] ${task.name}: (cd ${task.cwd} && ${[task.command, ...task.args].join(" ")})`,
      );
    }
    return;
  }
  if (!NodeFS.existsSync(vp)) throw new Error("vite-plus is not installed. Run `pnpm install`.");

  stopLeftoverGroups();
  if (relay) {
    NodeFS.writeFileSync(relayConfig, localConfig());
    prepareRelay(wrangler);
  }
  // The gateways start before the tasks whose shutdown stops them.
  const stopStartingAgents = () => {
    stopAgents(offset);
    process.exit(130);
  };
  if (agents.length > 0) process.once("SIGINT", stopStartingAgents);
  const dataEnv = await prepareData(app, data, {
    home: values.home,
    reset: values.reset,
    login: values.login,
    agents,
    portOffset: offset,
  });
  if (desktop) {
    ensureTranslator();
    // A stale bundle would let Electron start before the first fresh build.
    NodeFS.rmSync(NodePath.join(repoRoot, "apps/desktop/dist-electron"), {
      recursive: true,
      force: true,
    });
  }

  const trustImapServer = data !== "fake" && NodeFS.existsSync(imapServerCa);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Only the data's own home: an inherited one could be the installed app's.
    OTTER_HOME: undefined,
    OTTER_MAIL_HOME: undefined,
    ...dataEnv,
    OTTER_REMOTE_DEBUGGING_PORT: String(debugPort),
    PORT: String(port),
    VITE_DEV_SERVER_URL: devServerUrl,
    ...(relay ? { VITE_RELAY_URL: relayUrl } : {}),
    ...(trustImapServer
      ? {
          VITE_DEV_MAIL_CA: NodeFS.readFileSync(imapServerCa, "utf8"),
          NODE_EXTRA_CA_CERTS: imapServerCa,
        }
      : {}),
    FORCE_COLOR: process.env.FORCE_COLOR ?? (process.stdout.isTTY ? "1" : "0"),
  };

  const children = new Map<string, NodeChildProcess.ChildProcess>();
  let shuttingDown = false;

  const shutdown = async (exitCode: number): Promise<never> => {
    if (!shuttingDown) {
      shuttingDown = true;
      const running = [...children.values()].filter((child) => child.exitCode === null);
      const exited = running.map(
        (child) => new Promise<void>((resolve) => child.once("exit", () => resolve())),
      );
      for (const child of running) signalGroup(child, "SIGTERM");
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
      await Promise.race([Promise.all(exited), timeout]);
      for (const child of children.values()) signalGroup(child, "SIGKILL");
      if (agents.length > 0) stopAgents(offset);
    }
    process.exit(exitCode);
  };

  tasks.forEach((task, index) => {
    const prefix = `${COLORS[index % COLORS.length]}[${task.name}]${RESET} `;
    // Detached: each task gets its own process group, so the terminal's Ctrl-C
    // reaches only this runner, which then stops every group in order.
    const child = NodeChildProcess.spawn(task.command, task.args, {
      cwd: task.cwd,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.set(task.name, child);
    for (const stream of [child.stdout, child.stderr]) {
      const target = stream === child.stderr ? process.stderr : process.stdout;
      NodeReadline.createInterface({ input: stream }).on("line", (line) => {
        target.write(`${prefix}${line}\n`);
      });
    }
    child.once("error", (error) => {
      console.error(`${prefix}failed to start: ${error.message}`);
      void shutdown(1);
    });
    child.once("exit", (code, signal) => {
      if (shuttingDown) return;
      console.error(`${prefix}exited (${signal ?? code}); stopping dev.`);
      void shutdown(code ?? 1);
    });
  });

  recordGroups([...children.values()].flatMap((child) => (child.pid ? [child.pid] : [])));

  process.off("SIGINT", stopStartingAgents);
  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
  process.once("SIGHUP", () => void shutdown(129));
}

// A runner killed outright (SIGKILL, a closed terminal tab) can't stop its
// detached task groups; the next run finds them in its file and stops them,
// so the dev server port is free again. One file per runner (named by its
// pid), so runs side by side (\`pnpm dev\` next to \`pnpm dev:desktop\`) leave
// each other alone.
const groupsDir = NodePath.join(repoRoot, "apps/desktop/.electron-runtime/dev-groups");

function recordGroups(pids: number[]): void {
  NodeFS.mkdirSync(groupsDir, { recursive: true });
  NodeFS.writeFileSync(NodePath.join(groupsDir, `${process.pid}.json`), JSON.stringify(pids));
  process.once("exit", () =>
    NodeFS.rmSync(NodePath.join(groupsDir, `${process.pid}.json`), { force: true }),
  );
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopLeftoverGroups(): void {
  let files: string[] = [];
  try {
    files = NodeFS.readdirSync(groupsDir);
  } catch {
    return;
  }
  for (const file of files) {
    const runner = Number.parseInt(file, 10);
    if (isAlive(runner)) continue;
    const path = NodePath.join(groupsDir, file);
    let pids: number[] = [];
    try {
      pids = JSON.parse(NodeFS.readFileSync(path, "utf8")) as number[];
    } catch {
      // Unreadable: drop it below.
    }
    for (const pid of pids) {
      const command = NodeChildProcess.spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
        encoding: "utf8",
      }).stdout;
      if (!/vite-plus|dev-electron\.mjs|wrangler/.test(command)) continue;
      console.log(`[dev] Stopping leftovers from an earlier run (pid ${pid})`);
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
    NodeFS.rmSync(path, { force: true });
  }
}

/** Signals the task's whole process group, so grandchildren (esbuild, Electron) go too. */
function signalGroup(child: NodeChildProcess.ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(`[dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
