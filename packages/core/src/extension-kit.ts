export type { CoreExtension, ExtensionContext } from "./extensions.js";
export { extensionManifest, type ExtensionManifest } from "@otter/contracts/extensions";

export type {
  AgentSettings,
  AgentSettingsView,
  ChatFile,
  ProvidersState,
  ProviderSnapshot,
  ResumeTurnInput,
  RuntimeMode,
  SendTurnInput,
  ToolStep,
} from "./services/agent/types.js";
export {
  agentSettings,
  providersState,
  refreshProvider,
  saveAgentSettings,
  updateProviderSettings,
} from "./services/agent/service.js";
export {
  clearOpenClawToken,
  setHermesKey,
  setOpenClawBootstrapToken,
  setOpenClawToken,
} from "./services/agent/settings.js";
export { onOtterAccountChange } from "./services/otter-account.js";
export { deleteAgentChannel, makeAgentChannel } from "./services/agent/channels.js";
export { preferenceChanged } from "./services/preferences.js";

export { fromBase64, sha256Hex, toBase64, utf8Decode, utf8Encode } from "./bytes.js";
export { readJson, writeJson } from "./json-file.js";
export { runAsTask } from "./handlers/ipc-budget.js";
export { broadcast, handle, registeredHandlers } from "./ipc.js";
export { logger } from "./logger.js";
export { platform, setPlatform } from "./platform.js";
export type { LanguageDetection, Platform, TranslationResult } from "./platform.js";
export { providerFor } from "./providers/index.js";
export { NoCalendarAccess } from "./providers/provider.js";
export type { RsvpResponse } from "./providers/provider.js";
export { getAccount, listAccounts } from "./services/account-store.js";
export {
  ATTACHMENTS_DIR,
  dataUrl,
  readAttachment,
  stageAttachment,
} from "./services/agent/attachments.js";
export { chatFile, chatFilePath, downloadChatFile } from "./services/agent/files.js";
export {
  clearOpenClawBootstrapToken,
  clearOpenClawDeviceToken,
  getHermesKey,
  getOpenClawBootstrapToken,
  getOpenClawDeviceKey,
  getOpenClawDeviceToken,
  getOpenClawToken,
  setOpenClawDeviceKey,
  setOpenClawDeviceToken,
} from "./services/agent/settings.js";
export {
  TOOL_OUTPUT_CHARS,
  claudeStep,
  codexStep,
  hermesStep,
  openClawStep,
  sentence,
} from "./services/agent/steps.js";
export { TextStream } from "./services/agent/text-stream.js";
export { agentTools, cancelToolApprovals, runAgentTool } from "./services/agent/tools/index.js";
export type { ToolCaller, ToolFiles } from "./services/agent/tools/index.js";
export type {
  AgentRun,
  ApprovalDecision,
  ApprovalRequest,
  BrowserEvents,
  BrowserInput,
  BrowserView,
  BrowserViewRequest,
  ChatAttachment,
  ChatEvent,
  ChatProvider,
  ChatQuestion,
  ChatSession,
  ChatSessionMessage,
  Emit,
  ForkPoint,
  ProviderModel,
  ProviderModelOption,
  ProviderSettings,
  ScheduleSupport,
  Skill,
  TalkEvent,
  TalkStart,
  TalkSupport,
  WatchedSession,
} from "./services/agent/types.js";
export { getAttachmentData } from "./services/attachment-cache.js";
export * as mailStore from "./services/mail-store.js";
export { getMessageLabelIds } from "./services/mail-store.js";
export { getOtterUser, getSessionToken } from "./services/otter-account.js";
export { buildMime, formatAddress } from "./services/outgoing.js";
export { getSettings, updateSettings } from "./services/settings-store.js";
export type { AppSettings } from "./services/settings-store.js";
