import * as Sentry from "@sentry/electron/utility";

import { DEMO_MAILBOXES_ENV } from "@otter-mail/contracts/demo";
import {
  addDemoMailboxes,
  callHandler,
  onSettingsChanged,
  registeredHandlers,
  shutdownProviders,
  startCore,
} from "@otter-mail/core";
import { errorReportOptions, reportLog, SENTRY_DSN } from "@otter-mail/shared/error-reports";

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
  const platform = desktopPlatform();
  await startCore(platform, desktopExtensions);
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
  postToMain({ type: "ready", channels: [...registeredHandlers().keys()] });
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
    // Codex app-servers are child processes; don't leave them behind.
    shutdownProviders();
    process.exit(0);
  }
});
