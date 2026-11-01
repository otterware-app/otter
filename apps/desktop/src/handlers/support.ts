import { app, ipcMain, shell } from "electron";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProvidersState } from "@otter-mail/core";
import {
  buildSupportPrompt,
  MAX_SUPPORT_BODY,
  type SupportAgent,
  type SupportDiagnostics,
  type SupportSession,
} from "@otter-mail/shared/support";
import { invokeBackend } from "../backend-host.js";
import { hostOS } from "../os/index.js";
import { ensureShellPath } from "../services/agent/shell-path.js";
import { buildSupportLauncher, supportBinary } from "../services/support-launcher.js";
import {
  getSupportTerminals,
  openSupportTerminal,
  setSupportTerminal,
} from "../services/support-terminal.js";
import {
  forgetSupportSession,
  readSupportDraft,
  rememberSupportSession,
  resumeSupportSession,
  supportDirectory,
  validSupportReport,
} from "../services/support-session.js";

let reportRequested = false;

/** A Help-menu request survives creating a new main window. */
export function requestSupportReport(): void {
  reportRequested = true;
}

async function launchAgents() {
  const [, state] = await Promise.all([
    ensureShellPath(),
    invokeBackend("agent:providers") as Promise<ProvidersState>,
  ]);
  const agents = await Promise.all(
    (["claude", "codex"] as const).map(async (id) => {
      const agent = state.providers.find((p) => p.kind === id);
      if (!agent) return null;
      const settings = agent.settings as typeof agent.settings & {
        binaryPath: string;
        homePath: string;
      };
      const binary = await supportBinary(settings.binaryPath, id);
      return binary
        ? {
            id,
            label: id === "claude" ? "Claude Code" : "Codex",
            binary,
            homePath: settings.homePath,
            model: settings.model,
          }
        : null;
    }),
  );
  return agents.filter((agent) => agent !== null);
}

export function registerSupportHandlers(): void {
  ipcMain.handle("support:terminals", () =>
    getSupportTerminals(app.getPath("userData"), hostOS.terminals),
  );
  ipcMain.handle("support:setTerminal", (_event, params: unknown) =>
    setSupportTerminal(
      app.getPath("userData"),
      hostOS.terminals,
      (params as { id?: unknown } | undefined)?.id,
    ),
  );
  ipcMain.handle("support:resumeSession", () => resumeSupportSession(app.getPath("userData")));
  ipcMain.handle("support:readDraft", (_event, params: unknown) =>
    readSupportDraft(app.getPath("userData"), (params as { id?: unknown } | undefined)?.id),
  );
  ipcMain.handle("support:forgetSession", (_event, params: unknown) =>
    forgetSupportSession(app.getPath("userData"), (params as { id?: unknown } | undefined)?.id),
  );
  ipcMain.handle("support:showFiles", async (_event, params: unknown) => {
    const id = (params as { id?: unknown } | undefined)?.id;
    const session = await resumeSupportSession(app.getPath("userData"));
    if (!session || session.id !== id) throw new Error("Invalid support session.");
    shell.showItemInFolder(path.join(supportDirectory(app.getPath("userData"), id), "report.md"));
  });
  ipcMain.handle("support:takeRequested", async () => {
    const requested = reportRequested;
    reportRequested = false;
    return requested;
  });
  ipcMain.handle("support:agents", async (): Promise<SupportAgent[]> =>
    (await launchAgents()).map(({ id, label }) => ({ id, label })),
  );

  ipcMain.handle("support:launchAgent", async (_event, params: unknown) => {
    const p = params as
      | {
          agent?: unknown;
          report?: unknown;
          body?: unknown;
          diagnostics?: SupportDiagnostics | null;
          screenshot?: { mime?: unknown; bytes?: unknown };
        }
      | undefined;
    if (
      (p?.agent !== "claude" && p?.agent !== "codex") ||
      !validSupportReport(p.report) ||
      typeof p.body !== "string" ||
      !p.body.trim() ||
      p.body.length > MAX_SUPPORT_BODY
    )
      throw new Error("Invalid support session.");
    const agent = (await launchAgents()).find((item) => item.id === p.agent);
    if (!agent)
      throw new Error(
        "This agent is no longer available. Download the report or check its path in Settings → Agents.",
      );
    let screenshot: { bytes: Uint8Array; extension: string } | null = null;
    if (p.screenshot) {
      const { bytes, mime } = p.screenshot;
      if (!(bytes instanceof Uint8Array) || bytes.length > 5 * 1024 * 1024 || bytes.length < 12)
        throw new Error("Choose a PNG, JPEG, or WebP screenshot under 5 MB.");
      const png =
        mime === "image/png" &&
        Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpeg =
        mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      const webp =
        mime === "image/webp" &&
        Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" &&
        Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP";
      if (!png && !jpeg && !webp) throw new Error("Choose a PNG, JPEG, or WebP screenshot.");
      screenshot = { bytes, extension: png ? "png" : jpeg ? "jpg" : "webp" };
    }
    const diagnostics = p.diagnostics ? JSON.stringify(p.diagnostics, null, 2) : null;
    if (diagnostics && diagnostics.length > MAX_SUPPORT_BODY)
      throw new Error("The diagnostics file is too large.");
    const id = randomUUID();
    const directory = supportDirectory(app.getPath("userData"), id);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    let prompt = buildSupportPrompt(`# ${p.report.title}\n\n${p.body}`, true, p.report);
    if (diagnostics) {
      await fs.writeFile(path.join(directory, "Otter Mail diagnostics.json"), diagnostics, {
        mode: 0o600,
      });
      prompt +=
        "\nThe user included diagnostics in ./Otter Mail diagnostics.json. Read that file as evidence.\n";
    }
    if (screenshot) {
      const filename = `screenshot.${screenshot.extension}`;
      await fs.writeFile(path.join(directory, filename), screenshot.bytes, { mode: 0o600 });
      prompt += `\nThe user explicitly attached ./${filename}. Inspect it as evidence.\n`;
    }
    await fs.writeFile(path.join(directory, "prompt.md"), prompt, { mode: 0o600 });
    await fs.writeFile(path.join(directory, "report.md"), p.body, { mode: 0o600 });
    const launcher = path.join(directory, hostOS.terminals.launcher.fileName);
    await fs.writeFile(
      launcher,
      buildSupportLauncher({
        ...agent,
        agent: agent.id,
        directory,
        searchPath: process.env.PATH ?? "/usr/bin:/bin",
        shebang: hostOS.terminals.launcher.shebang,
      }),
      { mode: 0o700 },
    );
    await openSupportTerminal(app.getPath("userData"), hostOS.terminals, launcher).catch(() => {
      throw new Error(
        "Couldn't open your terminal. Choose another terminal in the report actions menu, or download the report.",
      );
    });
    const session: SupportSession = {
      id,
      agent: p.agent,
      report: p.report,
      body: p.body,
      diagnostics: p.diagnostics ?? null,
      hasScreenshot: !!screenshot,
    };
    await rememberSupportSession(app.getPath("userData"), session);
    return session;
  });
}
