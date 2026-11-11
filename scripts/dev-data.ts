// What a dev run opens on, and getting it ready: the four kinds of data in
// packages/contracts/src/dev-data.ts, for the web app or the desktop app
// (docs/development.md#what-a-dev-run-opens-on). scripts/dev-runner.ts runs the processes.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { parseEnv } from "node:util";

import { otterHome, resolveDevHome } from "../apps/desktop/scripts/dev-home.mjs";
import {
  DEMO_AGENTS_ENV,
  DEMO_MAILBOXES_ENV,
  parseDemoMailboxes,
  type DemoMailbox,
} from "../packages/contracts/src/demo.ts";
import { DEV_DATA_ENV, type DevData } from "../packages/contracts/src/dev-data.ts";
import { startAgents, type Agent } from "./agents-server.ts";
import { repoRoot } from "./build-translator.ts";
import { login } from "./demo-login.ts";
import { imapServerMailbox, startImapServer } from "./imap-server.ts";
import { copyInstalledData, installedOAuthClients, installedStateDir } from "./installed-app.ts";

export type DevApp = "web" | "desktop";

export type DataOptions = {
  /** `--home`: the desktop app's data home, instead of this checkout's. */
  home?: string;
  /** `--reset`: start the desktop app's data over (a fresh copy, for real). */
  reset: boolean;
  /** `--login`: sign the demo mailboxes in first. */
  login: boolean;
  /** `--agents`: the local gateways a demo run starts and connects to. */
  agents: readonly Agent[];
  /** The checkout's port offset, which its gateways' ports follow. */
  portOffset: number;
};

/** The web demo's sign-ins come back to the relay's base port, the one its OAuth clients allow. */
const SIGN_IN_RELAY = "http://localhost:8787";

/**
 * Where the desktop app keeps `data`: a home of its own for each kind, so they never mix. The
 * empty one is the checkout's: `<worktree>/.otter`, or none in the main checkout, where the app
 * picks `~/.otter/dev` itself (apps/desktop/src/paths.ts). Never the installed app's.
 */
export function desktopDataHome(data: DevData, home: string | undefined): string | undefined {
  const devHome = resolveDevHome({ cwd: repoRoot, explicitHome: home });
  const dataHome = data === "empty" || home ? devHome : NodePath.join(devHome ?? otterHome(), data);
  if (
    dataHome &&
    NodePath.resolve(dataHome, "userdata") === NodePath.resolve(installedStateDir())
  ) {
    throw new Error(`${dataHome} is the installed app's own home. Pick another --home.`);
  }
  return dataHome;
}

export const desktopStateDir = (dataHome: string | undefined): string =>
  dataHome ? NodePath.join(dataHome, "userdata") : NodePath.join(otterHome(), "dev");

/** Gets `data` ready for `app`; returns what the run's processes need to know. */
export async function prepareData(
  app: DevApp,
  data: DevData,
  options: DataOptions,
): Promise<Record<string, string>> {
  if (app === "web") {
    if (data === "fake") return { VITE_DEMO: "1" };
    if (data === "demo") {
      return {
        [DEMO_MAILBOXES_ENV]: JSON.stringify(await demoMailboxes(app, options)),
        ...(await demoAgents(options)),
      };
    }
    return {};
  }

  const dataHome = desktopDataHome(data, options.home);
  const stateDir = desktopStateDir(dataHome);
  const env: Record<string, string> = {
    ...(dataHome ? { OTTER_HOME: dataHome } : {}),
    [DEV_DATA_ENV]: data,
  };
  if (data === "real") {
    if (options.reset || !NodeFS.existsSync(NodePath.join(stateDir, "mail-cache.db"))) {
      console.log(`[dev] Copying ${installedStateDir()} to ${stateDir} (--reset copies it again)`);
      copyInstalledData(stateDir);
    }
    console.warn(
      "[dev] Your real mail, signed in: read freely, but nothing lasting (sending, deleting, unsubscribing) unless you mean it.",
    );
    return { ...env, ...installedOAuthClients() };
  }
  if (options.reset) NodeFS.rmSync(stateDir, { recursive: true, force: true });
  if (data === "demo") {
    env[DEMO_MAILBOXES_ENV] = JSON.stringify(await demoMailboxes(app, options));
    Object.assign(env, await demoAgents(options));
  }
  return env;
}

