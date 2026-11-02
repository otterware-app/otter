/**
 * `codex app-server` over stdio: newline-delimited JSON, JSON-RPC shaped but
 * without the "jsonrpc" field. `{id, method, params}` is a request (either
 * direction), `{method, params}` a notification, `{id, result|error}` a
 * response. Protocol types: `codex app-server generate-ts --out <dir>`.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { ensureShellPath, logger } from "@otter-mail/desktop/extension-kit";

import type { CodexSettings } from "./settings.js";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type Notification = { method: string; params: Record<string, unknown> };
export type ServerRequest = Notification & { id: number | string };

export class CodexSpawnError extends Error {}

function expandHome(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

/** Splits launch arguments like a shell would for simple quoting. */
function tokenizeArgs(raw: string): string[] {
  return [...raw.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

export function codexBinary(settings: CodexSettings): string {
  return expandHome(settings.binaryPath.trim()) || "codex";
}

export class CodexAppServer {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";
  private exited = false;
  version: string | null = null;
  onNotification: (message: Notification) => void = () => {};
  /** Approvals / user-input requests; must be answered or the turn blocks. */
  onServerRequest: (message: ServerRequest) => void = () => {};
  onExit: (code: number | null) => void = () => {};

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => this.read(chunk));
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split("\n")) {
        if (/\bERROR\b/.test(line))
          logger.info("agent", "codex stderr", {
            line: line.slice(0, 300),
          });
      }
    });
    child.on("exit", (code) => {
      this.exited = true;
      for (const p of this.pending.values()) p.reject(new Error("Codex app-server exited."));
      this.pending.clear();
      this.onExit(code);
    });
  }

  static async start(settings: CodexSettings, cwd: string): Promise<CodexAppServer> {
    await ensureShellPath();
    const binary = codexBinary(settings);
    const env = { ...process.env };
    if (settings.homePath.trim()) env.CODEX_HOME = expandHome(settings.homePath.trim());
    const child = spawn(binary, ["app-server", ...tokenizeArgs(settings.launchArgs)], {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) =>
        reject(new CodexSpawnError(`Could not start Codex CLI (\`${binary}\`): ${error.message}`)),
      );
    });
    const server = new CodexAppServer(child);
    const init = await server.request<{ userAgent?: string }>("initialize", {
      clientInfo: { name: "otter_mail", title: "Otter Mail", version: "1.0.0" },
      capabilities: { experimentalApi: true },
    });
    server.version = init.userAgent?.match(/\/([^\s]+)/)?.[1] ?? null;
    server.notify("initialized");
    return server;
  }

  get alive(): boolean {
    return !this.exited;
  }

  request<T>(method: string, params: unknown = {}, timeoutMs = 0): Promise<T> {
    if (this.exited) return Promise.reject(new Error("Codex app-server exited."));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Timed out waiting for Codex (${method}).`));
            }, timeoutMs)
          : null;
      this.pending.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          reject(error);
        },
      });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  respond(id: number | string, result: unknown): void {
    this.write({ id, result });
  }

  kill(): void {
    if (!this.exited) this.child.kill();
  }

  private write(message: unknown): void {
    if (!this.exited) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private read(chunk: string): void {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let message: {
      id?: number | string;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { message?: string };
    };
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method && message.id != null) {
      this.onServerRequest({
        id: message.id,
        method: message.method,
        params: message.params ?? {},
      });
    } else if (message.method) {
      this.onNotification({
        method: message.method,
        params: message.params ?? {},
      });
    } else if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(message.error.message ?? "Codex request failed."));
      else pending.resolve(message.result);
    }
  }
}
