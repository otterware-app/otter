import "vite-plus/test/config";
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { defineConfig } from "vite-plus";

import pkg from "./package.json" with { type: "json" };

function buildEnv(key: string): string {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  for (const file of ["../../.env.local", "../../.env"]) {
    const url = new URL(file, import.meta.url);
    if (!NodeFS.existsSync(url)) continue;
    for (const line of NodeFS.readFileSync(url, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match?.[1] === key) return match[2]!.replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return "";
}

const isExternal = (id: string) => id === "electron" || id.startsWith("electron/");

const shared = {
  format: "cjs",
  alias: {
    "@otter-mail/desktop/extension-kit": NodeURL.fileURLToPath(
      new URL("./src/extension-kit.ts", import.meta.url),
    ),
  },
  outDir: "dist-electron",
  dts: false,
  sourcemap: true,
  outExtensions: () => ({ js: ".cjs" }),
  define: {
    __APP_VERSION__: JSON.stringify(process.env.OTTER_MAIL_VERSION?.trim() || pkg.version),
    __GOOGLE_CLIENT_ID__: JSON.stringify(buildEnv("OTTER_MAIL_GOOGLE_CLIENT_ID")),
    __GOOGLE_CLIENT_SECRET__: JSON.stringify(buildEnv("OTTER_MAIL_GOOGLE_CLIENT_SECRET")),
    __MICROSOFT_CLIENT_ID__: JSON.stringify(buildEnv("OTTER_MAIL_MICROSOFT_CLIENT_ID")),
  },
  deps: {
    alwaysBundle: (id: string) => !id.startsWith("node:") && !isExternal(id),
    neverBundle: isExternal,
    onlyBundle: false,
  },
} as const;

export default defineConfig({
  pack: [
    {
      ...shared,
      entry: ["src/main.ts"],
      clean: true,
      outputOptions: { codeSplitting: false },
      copy: { from: "node_modules/electron-chrome-web-store/dist/chrome-web-store.preload.js" },
    },
    {
      ...shared,
      entry: ["src/backend.ts"],
      clean: false,
      outputOptions: { codeSplitting: false },
    },
    {
      // Sandboxed preloads must be self-contained, without shared runtime chunks.
      ...shared,
      entry: ["src/preload.ts"],
      clean: false,
    },
    {
      ...shared,
      entry: ["src/extensions-preload.ts"],
      clean: false,
      outputOptions: { codeSplitting: false },
    },
  ],
});
