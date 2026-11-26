import { app, BrowserWindow, Menu, ipcMain, nativeTheme, shell } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";

import type { NativeThemeInfo, ThemeSource } from "@otter/contracts";
import type { AppSettings, ErrorReportsConfig } from "@otter/core";

import { invokeBackend, setDockBadgeEnabled, startBackend, stopBackend } from "./backend-host.ts";
import { registerHandlers } from "./handlers/index.ts";
import { requestSupportReport } from "./handlers/support.ts";
import { followErrorReportsConfig, startErrorReports } from "./error-reports.ts";
import { logger, logToFile } from "./logger.ts";
import { hostOS } from "./os/index.ts";
import type { AppMenuItems } from "./os/types.ts";
import { configureAppPaths, nameApp } from "./paths.ts";
import { focusedBrowserPage } from "@otter/browser/main";
import { setupBrowser } from "./browser.ts";
import { embedDriveContent } from "./services/drive-content.ts";
import { parseMailtoUrl, setPendingMailto } from "./services/mailto-target.ts";
import { initUpdates } from "./updates.ts";
import { stepHistory } from "./windows/history-buttons.ts";
import { setSettingsTarget } from "./windows/settings-window.ts";
import {
  allowWindows,
  createMainWindow,
  focusMainWindow,
  focusedAppWindow,
  getMainWindow,
} from "./windows/main-window.ts";
import { handleRendererProtocol, registerRendererScheme } from "./windows/window-paths.ts";

configureAppPaths();
startErrorReports();
logToFile(app.getPath("logs"), !app.isPackaged);

// Logging to a terminal that has gone away (a stopped `pnpm dev`) must not
// crash the app with EPIPE.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", () => {});
}

