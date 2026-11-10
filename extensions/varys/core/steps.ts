import { sentence, type ToolStep } from "@otter/core/extension-kit";

function varysKind(tool: string): ToolStep["kind"] {
  if (tool === "read_skill" || tool === "run_skill_script") return "skill";
  if (tool.startsWith("browser") || tool === "web_search" || tool === "fetch") return "web";
  if (tool === "bash") return "command";
  if (tool === "read" || tool.endsWith("_read")) return "read";
  if (tool === "write" || tool === "edit") return "edit";
  if (tool === "grep" || tool === "find" || tool.endsWith("_search")) return "search";
  return "tool";
}

/** A varys tool call, titled with varys's own one-line summary of what it does. */
export function varysStep(call: { tool: string; summary?: string; detail?: string }): ToolStep {
  return {
    kind: varysKind(call.tool),
    title: call.summary || sentence(call.tool),
    ...(call.detail ? { detail: call.detail.slice(0, 2_000) } : {}),
  };
}
