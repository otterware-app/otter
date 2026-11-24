import { handle } from "../ipc.ts";
import { runs } from "../modules.ts";
import { configureAutoSync } from "../services/mail-sync.ts";
import { getSettings, updateSettings, type AppSettings } from "../services/settings-store.ts";

/** The app's settings, whichever modules run. */
export function registerSettingsHandlers(): void {
  handle("settings:get", async () => {
    try {
      return await getSettings();
    } catch (err) {
      console.log("[settings:get] error", { error: String(err) });
      throw err;
    }
  });

  handle("settings:set", async (params: unknown) => {
    const p = params as Record<string, unknown>;
    console.log("[settings:set]", {
      syncIntervalSeconds: p?.syncIntervalSeconds,
      notificationsMode: p?.notificationsMode,
    });
    try {
      const patch: Partial<AppSettings> = {};
      if (p?.syncIntervalSeconds !== undefined) {
        const raw = p.syncIntervalSeconds;
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
          throw new Error(
            'Invalid parameter: "syncIntervalSeconds" must be a non-negative number.',
          );
        }
        patch.syncIntervalSeconds = Math.min(Math.round(raw), 24 * 60 * 60);
      }
      if (p?.notificationsMode !== undefined) {
        const mode = p.notificationsMode;
        if (mode !== "off" && mode !== "inbox" && mode !== "all") {
          throw new Error(
            'Invalid parameter: "notificationsMode" must be "off", "inbox", or "all".',
          );
        }
        patch.notificationsMode = mode;
      }
      if (p?.agentNotificationsMode !== undefined) {
        const mode = p.agentNotificationsMode;
        if (mode !== "off" && mode !== "needs-you" && mode !== "all") {
          throw new Error(
            'Invalid parameter: "agentNotificationsMode" must be "off", "needs-you", or "all".',
          );
        }
        patch.agentNotificationsMode = mode;
      }
      if (p?.calendarReminders !== undefined) {
        if (typeof p.calendarReminders !== "boolean") {
          throw new Error('Invalid parameter: "calendarReminders" must be a boolean.');
        }
        patch.calendarReminders = p.calendarReminders;
      }
      if (p?.launchAtLogin !== undefined) {
        if (typeof p.launchAtLogin !== "boolean") {
          throw new Error('Invalid parameter: "launchAtLogin" must be a boolean.');
        }
        patch.launchAtLogin = p.launchAtLogin;
      }
      if (p?.dockBadgeEnabled !== undefined) {
        if (typeof p.dockBadgeEnabled !== "boolean") {
          throw new Error('Invalid parameter: "dockBadgeEnabled" must be a boolean.');
        }
        patch.dockBadgeEnabled = p.dockBadgeEnabled;
      }
      if (p?.errorReports !== undefined) {
        if (typeof p.errorReports !== "boolean") {
          throw new Error('Invalid parameter: "errorReports" must be a boolean.');
        }
        patch.errorReports = p.errorReports;
      }
      const settings = await updateSettings(patch);
      if (patch.syncIntervalSeconds !== undefined && runs("mail")) {
        configureAutoSync(settings.syncIntervalSeconds);
      }
      return settings;
    } catch (err) {
      console.log("[settings:set] error", { error: String(err) });
      throw err;
    }
  });
}
