import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "path";

import type { TranslationStatus, Translator } from "@otter-mail/core";

import { appInfo } from "../../backend-protocol.js";

const STATUSES: ReadonlySet<string> = new Set(["ok", "notInstalled", "unsupported", "unavailable"]);

const HELPER_TIMEOUT_MS = 60_000;

function helperPath(): string {
  const { packaged, resourcesPath } = appInfo();
  if (packaged) return path.join(resourcesPath, "bin", "translator");
  const packageDir = path.resolve(__dirname, "..", "..", "..", "native", "translator", ".build");
  const candidates = [
    path.join(packageDir, "release", "translator"),
    path.join(packageDir, "apple", "Products", "Release", "translator"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

function runHelper(command: "detect" | "translate", request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      helperPath(),
      [command],
      { timeout: HELPER_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim() || error.message;
          reject(new Error(`The translator failed: ${detail}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error("The translator returned malformed output."));
        }
      },
    );
    child.stdin?.end(JSON.stringify(request));
  });
}

export const appleTranslator: Translator = {
  async detect(text) {
    const raw = (await runHelper("detect", { text })) as {
      language?: unknown;
      confidence?: unknown;
    } | null;
    return {
      language: typeof raw?.language === "string" ? raw.language : null,
      confidence: typeof raw?.confidence === "number" ? raw.confidence : 0,
    };
  },
  async translate(texts, source, target) {
    const startedAt = Date.now();
    const raw = (await runHelper("translate", { texts, source, target })) as {
      status?: unknown;
      texts?: unknown;
    } | null;
    const status = (
      STATUSES.has(String(raw?.status)) ? raw!.status : "unsupported"
    ) as TranslationStatus;
    console.log("[translator:translate]", {
      source,
      target,
      segments: texts.length,
      status,
      ms: Date.now() - startedAt,
    });
    return { status, texts: Array.isArray(raw?.texts) ? raw.texts.map(String) : [] };
  },
};
