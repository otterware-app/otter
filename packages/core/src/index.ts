import { registerAgentHandlers } from "./handlers/agent.js";
import { registerCalendarHandlers } from "./handlers/calendar.js";
import { registerConnectionHandlers } from "./handlers/connections.js";
import { registerChatHandlers } from "./handlers/chats.js";
import { registerMailHandlers } from "./handlers/mail.js";
import { registerImapAccountHandlers } from "./handlers/imap-accounts.js";
import { registerOutlookAccountHandlers } from "./handlers/outlook-accounts.js";
import { registerOtterAccountHandlers } from "./handlers/otter-account.js";
import { registerSearchHandlers } from "./handlers/search.js";
import { registerUnsubscribeHandlers } from "./handlers/unsubscribe.js";
import { registerSupportHandlers } from "./handlers/support.js";
import { activateExtensions, type CoreExtension } from "./extensions.js";
import { broadcast, handle } from "./ipc.js";
import { setPlatform, type Platform } from "./platform.js";
import { pruneAttachmentCache } from "./services/attachment-cache.js";
import { loadImapPasswords } from "./services/imap-passwords.js";
import { readKeybindings, writeKeybindings } from "./services/keybindings-store.js";
import {
  configureAutoSync,
  followMailboxArrangement,
  syncAllAccounts,
} from "./services/mail-sync.js";
import { loadOtterAccount } from "./services/otter-account.js";
import { getUiPreferences, preferenceChanged, setUiPreference } from "./services/preferences.js";
import { getSettings, onSettingsChanged } from "./services/settings-store.js";
import { refreshProfiles } from "./services/google-profile.js";
import { startMailSchedule } from "./services/mail-schedule.js";
import { refreshSignatures } from "./services/signatures.js";

export async function startCore(
  platform: Platform,
  extensions: readonly CoreExtension[] = [],
): Promise<void> {
  setPlatform(platform);
  await platform.google.load();
  await platform.microsoft?.load();
  await loadImapPasswords();
  await loadOtterAccount();

  registerMailHandlers();
  startMailSchedule();
  registerImapAccountHandlers();
  registerOutlookAccountHandlers();
  registerSearchHandlers();
  registerUnsubscribeHandlers();
  registerOtterAccountHandlers();
  registerAgentHandlers();
  registerChatHandlers();
  registerCalendarHandlers();
  registerConnectionHandlers();
  registerSupportHandlers();
  await activateExtensions(extensions);
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

  followMailboxArrangement((await getUiPreferences())["mail:mailboxes"]);
  void syncAllAccounts({ force: true });
  configureAutoSync((await getSettings()).syncIntervalSeconds);
  void pruneAttachmentCache();
  void refreshSignatures();
  void refreshProfiles();
}

export { broadcast, callHandler, handle, registeredHandlers, type Handler } from "./ipc.js";
export type { CoreExtension, ExtensionContext } from "./extensions.js";
export { fromBase64, toBase64 } from "./bytes.js";
export { SIGNED_OUT_MESSAGE, SignInCancelledError, SignInTimedOutError } from "./google.js";
export { GRAPH_ME_URL, OUTLOOK_SIGNED_OUT_MESSAGE, signInFromMe } from "./microsoft.js";
export { readJson, writeJson } from "./json-file.js";
export { logger } from "./logger.js";
export type * from "./platform.js";
export * as accountStore from "./services/account-store.js";
export * as mailStore from "./services/mail-store.js";
export { runAsTask } from "./handlers/ipc-budget.js";
export { ATTACHMENTS_DIR, dataUrl, readAttachment } from "./services/agent/attachments.js";
export { shutdownProviders } from "./services/agent/service.js";
export { TOOL_OUTPUT_CHARS, claudeStep, codexStep } from "./services/agent/steps.js";
export { TextStream } from "./services/agent/text-stream.js";
export { chatFile, chatFilePath, MAX_CHAT_FILE_BYTES } from "./services/agent/files.js";
export {
  OTTER_TOOLS_SERVER,
  agentTools,
  cancelToolApprovals,
  runAgentTool,
  type AgentTool,
  type ToolCaller,
  type ToolFiles,
} from "./services/agent/tools/index.js";
export * from "./services/agent/types.js";
export { getAttachmentBytes } from "./services/attachment-cache.js";
export { addDemoMailboxes } from "./services/demo-mailboxes.js";
export { errorReportsConfig, type ErrorReportsConfig } from "./services/error-reports.js";
export { KEYBINDINGS_FILE } from "./services/keybindings-store.js";
export { syncAllAccounts, turnedOffMailboxes } from "./services/mail-sync.js";
export {
  getSettings,
  onSettingsChanged,
  updateSettings,
  type AppSettings,
} from "./services/settings-store.js";
export type * from "./types.js";

export { signInWithSession, clearOtterSession } from "./services/otter-account.js";
