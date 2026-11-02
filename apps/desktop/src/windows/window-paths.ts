import { app, net, protocol } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export const RENDERER_SCHEME = "ottermail";
const RENDERER_HOST = "app";

const devServerUrl = process.env.VITE_DEV_SERVER_URL?.trim().replace(/\/+$/, "") || null;

export function getPreloadPath(): string {
  return path.join(__dirname, "preload.cjs");
}

function rendererRoot(): string {
  const candidates = [
    path.join(app.getAppPath(), "renderer"),
    path.resolve(__dirname, "..", "..", "web", "dist"),
  ];
  return candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) ?? candidates[0]!;
}

/** Must run before app `ready`: lets the renderer scheme behave like https. */
export function registerRendererScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export function handleRendererProtocol(): void {
  if (devServerUrl) return;
  const root = rendererRoot();
  protocol.handle(RENDERER_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) return new Response("Not found", { status: 404 });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const filePath = path.resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

export function getWindowUrl(htmlFileName: string): string {
  if (devServerUrl) return `${devServerUrl}/${htmlFileName}`;
  return `${RENDERER_SCHEME}://${RENDERER_HOST}/${htmlFileName}`;
}

export function isDevServer(): boolean {
  return devServerUrl != null;
}
