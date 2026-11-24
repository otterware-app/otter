import { registerAgentHandlers } from "./handlers/agent.ts";
import { registerCalendarHandlers } from "./handlers/calendar.ts";
import { registerConnectionHandlers } from "./handlers/connections.ts";
import { registerChatHandlers } from "./handlers/chats.ts";
import { registerMailHandlers } from "./handlers/mail.ts";
import { registerImapAccountHandlers } from "./handlers/imap-accounts.ts";
import { registerOutlookAccountHandlers } from "./handlers/outlook-accounts.ts";
import { registerOtterAccountHandlers } from "./handlers/otter-account.ts";
import { registerSearchHandlers } from "./handlers/search.ts";
import { registerUnsubscribeHandlers } from "./handlers/unsubscribe.ts";
import { registerSettingsHandlers } from "./handlers/settings.ts";
import { registerSupportHandlers } from "./handlers/support.ts";
import { activateExtensions, type CoreExtension } from "./extensions.ts";
import { broadcast, handle } from "./ipc.ts";
import { logger } from "./logger.ts";
import { ALL_MODULES, runs, setModules, type CoreModule } from "./modules.ts";
import { setPlatform, type Platform } from "./platform.ts";
import { followAliasMailApart } from "./services/alias-mailboxes.ts";
import { pruneAttachmentCache } from "./services/attachment-cache.ts";
import { loadImapPasswords } from "./services/imap-passwords.ts";
import { readKeybindings, writeKeybindings } from "./services/keybindings-store.ts";
import {
  configureAutoSync,
  followMailboxArrangement,
  syncAllAccounts,
} from "./services/mail-sync.ts";
import { keepDeviceId, restoreAgentOutbox } from "./services/agent-sync.ts";
import { getOtterUser, loadOtterAccount } from "./services/otter-account.ts";
import { importLocalAgentData } from "./services/agent/local-import.ts";
import { getUiPreferences, preferenceChanged, setUiPreference } from "./services/preferences.ts";
import { getSettings, onSettingsChanged } from "./services/settings-store.ts";
import { refreshProfiles } from "./services/google-profile.ts";
import { startCalendarReminders } from "./services/calendar-reminders.ts";
import { startCalendarSync } from "./services/calendar-sync.ts";
import { startMailSchedule } from "./services/mail-schedule.ts";
import { refreshSignatures } from "./services/signatures.ts";

export type CoreOptions = {
  /** Which modules to start; all by default. Calendar needs Mail. */
  modules?: readonly CoreModule[];
  /** An existing phone install’s device id, kept during its upgrade. */
  existingDeviceId?: string;
  existingAgentOutbox?: (userId: string) => Promise<string | null>;
};

