import { app, nativeTheme } from "electron";

import type { HostOS } from "../types.js";
import { listMailApps, setDefaultMailApp } from "./mail-apps.js";
import { macTerminals } from "./terminals.js";
import { nativeMessagingDirectories } from "./native-messaging.js";

const TOPBAR_HEIGHT = 42;
const WINDOW_BUTTON_RADIUS = 7;

const background = () => (nativeTheme.shouldUseDarkColors ? "#0c0c0e" : "#ededf0");

export const macOS: HostOS = {
  nativeMessagingDirectories,
  modifierKey: "metaKey",

  mainWindowOptions: () => ({
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: TOPBAR_HEIGHT / 2 - WINDOW_BUTTON_RADIUS },
    backgroundColor: background(),
    webPreferences: {
      scrollBounce: true,
    },
  }),
  windowFollowsTheme(win) {
    const update = () => win.setBackgroundColor(background());
    nativeTheme.on("updated", update);
    win.once("closed", () => nativeTheme.off("updated", update));
  },

  applicationMenu: (items) => [
    {
      label: app.getName(),
      submenu: [
        items.about,
        items.checkForUpdates,
        { type: "separator" },
        { ...items.settings, accelerator: "Command+," },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { label: "File", submenu: items.file },
    {
      label: "Edit",
      submenu: [
        ...items.edit,
        { type: "separator" },
        { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
      ],
    },
    { label: "View", submenu: items.view },
    { label: "Go", submenu: items.go },
    { label: "Mailbox", submenu: items.mailbox },
    { role: "windowMenu" },
    { role: "help", submenu: items.help },
  ],

  launchedAtLogin: () => app.getLoginItemSettings().wasOpenedAtLogin,
  showInTray: () => {},

  installsUpdatesOnQuit: true,

  prepareSecrets: () => {},

  setLaunchAtLogin: (enabled) => app.setLoginItemSettings({ openAtLogin: enabled }),
  setBadge: (count) => app.dock?.setBadge(count > 0 ? String(count) : ""),

  mailApps: { list: listMailApps, setDefault: setDefaultMailApp },
  terminals: macTerminals,
};
