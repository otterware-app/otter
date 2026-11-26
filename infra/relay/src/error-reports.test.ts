import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { unstable_readConfig } from "wrangler";
import { describe, expect, it } from "vite-plus/test";

import { localConfig } from "../scripts/local-config.ts";
import { errorReports } from "./error-reports.ts";
import type { Env } from "./worker.ts";

function vars(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "otter-relay-config-"));
  try {
    const file = path.join(dir, "wrangler.jsonc");
    fs.writeFileSync(file, source);
    return unstable_readConfig({ config: file }).vars as unknown as Env;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const deployed = vars(fs.readFileSync(path.join(import.meta.dirname, "../wrangler.jsonc"), "utf8"));

describe("errorReports", () => {
  it("reports from the deployed relay", () => {
    expect(errorReports(deployed).enabled).toBe(true);
  });

  it("never reports from tests and dev runs, whatever their BETTER_AUTH_URL", () => {
    const local = vars(localConfig());
    expect(local.BETTER_AUTH_URL).toBe(deployed.BETTER_AUTH_URL);
    expect(errorReports(local).enabled).toBe(false);
  });
});