if (process.env.VITE_DEV_SERVER_URL) {
  const parentPid = process.ppid;
  setInterval(() => {
    if (process.ppid !== parentPid) app.quit();
  }, 1_000).unref();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

registerRendererScheme();

function openMailto(url: string): void {
  const target = parseMailtoUrl(url);
  logger.info("main", "open-url", { mailto: target != null });
  if (!target) return;
  setPendingMailto(target);
  if (app.isReady()) {
    void focusMainWindow().then((win) => win.webContents.send("compose:mailto"));
  }
}

const mailtoArgument = (argv: string[]) => argv.find((arg) => /^mailto:/i.test(arg));

// Registered before `ready`: cold starts deliver the URL early.
app.on("open-url", (event, url) => {
  event.preventDefault();
  openMailto(url);
});
const launchMailto = mailtoArgument(process.argv);
if (launchMailto) openMailto(launchMailto);

app.on("second-instance", (_event, argv) => {
  const url = mailtoArgument(argv);
  if (url) openMailto(url);
  else void focusMainWindow();
});

function themeFile(): string {
  return path.join(app.getPath("userData"), "appearance.json");
}

function restoreThemeSource(): void {
  try {
    const stored = JSON.parse(fs.readFileSync(themeFile(), "utf-8")) as { themeSource?: unknown };
    if (
      stored.themeSource === "light" ||
      stored.themeSource === "dark" ||
      stored.themeSource === "system"
    ) {
      nativeTheme.themeSource = stored.themeSource;
    }
  } catch {
    // First launch: follow the system.
  }
}

function themeInfo(): NativeThemeInfo {
  return {
    shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
    themeSource: nativeTheme.themeSource,
    shouldUseHighContrastColors: nativeTheme.shouldUseHighContrastColors,
    prefersReducedTransparency: nativeTheme.prefersReducedTransparency,
  };
}

ipcMain.handle("nativeTheme:getInfo", () => themeInfo());
ipcMain.handle("nativeTheme:setThemeSource", async (_event, source: unknown) => {
  if (source !== "light" && source !== "dark" && source !== "system") return;
  nativeTheme.themeSource = source as ThemeSource;
  await fs.promises.writeFile(themeFile(), JSON.stringify({ themeSource: source }));
});

ipcMain.handle("app:region", () => app.getLocaleCountryCode() || undefined);

ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
  if (
    typeof url !== "string" ||
    !/^(https?|mailto|tel|sms|x-apple\.systempreferences):/i.test(url)
  ) {
    return false;
  }
  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("edit:nativeUndo", (event) => {
  event.sender.undo();
});
ipcMain.handle("edit:nativeRedo", (event) => {
  event.sender.redo();
});

ipcMain.handle("window:closeMain", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

function setupApplicationMenu(): void {
  const items: AppMenuItems = {
    about: { role: "about" },
    checkForUpdates: {
      label: "Check for Updates…",
      click: () => {
        void focusMainWindow().then((win) => win.webContents.send("updates:checkRequested"));
      },
    },
    settings: {
      label: "Settings…",
      click: async () => {
        setSettingsTarget({});
        (await focusMainWindow()).webContents.send("settings:open");
      },
    },
    file: [
      {
        label: "Close",
        accelerator: "CommandOrControl+W",
        click: () => {
          const win = focusedAppWindow();
          if (win) {
            win.webContents.send("window:closeRequest");
            return;
          }
          BrowserWindow.getFocusedWindow()?.close();
        },
      },
      { type: "separator" },
      {
        label: "New Tab",
        accelerator: "CommandOrControl+T",
        click: (_item, _window, event) => {
          if (event.triggeredByAccelerator) {
            focusedAppWindow()?.webContents.send("keybindings:keydown", {
              key: "t",
              [hostOS.modifierKey]: true,
            });
            return;
          }
          void focusMainWindow().then((win) => win.webContents.send("browser:newTab"));
        },
      },
      {
        label: "Open Location…",
        accelerator: "CommandOrControl+L",
        click: () =>
          void focusMainWindow().then((win) => win.webContents.send("browser:focusAddress")),
      },
    ],
    edit: [
      {
        label: "Undo",
        accelerator: "CommandOrControl+Z",
        click: () => {
          const page = focusedBrowserPage();
          if (page) {
            page.undo();
            return;
          }
          const win = focusedAppWindow();
          if (win) {
            win.webContents.send("edit:undo");
            return;
          }
          BrowserWindow.getFocusedWindow()?.webContents.undo();
        },
      },
      {
        label: "Redo",
        accelerator: "Shift+CommandOrControl+Z",
        click: () => {
          const page = focusedBrowserPage();
          if (page) {
            page.redo();
            return;
          }
          const win = focusedAppWindow();
          if (win) {
            win.webContents.send("edit:redo");
            return;
          }
          BrowserWindow.getFocusedWindow()?.webContents.redo();
        },
      },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
    // No plain Reload: ⌘R belongs to Sync Now. Force Reload (⇧⌘R) stays for
    // when the page really needs reloading.
    view: [
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
    go: [
      {
        label: "Back",
        accelerator: "CommandOrControl+[",
        click: () => stepHistory(focusedAppWindow(), focusedBrowserPage(), "back"),
      },
      {
        label: "Forward",
        accelerator: "CommandOrControl+]",
        click: () => stepHistory(focusedAppWindow(), focusedBrowserPage(), "forward"),
      },
    ],
    mailbox: [
      {
        label: "Sync Now",
        accelerator: "CommandOrControl+R",
        click: () => {
          const page = focusedBrowserPage();
          if (page) {
            page.reload();
            return;
          }
          logger.info("main", "Menu: Sync Now");
          (focusedAppWindow() ?? getMainWindow())?.webContents.send("mail:syncNow");
        },
      },
      {
        label: "Synchronize All Mailboxes",
        accelerator: "Shift+CommandOrControl+N",
        click: () => {
          logger.info("main", "Menu: Synchronize All Mailboxes");
          void invokeBackend("desktop:syncAll");
        },
      },
    ],
    help: [
      {
        label: "Send Feedback…",
        click: () => {
          requestSupportReport();
          void focusMainWindow().then((win) => win.webContents.send("support:open"));
        },
      },
    ],
  };
  Menu.setApplicationMenu(Menu.buildFromTemplate(hostOS.applicationMenu(items)));
}

// Without a listener Electron quits here; the app stays, in the Dock or the tray.
app.on("window-all-closed", () => {});

app.on("activate", (_event, hasVisibleWindows) => {
  if (!hasVisibleWindows) void focusMainWindow();
});

app.on("will-quit", () => {
  stopBackend();
});

void app.whenReady().then(async () => {
  nameApp();
  logger.info("main", "App ready", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
  });

  restoreThemeSource();
  hostOS.prepareSecrets();
  handleRendererProtocol();
  embedDriveContent();
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
  });

  setupBrowser();
  // The window loads while the backend starts: the preload holds its invokes until it's ready.
  const backendStarted = startBackend();
  registerHandlers();
  setupApplicationMenu();
  initUpdates();
  allowWindows();
  hostOS.showInTray(() => void focusMainWindow());
  createMainWindow(app.isPackaged && hostOS.launchedAtLogin()).catch((error: unknown) =>
    logger.error("main", "Failed to create main window", error),
  );

  await backendStarted;
  const startupSettings = (await invokeBackend("settings:get")) as AppSettings;
  if (app.isPackaged) {
    hostOS.setLaunchAtLogin(startupSettings.launchAtLogin);
  }
  setDockBadgeEnabled(startupSettings.dockBadgeEnabled);
  void invokeBackend("errorReports:config").then((config) =>
    followErrorReportsConfig(config as ErrorReportsConfig),
  );
});
