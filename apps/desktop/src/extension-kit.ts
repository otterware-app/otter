/**
 * What extensions' desktop halves may use of the desktop backend
 * (`@otter-mail/desktop/extension-kit`, an alias: the desktop app depends on
 * the extensions, not the other way round). Claude and Codex build on it: the
 * local agents' workspace and attachments, Otter Mail's MCP server, the login
 * shell's PATH.
 */

export { logger } from "./logger.js";
export { AGENT_INSTRUCTIONS } from "./services/agent/instructions.js";
export {
  agentWorkspace,
  attachmentPath,
  attachmentsDir,
  readAgentFile,
  withAttachmentPaths,
} from "./services/agent/local.js";
export { MCP_SERVER_NAME, toolAccess, type ToolAccess } from "./services/agent/mcp-server.js";
export { ensureShellPath } from "./services/agent/shell-path.js";