export async function startCore(
  platform: Platform,
  extensions: readonly CoreExtension[] = [],
  { modules = ALL_MODULES, existingDeviceId, existingAgentOutbox }: CoreOptions = {},
): Promise<void> {
  setModules(modules);
  setPlatform(platform);
  if (existingDeviceId) keepDeviceId(existingDeviceId);
  if (runs("mail")) {
    await platform.google.load();
    await platform.microsoft?.load();
    await loadImapPasswords();
  }
  await loadOtterAccount();
  const user = getOtterUser();
  if (user && existingAgentOutbox) {
    try {
      await restoreAgentOutbox(user.id, existingAgentOutbox);
    } catch (error) {
      logger.failure("agent-sync", "Couldn't load the previous app's pending changes", error);
    }
  }

  if (runs("mail")) {
    registerMailHandlers();
    startMailSchedule();
    registerImapAccountHandlers();
    registerOutlookAccountHandlers();
    registerSearchHandlers();
    registerUnsubscribeHandlers();
  }
  registerOtterAccountHandlers();
  registerAgentHandlers();
  registerChatHandlers();
  if (runs("calendar")) registerCalendarHandlers();
  registerConnectionHandlers();
  registerSettingsHandlers();
  registerSupportHandlers();
  await activateExtensions(extensions);
  void importLocalAgentData().catch((err: unknown) =>
    logger.failure(
      "agent-sync",
      "Couldn't send this device's agents and chats to the account",
      err,
    ),
  );
  handle("keybindings:read", async () => readKeybindings());
  handle("preferences:getUi", async (params: unknown) =>
    getUiPreferences((params as { initialize?: unknown } | undefined)?.initialize === true),
  );
  handle("preferences:setUi", async (params: unknown) => {
    const { key, value } = (params ?? {}) as { key?: unknown; value?: unknown };
    if (typeof key !== "string" || typeof value !== "string")
      throw new Error("key and value are required.");
    await setUiPreference(key, value);
  });
  onSettingsChanged((settings) => {
    preferenceChanged("settings");
    broadcast("settings:changed", settings);
  });
  handle("keybindings:write", async (params: unknown) => {
    const result = await writeKeybindings((params as { rules?: unknown } | undefined)?.rules);
    broadcast("keybindings:updated");
    preferenceChanged("keybindings");
    return result;
  });

  if (runs("mail")) {
    const ui = await getUiPreferences();
    followMailboxArrangement(ui["mail:mailboxes"]);
    followAliasMailApart(ui["mail:alias-mail-apart"]);
    void syncAllAccounts({ force: true });
    configureAutoSync((await getSettings()).syncIntervalSeconds);
    void pruneAttachmentCache();
    void refreshSignatures();
    void refreshProfiles();
  }
  if (runs("calendar")) {
    startCalendarSync();
    startCalendarReminders();
  }
}

export { broadcast, callHandler, handle, registeredHandlers, type Handler } from "./ipc.ts";
export type { CoreExtension, ExtensionContext } from "./extensions.ts";
export { fromBase64, toBase64 } from "./bytes.ts";
export {
  GMAIL_ACCESS_MISSING_MESSAGE,
  GOOGLE_UNAVAILABLE_MESSAGE,
  SIGNED_OUT_MESSAGE,
  SignInCancelledError,
  SignInTimedOutError,
} from "./google.ts";
export { GRAPH_ME_URL, OUTLOOK_SIGNED_OUT_MESSAGE, signInFromMe } from "./microsoft.ts";
export { readJson, writeJson } from "./json-file.ts";
export { logger } from "./logger.ts";
export type * from "./platform.ts";
export type { CoreModule } from "./modules.ts";
export * as accountStore from "./services/account-store.ts";
export * as mailStore from "./services/mail-store.ts";
export { runAsTask } from "./handlers/ipc-budget.ts";
export { ATTACHMENTS_DIR, dataUrl, readAttachment } from "./services/agent/attachments.ts";
export {
  shutdownProviders,
  type AgentInAppNotice,
  type AgentNoticeKind,
} from "./services/agent/service.ts";
export { TOOL_OUTPUT_CHARS, claudeStep, codexStep } from "./services/agent/steps.ts";
export { TextStream } from "./services/agent/text-stream.ts";
export { chatFile, chatFilePath, MAX_CHAT_FILE_BYTES } from "./services/agent/files.ts";
export {
  OTTER_TOOLS_SERVER,
  agentTools,
  cancelToolApprovals,
  runAgentTool,
  type AgentTool,
  type ToolCaller,
  type ToolFiles,
} from "./services/agent/tools/index.ts";
export * from "./services/agent/types.ts";
export { getAttachmentBytes } from "./services/attachment-cache.ts";
export { addDemoAgents } from "./services/demo-agents.ts";
export { addDemoMailboxes } from "./services/demo-mailboxes.ts";
export { errorReportsConfig, type ErrorReportsConfig } from "./services/error-reports.ts";
export { KEYBINDINGS_FILE } from "./services/keybindings-store.ts";
export { syncAllAccounts, turnedOffMailboxes } from "./services/mail-sync.ts";
export {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type AppSettings,
} from "./services/settings-store.ts";
export type * from "./types.ts";

export { signInWithSession, clearOtterSession } from "./services/otter-account.ts";
