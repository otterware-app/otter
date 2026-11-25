import { app, ipcMain, systemPreferences, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { host } from "./host.ts";

/** What a site may ask for, Chrome's way: the user answers, once or for good. */
export type SitePermission = "camera" | "microphone" | "location" | "notifications" | "clipboard";

type Decisions = Record<string, Partial<Record<SitePermission, boolean>>>;

/** Granted without asking (Chrome's too); anything not here or asked is refused. */
const ALLOWED = new Set(["fullscreen", "clipboard-sanitized-write", "pointerLock"]);

const file = () => path.join(app.getPath("userData"), "Site Permissions.json");
let decisions: Decisions | null = null;

function load(): Decisions {
  if (decisions) return decisions;
  try {
    decisions = JSON.parse(fs.readFileSync(file(), "utf8")) as Decisions;
  } catch {
    decisions = {};
  }
  return decisions;
}

function remember(origin: string, permissions: SitePermission[], allow: boolean): void {
  const all = load();
  all[origin] = { ...all[origin], ...Object.fromEntries(permissions.map((p) => [p, allow])) };
  fs.writeFileSync(file(), JSON.stringify(all));
}

export function forgetPermissions(origin?: string): void {
  const all = load();
  if (origin) delete all[origin];
  else for (const key of Object.keys(all)) delete all[key];
  fs.writeFileSync(file(), JSON.stringify(all));
}

export function sitePermissions(origin: string): Partial<Record<SitePermission, boolean>> {
  return load()[origin] ?? {};
}

/** Chromium's names for what a page asks, as the sites' permissions Otter asks about. */
function asked(permission: string, details: { mediaTypes?: string[] }): SitePermission[] {
  switch (permission) {
    case "media": {
      const types = details.mediaTypes ?? [];
      return [
        ...(types.includes("video") ? (["camera"] as const) : []),
        ...(types.includes("audio") ? (["microphone"] as const) : []),
      ];
    }
    case "geolocation":
      return ["location"];
    case "notifications":
      return ["notifications"];
    case "clipboard-read":
      return ["clipboard"];
  }
  return [];
}

type Asked = { id: string; webContentsId: number; site: string; permissions: SitePermission[] };

const pending = new Map<
  string,
  { resolve: (answer: { allow: boolean; remember: boolean }) => void; asked: Asked }
>();

/** macOS asks once whether Otter may use the camera or microphone at all. */
async function systemAllows(permissions: SitePermission[]): Promise<boolean> {
  if (process.platform !== "darwin") return true;
  for (const permission of permissions) {
    if (permission !== "camera" && permission !== "microphone") continue;
    if (!(await systemPreferences.askForMediaAccess(permission))) return false;
  }
  return true;
}

export async function requestPermission(
  page: WebContents,
  origin: string,
  permission: string,
  details: { mediaTypes?: string[] },
): Promise<boolean> {
  if (ALLOWED.has(permission)) return true;
  const wanted = asked(permission, details);
  if (wanted.length === 0 || !/^https?:\/\//.test(origin)) return false;
  const known = sitePermissions(origin);
  if (wanted.some((p) => known[p] === false)) return false;
  if (wanted.every((p) => known[p] === true)) return systemAllows(wanted);
  const id = randomUUID();
  const answer = await new Promise<{ allow: boolean; remember: boolean }>((resolve) => {
    const asked = { id, webContentsId: page.id, site: new URL(origin).host, permissions: wanted };
    pending.set(id, { resolve, asked });
    host().broadcast("browser:permissionRequest", asked);
    page.once("destroyed", () => resolve({ allow: false, remember: false }));
    // The page went elsewhere: what it asked no longer stands.
    const left = (details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
      if (details.isMainFrame && !details.isSameDocument) {
        resolve({ allow: false, remember: false });
      }
    };
    page.on("did-start-navigation", left);
    pending.get(id)!.resolve = (answer) => {
      page.off("did-start-navigation", left);
      resolve(answer);
    };
  });
  pending.delete(id);
  host().broadcast("browser:permissionAnswered", { id });
  if (answer.remember) remember(origin, wanted, answer.allow);
  return answer.allow && (await systemAllows(wanted));
}

export function checkPermission(origin: string, permission: string): boolean {
  if (ALLOWED.has(permission)) return true;
  const wanted = asked(permission, { mediaTypes: ["video", "audio"] });
  const known = sitePermissions(origin);
  return wanted.length > 0 && wanted.some((p) => known[p] === true);
}

export function setupPermissionPrompts(): void {
  ipcMain.handle("browser:answerPermission", (_event, params: unknown) => {
    const { id, allow, remember } = (params ?? {}) as {
      id?: unknown;
      allow?: unknown;
      remember?: unknown;
    };
    if (typeof id !== "string" || typeof allow !== "boolean") {
      throw new Error("Invalid parameters for browser:answerPermission.");
    }
    pending.get(id)?.resolve({ allow, remember: remember === true });
  });
  // A page can ask before its tab hears it: the tab asks what's waiting once it's there.
  ipcMain.handle("browser:pendingPermissions", (_event, webContentsId: unknown) =>
    [...pending.values()]
      .map((p) => p.asked)
      .filter((asked) => asked.webContentsId === webContentsId),
  );
  ipcMain.handle("browser:sitePermissions", (_event, origin: unknown) =>
    typeof origin === "string" ? sitePermissions(origin) : {},
  );
  ipcMain.handle("browser:forgetPermissions", (_event, origin: unknown) => {
    if (typeof origin === "string") forgetPermissions(origin);
  });
}
