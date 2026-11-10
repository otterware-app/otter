import { OTTER_TOOLS_SERVER, toolTitle } from "./tools/index.js";
import type { ToolStep } from "./types.js";

const DETAIL_CHARS = 2_000;

export const TOOL_OUTPUT_CHARS = 4_000;

export function sentence(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-\s]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

function titled(name: string): string {
  return sentence(name).replace(/\b\w/g, (c) => c.toUpperCase());
}

const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

function oneLine(text: string, max = 80): string {
  const line = text.trim().split("\n")[0];
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function argsDetail(args: unknown): string | undefined {
  if (args === undefined || args === null || args === "") return undefined;
  let value = args;
  if (typeof args === "string") {
    try {
      value = JSON.parse(args);
    } catch {
      return args.slice(0, DETAIL_CHARS);
    }
  }
  if (typeof value === "object" && Object.keys(value as object).length === 0) return undefined;
  return JSON.stringify(value).slice(0, DETAIL_CHARS);
}

const skillOf = (path: string) => path.match(/\/skills\/([^/]+)\/SKILL\.md$/i)?.[1];

export function commandStep(command: string): ToolStep {
  const skill = command.match(/\/skills\/([^/\s'"]+)\/SKILL\.md/i)?.[1];
  if (skill && /^\s*(cat|sed|head|less|bat|nl)\b/.test(command))
    return { kind: "skill", title: `Read ${titled(skill)} skill`, detail: command };
  return { kind: "command", title: `Ran ${oneLine(command)}`, detail: command };
}

export function readStep(path: string): ToolStep {
  const skill = skillOf(path);
  if (skill) return { kind: "skill", title: `Read ${titled(skill)} skill`, detail: path };
  return { kind: "read", title: `Read ${basename(path)}`, detail: path };
}

export function editStep(paths: string[]): ToolStep {
  return {
    kind: "edit",
    title: paths.length === 1 ? `Edited ${basename(paths[0])}` : `Edited ${paths.length} files`,
    detail: paths.join("\n"),
  };
}

function searchStep(pattern: string): ToolStep {
  return { kind: "search", title: `Searched for ${oneLine(pattern, 60)}`, detail: pattern };
}

function webSearchStep(query: string): ToolStep {
  return { kind: "web", title: "Searched the web", ...(query ? { detail: query } : {}) };
}

function fetchStep(url: string): ToolStep {
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // not a URL: show it as it is
  }
  return { kind: "web", title: `Read ${host}`, detail: url };
}

function skillStep(name: string): ToolStep {
  return { kind: "skill", title: `Used ${titled(name)} skill` };
}

export function mcpStep(server: string, tool: string, args: unknown): ToolStep {
  // Agents set up before the rename to Otter, and their transcripts, call it otter-mail.
  const ours = [OTTER_TOOLS_SERVER, "otter-mail"].includes(server.replace(/_/g, "-"));
  return {
    kind: "tool",
    title: (ours && toolTitle(tool)) || sentence(tool),
    source: ours ? "Otter" : titled(server),
    ...withDetail(argsDetail(args)),
  };
}

const withDetail = (detail: string | undefined) => (detail ? { detail } : {});

function genericStep(name: string, args: unknown): ToolStep {
  return { kind: "tool", title: sentence(name), ...withDetail(argsDetail(args)) };
}

export function claudeStep(name: string, input: Record<string, unknown>): ToolStep | null {
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "Bash":
      return commandStep(text("command"));
    case "Read":
      return readStep(text("file_path"));
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return editStep([text("file_path") || text("notebook_path")]);
    case "Grep":
    case "Glob":
      return searchStep(text("pattern"));
    case "WebSearch":
      return webSearchStep(text("query"));
    case "WebFetch":
      return fetchStep(text("url"));
    case "Skill":
      return skillStep(text("skill") || text("command"));
    case "Task":
    case "Agent":
      return { kind: "tool", title: "Ran a subagent", ...withDetail(text("description")) };
    case "TodoWrite":
      return { kind: "tool", title: "Updated the plan" };
    case "ToolSearch":
      return null;
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/);
  return mcp ? mcpStep(mcp[1], mcp[2], input) : genericStep(name, input);
}

type CodexItem = { type?: string } & Record<string, unknown>;

export function codexStep(item: CodexItem): ToolStep | null {
  switch (item.type) {
    case "commandExecution": {
      const actions = (item.commandActions ?? []) as {
        type?: string;
        command?: string;
        path?: string;
        query?: string;
      }[];
      const [action] = actions;
      if (actions.length === 1 && action.type === "read" && action.path)
        return readStep(action.path);
      if (actions.length === 1 && action.type === "search" && action.query)
        return searchStep(action.query);
      const command = action?.command ?? String(item.command ?? "command");
      return commandStep(command.replace(/^\/bin\/\w+ -l?c '(.*)'$/s, "$1"));
    }
    case "mcpToolCall":
      return mcpStep(String(item.server), String(item.tool), item.arguments);
    case "dynamicToolCall":
      return genericStep(String(item.tool ?? "tool"), item.arguments);
    case "webSearch":
      return webSearchStep(String(item.query ?? ""));
    case "fileChange":
      return editStep(
        ((item.changes ?? []) as { path?: string }[]).map((c) => c.path ?? "").filter(Boolean),
      );
    case "imageView":
      return { kind: "read", title: "Viewed an image", ...withDetail(item.path as string) };
    default:
      return null;
  }
}

export function hermesStep(name: string, args: unknown): ToolStep {
  let parsed: Record<string, unknown> = {};
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args) as Record<string, unknown>;
    } catch {
      // a preview, not JSON
    }
  } else if (args && typeof args === "object") parsed = args as Record<string, unknown>;
  const text = (key: string) => (typeof parsed[key] === "string" ? (parsed[key] as string) : "");
  // The session stream sends a preview of the input rather than JSON.
  const preview = typeof args === "string" && Object.keys(parsed).length === 0 ? args : "";
  switch (name) {
    case "terminal":
      if (text("command") || preview) return commandStep(text("command") || preview);
      break;
    case "read_file":
      if (text("path") || preview) return readStep(text("path") || preview);
      break;
    case "write_file":
    case "patch":
      if (text("path")) return editStep([text("path")]);
      break;
    case "search_files":
      return searchStep(text("pattern") || text("query"));
    case "web_search":
      return webSearchStep(text("query"));
    case "skill_view":
      if (text("name") || preview)
        return { kind: "skill", title: `Read ${titled(text("name") || preview)} skill` };
      break;
  }
  return genericStep(name, args);
}

