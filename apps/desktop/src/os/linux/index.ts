import { app, Menu, nativeTheme, safeStorage, Tray } from "electron";

import { logger } from "../../logger.js";
import { appIconImage } from "../../resources.js";
import type { HostOS } from "../types.js";
import { HIDDEN_FLAG, setAutostart } from "./autostart.js";
import { listMailApps, setDefaultMailApp } from "./mail-apps.js";
import { linuxTerminals } from "./terminals.js";
import { nativeMessagingDirectories } from "./native-messaging.js";

const TOPBAR_HEIGHT = 42;

const background = () => (nativeTheme.shouldUseDarkColors ? "#0c0c0e" : "#ededf0");
const symbolColor = () => (nativeTheme.shouldUseDarkColors ? "#d4d4d4" : "#525252");

// Held here: a tray icon that is garbage collected disappears.
let tray: Tray | null = null;

export const linuxOS: HostOS = {
  nativeMessagingDirectories,
  modifierKey: "ctrlKey",

  mainWindowOptions: () => ({
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: symbolColor(), height: TOPBAR_HEIGHT },
    backgroundColor: background(),
    icon: appIconImage(),
  }),
  windowFollowsTheme(win) {
    const update = () => {
      win.setTitleBarOverlay({ color: "#00000000", symbolColor: symbolColor() });
      win.setBackgroundColor(background());
    };
    nativeTheme.on("updated", update);
    win.once("closed", () => nativeTheme.off("updated", update));
  },

  applicationMenu: (items) => [
    {
      label: "&File",
      submenu: [
        { ...items.settings, accelerator: "Ctrl+," },
        { type: "separator" },
        ...items.file,
        { type: "separator" },
        { role: "quit", accelerator: "Ctrl+Q" },
      ],
    },
    { label: "&Edit", submenu: items.edit },
    { label: "&View", submenu: items.view },
    { label: "&Go", submenu: items.go },
    { label: "&Mailbox", submenu: items.mailbox },
    {
      label: "&Help",
      submenu: [...items.help, { type: "separator" }, items.checkForUpdates, items.about],
    },
  ],

  launchedAtLogin: () => process.argv.includes(HIDDEN_FLAG),
  showInTray(open) {
    tray = new Tray(appIconImage().resize({ width: 24, height: 24 }));
    tray.setToolTip(app.getName());
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: `Open ${app.getName()}`, click: open },
        { type: "separator" },
        { role: "quit" },
      ]),
    );
    tray.on("click", open);
  },

  // dpkg needs the admin password (pkexec): ask when the user restarts to update.
  installsUpdatesOnQuit: false,

  // Desktops without a supported keyring use the app's local key; files remain readable only by the user.
  prepareSecrets() {
    if (!safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true);
    logger.info("main", "Secrets", { store: safeStorage.getSelectedStorageBackend() });
  },

  setLaunchAtLogin(enabled) {
    // An unpackaged run would autostart Electron itself.
    if (!app.isPackaged) return;
    setAutostart(enabled, process.env.APPIMAGE ?? process.execPath);
  },
  setBadge: () => {},

  mailApps: { list: listMailApps, setDefault: setDefaultMailApp },
  terminals: linuxTerminals,
};
