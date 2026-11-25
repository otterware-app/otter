export type { CoreExtension, ExtensionContext } from "./extensions.ts";
export { extensionManifest, type ExtensionManifest } from "@otter/contracts/extensions";

export type {
  AgentContext,
  AgentId,
  AgentSecrets,
  AgentSettings,
  AgentSettingsView,
  AgentType,
  ChatFile,
  CheckedStatus,
  ProvidersState,
  ProviderSnapshot,
  ResumeTurnInput,
  RuntimeMode,
  SendTurnInput,
  ToolStep,
} from "./services/agent/types.ts";
export {
  agentProvider,
  agentSettings,
  providersState,
  refreshProvider,
  saveAgentSettings,
  updateProviderSettings,
} from "./services/agent/service.ts";
export { onOtterAccountChange } from "./services/otter-account.ts";
export { deleteAgentChannel, makeAgentChannel } from "./services/agent/channels.ts";

export { fromBase64, sha256Hex, toBase64, utf8Decode, utf8Encode } from "./bytes.ts";
export { readJson, writeJson } from "./json-file.ts";
export { runAsTask } from "./handlers/ipc-budget.ts";
export { broadcast, handle, registeredHandlers } from "./ipc.ts";
export { logger } from "./logger.ts";
export { platform, setPlatform } from "./platform.ts";
export type { LanguageDetection, Platform, TranslationResult } from "./platform.ts";
export { providerFor } from "./providers/index.ts";
export { NoCalendarAccess } from "./providers/provider.ts";
export type { RsvpResponse } from "./providers/provider.ts";
export { getAccount, listAccounts } from "./services/account-store.ts";
export {
  ATTACHMENTS_DIR,
  dataUrl,
  readAttachment,
  stageAttachment,
} from "./services/agent/attachments.ts";
export { chatFile, chatFilePath, downloadChatFile } from "./services/agent/files.ts";
export {
  TOOL_OUTPUT_CHARS,
  claudeStep,
  codexStep,
  hermesStep,
  openClawStep,
  sentence,
} from "./services/agent/steps.ts";
export { TextStream } from "./services/agent/text-stream.ts";
export {
  agentToolNames,
  agentTools,
  cancelToolApprovals,
  hostsTools,
  runAgentTool,
} from "./services/agent/tools/index.ts";
export { REMOTE_TOOL_INSTRUCTIONS } from "./services/agent/instructions.ts";
export type { ToolCaller, ToolFiles } from "./services/agent/tools/index.ts";
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
} from "./services/agent/types.ts";
export { getAttachmentData } from "./services/attachment-cache.ts";
export * as mailStore from "./services/mail-store.ts";
export { getMessageLabelIds } from "./services/mail-store.ts";
export { getOtterUser, getSessionToken } from "./services/otter-account.ts";
export { buildMime, formatAddress } from "./services/outgoing.ts";
export { getSettings, updateSettings } from "./services/settings-store.ts";
export type { AppSettings } from "./services/settings-store.ts";