export function openClawStep(name: string, args: unknown): ToolStep {
  // Runtimes that call OpenClaw's tools over MCP (claude-cli) name them with its server's prefix.
  if (name.startsWith("mcp__openclaw__"))
    return openClawStep(name.slice("mcp__openclaw__".length), args);
  const wrapped = args as { id?: unknown; args?: unknown } | null;
  if (name === "tool_call" && typeof wrapped?.id === "string")
    return openClawStep(wrapped.id, wrapped.args);
  const arg = (key: string) => {
    const value = (args as Record<string, unknown> | null)?.[key];
    return typeof value === "string" ? value : "";
  };
  const command = arg("command");
  if ((name === "bash" || name === "exec") && command)
    return commandStep(command.replace(/^(\S*\/)?bash -l?c /, "").replace(/^(['"])(.*)\1$/s, "$2"));
  const path = arg("path") || arg("file_path");
  if (name === "read" && path) return readStep(path);
  if ((name === "write" || name === "edit") && path) return editStep([path]);
  if (name === "web_search") return webSearchStep(arg("query"));
  if (name === "web_fetch" && arg("url")) return fetchStep(arg("url"));
  if (name === "sessions_spawn")
    return {
      kind: "tool",
      title: arg("label") ? `Started ${arg("label")}` : "Started a subagent",
      ...withDetail(arg("task")),
    };
  return genericStep(name, args);
}