/** The gateways `--agents` names (`pnpm agents-server`), started for the app to connect to. */
async function demoAgents(options: DataOptions): Promise<Record<string, string>> {
  if (options.agents.length === 0) return {};
  try {
    const agents = await startAgents(options.agents, options.portOffset);
    return { [DEMO_AGENTS_ENV]: JSON.stringify(agents) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[dev] Skipping the agents: ${message}`);
    return {};
  }
}

/**
 * Where the demo mailboxes' sign-ins are kept: the checkout's `.env.local`, or the main
 * checkout's (T3 worktrees share it).
 */
function envLocalPath(): string {
  const own = NodePath.join(repoRoot, ".env.local");
  if (NodeFS.existsSync(own)) return own;
  const common = NodeChildProcess.execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return NodePath.join(NodePath.dirname(common.trim()), ".env.local");
}

function googleClient(app: DevApp, env: Record<string, string | undefined>) {
  if (app === "desktop") {
    const id = process.env.OTTER_GOOGLE_CLIENT_ID ?? env.OTTER_GOOGLE_CLIENT_ID;
    const secret = process.env.OTTER_GOOGLE_CLIENT_SECRET ?? env.OTTER_GOOGLE_CLIENT_SECRET;
    if (!id || !secret) throw new Error(".env.local needs OTTER_GOOGLE_CLIENT_ID and _SECRET.");
    return { id, secret };
  }
  const relayDir = NodePath.join(repoRoot, "infra/relay");
  const id = /"GOOGLE_GMAIL_CLIENT_ID":\s*"([^"]+)"/.exec(
    NodeFS.readFileSync(NodePath.join(relayDir, "wrangler.jsonc"), "utf8"),
  )?.[1];
  const vars = NodePath.join(relayDir, ".dev.vars");
  const secret = NodeFS.existsSync(vars)
    ? parseEnv(NodeFS.readFileSync(vars, "utf8")).GOOGLE_GMAIL_CLIENT_SECRET
    : undefined;
  if (!id || !secret) throw new Error("infra/relay/.dev.vars needs GOOGLE_GMAIL_CLIENT_SECRET.");
  return { id, secret, redirectUri: `${SIGN_IN_RELAY}/v1/gmail/callback` };
}

function microsoftClient(app: DevApp, env: Record<string, string | undefined>) {
  if (app === "desktop") {
    const id = process.env.OTTER_MICROSOFT_CLIENT_ID ?? env.OTTER_MICROSOFT_CLIENT_ID;
    if (!id) throw new Error(".env.local needs OTTER_MICROSOFT_CLIENT_ID.");
    return { id };
  }
  const relayDir = NodePath.join(repoRoot, "infra/relay");
  const vars = NodePath.join(relayDir, ".dev.vars");
  const devVars = NodeFS.existsSync(vars) ? parseEnv(NodeFS.readFileSync(vars, "utf8")) : {};
  const id =
    devVars.MICROSOFT_CLIENT_ID ||
    /"MICROSOFT_CLIENT_ID":\s*"([^"]+)"/.exec(
      NodeFS.readFileSync(NodePath.join(relayDir, "wrangler.jsonc"), "utf8"),
    )?.[1];
  const secret = devVars.MICROSOFT_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error("infra/relay/.dev.vars needs MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.");
  }
  return { id, secret, redirectUri: `${SIGN_IN_RELAY}/v1/outlook/callback` };
}

/** .env.local's demo mailboxes, signed in with `--login`, and the local IMAP server's. */
async function demoMailboxes(app: DevApp, options: DataOptions): Promise<DemoMailbox[]> {
  const file = envLocalPath();
  const env = NodeFS.existsSync(file) ? parseEnv(NodeFS.readFileSync(file, "utf8")) : {};
  const json = process.env[DEMO_MAILBOXES_ENV] ?? env[DEMO_MAILBOXES_ENV];
  let mailboxes = json ? parseDemoMailboxes(json) : [];
  const command = app === "desktop" ? "dev:desktop:demo" : "dev:demo";
  if (options.login) {
    mailboxes = await login(file, mailboxes, app, {
      google: () => googleClient(app, env),
      microsoft: () => microsoftClient(app, env),
    });
  }
  if (!json) console.warn(`[dev] ${file} has no ${DEMO_MAILBOXES_ENV} (docs/development.md).`);
  for (const mailbox of mailboxes) {
    if (mailbox.provider !== "imap" && !mailbox.refreshTokens[app]) {
      console.warn(`[dev] ${mailbox.email} isn't signed in yet: run \`pnpm ${command} --login\`.`);
    }
  }
  try {
    await startImapServer();
    mailboxes.push(imapServerMailbox);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[dev] Skipping the local IMAP mailbox (is Docker running?): ${message}`);
  }
  return mailboxes;
}
