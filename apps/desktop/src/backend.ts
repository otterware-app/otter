import * as Sentry from "@sentry/electron/utility";

import { DEMO_AGENTS_ENV, DEMO_MAILBOXES_ENV } from "@otter/contracts/demo";
import { devDataFrom } from "@otter/contracts/dev-data";
import {
  addDemoAgents,
  addDemoMailboxes,
  callHandler,
  onSettingsChanged,
  registeredHandlers,
  shutdownProviders,
  startCore,
} from "@otter/core";
import { errorReportOptions, reportLog, SENTRY_DSN } from "@otter/shared/error-reports";

import { appInfo, type ToBackend } from "./backend-protocol.js";
import { desktopExtensions } from "./extensions.js";
import { registerBackendHandlers } from "./handlers/backend.js";
import { logger, reportLogsTo, sendLogsTo } from "./logger.js";
import { postToMain, settleRequest, tellMain } from "./main-link.js";
import { desktopPlatform, resumeListeners } from "./platform.js";
import { serverUrl } from "./services/agent/mcp-server.js";

sendLogsTo((level, scope, message, data) => tellMain({ kind: "log", level, scope, message, data }));

if (appInfo().errorReports) {
  Sentry.init({
    ...errorReportOptions({ dsn: SENTRY_DSN.desktop, version: appInfo().version, environment: "" }),
    integrations: (defaults) =>
      defaults.filter(({ name }) => name !== "Console" && name !== "LocalVariables"),
  });
  reportLogsTo(reportLog);
}

async function start(): Promise<void> {
  await startCore(await platform(), desktopExtensions);
  registerBackendHandlers();
  serverUrl().catch((error: unknown) =>
    logger.error("backend", "MCP server failed to start", error),
  );
  onSettingsChanged((settings, patch) => tellMain({ kind: "settings", settings, patch }));
  const demo = process.env[DEMO_MAILBOXES_ENV];
  if (demo && !appInfo().packaged) {
    await addDemoMailboxes(demo).catch((error: unknown) =>
      logger.error("backend", "Couldn't add the demo mailboxes", error),
    );
  }
  const agents = process.env[DEMO_AGENTS_ENV];
  if (agents && !appInfo().packaged) {
    void addDemoAgents(agents).catch((error: unknown) =>
      logger.error("backend", "Couldn't connect the demo agents", error),
    );
  }
  postToMain({ type: "ready", channels: [...registeredHandlers().keys()] });
}

/** `pnpm dev:desktop:fake` signs in to made-up services instead of Google's and Microsoft's. */
async function platform() {
  if (appInfo().packaged || devDataFrom(process.env) !== "fake") return desktopPlatform();
  const { withFakeServices } = await import("@otter/core/fake");
  return withFakeServices(desktopPlatform());
}

async function invoke(id: number, channel: string, params: unknown): Promise<void> {
  postToMain({ type: "result", id, ...(await callHandler(channel, params)) });
}

const ready = start();
ready.catch(async (err: unknown) => {
  logger.error("backend", "Core failed to start", err);
  await Sentry.flush(2_000);
  process.exit(1);
});

process.parentPort.on("message", (event) => {
  const message = event.data as ToBackend;
  if (message.type === "invoke") {
    void ready.then(() => invoke(message.id, message.channel, message.params));
  } else if (message.type === "reply") {
    settleRequest(message.id, message.result, message.error);
  } else if (message.type === "resume") {
    for (const listener of resumeListeners) listener();
  } else if (message.type === "shutdown") {
    shutdownProviders();
    process.exit(0);
  }
});
