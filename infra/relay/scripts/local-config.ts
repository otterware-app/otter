import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Local Mail development keeps its own fake/test identity and never calls Accounts. */
export function localConfig(): string {
  const root = resolve(import.meta.dirname, "..");
  return readFileSync(resolve(root, "wrangler.jsonc"), "utf8")
    .replace(/"services":\s*\[[\s\S]*?\],/, '"services": [],')
    .replace('"IDENTITY_MODE": "accounts"', '"IDENTITY_MODE": "legacy", "LOCAL": "true"')
    .replace('"src/worker.ts"', JSON.stringify(resolve(root, "src/worker.ts")))
    .replace(
      '"migrations_dir": "migrations"',
      `"migrations_dir": ${JSON.stringify(resolve(root, "migrations"))}`,
    );
}
