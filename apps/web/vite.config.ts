import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import * as NodeURL from "node:url";
import "vite-plus/test/config";
import { defineConfig, type Plugin } from "vite-plus";

import pkg from "./package.json" with { type: "json" };
import { releaseChannel } from "../../packages/shared/src/release-channel";

const port = Number(process.env.PORT ?? 5833);

const devDemo = Boolean(
  process.env.OTTER_DEMO_MAILBOXES && process.env.VITE_RELAY_URL?.startsWith("http://localhost:"),
);

/** The demo's mailboxes, for the backend to add: from the dev server only, never in a build. */
function demoMailboxes(): Plugin {
  return {
    name: "otter-demo-mailboxes",
    apply: "serve",
    configureServer(server) {
      if (!devDemo) return;
      server.middlewares.use("/__dev/demo-mailboxes", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(process.env.OTTER_DEMO_MAILBOXES);
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  // Built files are loaded by the Electron shell (ottermail://app/) and served
  // at otter.otterware.app by the site Worker, both from the root. Absolute
  // paths, so a page loaded at a deep route (/you@gmail.com/INBOX/…) finds them.
  base: "/",
  plugins: [
    {
      name: "otter-build-icons",
      transformIndexHtml(html) {
        const channel =
          command === "serve" ? "dev" : releaseChannel(process.env.OTTER_VERSION || pkg.version);
        return channel === "stable"
          ? html
          : html.replace(
              /href="\/(favicon\.(?:ico|svg)|apple-touch-icon\.png)"/g,
              `href="/icons/${channel}/$1"`,
            );
      },
    },
    demoMailboxes(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  define: {
    __APP_DISPLAY_NAME__: JSON.stringify("Otter"),
    __APP_VERSION__: JSON.stringify(process.env.OTTER_VERSION?.trim() || pkg.version),
    __DEMO__: JSON.stringify(process.env.VITE_DEMO === "1"),
    __DEV_DEMO__: JSON.stringify(command === "serve" && devDemo),
    __ERROR_REPORTS__: JSON.stringify(
      command === "build" || process.env.OTTER_ERROR_REPORTS === "1",
    ),
  },
  resolve: {
    alias: {
      "~": NodeURL.fileURLToPath(new URL("./src", import.meta.url)),
      "@otter/web/extension-kit": NodeURL.fileURLToPath(
        new URL("./src/main/extensions/kit.ts", import.meta.url),
      ),
    },
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/react-router"],
  },
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  server: {
    port,
    strictPort: true,
    host: "localhost",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        "todoist-callback": NodeURL.fileURLToPath(
          new URL("./todoist-callback/index.html", import.meta.url),
        ),
        main: NodeURL.fileURLToPath(new URL("./index.html", import.meta.url)),
      },
    },
  },
}));
