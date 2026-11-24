import type { ChatTurnItem } from "@otter/contracts/chats";
import type { ToolStep } from "./api.ts";

export type StepItem = Extract<ChatTurnItem, { kind: "step" }>;

/** How a reply's work reads: its text, its steps, and the steps one integration ran in a row. */
export type WorkBlock =
  | { kind: "text"; text: string }
  | { kind: "step"; item: StepItem }
  | { kind: "group"; source: string; items: StepItem[] };

export function blocksOf(items: ChatTurnItem[]): WorkBlock[] {
  const blocks: WorkBlock[] = [];
  for (const item of items) {
    if (item.kind === "text") {
      blocks.push({ kind: "text", text: item.text });
      continue;
    }
    const last = blocks[blocks.length - 1];
    const source = item.step.source;
    // Back-to-back compactions (OpenClaw's transcript, then Codex's thread) are one to the reader.
    if (item.step.compaction && last?.kind === "step" && last.item.step.compaction)
      blocks[blocks.length - 1] = { kind: "step", item };
    else if (source && last?.kind === "group" && last.source === source) last.items.push(item);
    else if (source && last?.kind === "step" && last.item.step.source === source)
      blocks[blocks.length - 1] = { kind: "group", source, items: [last.item, item] };
    else blocks.push({ kind: "step", item });
  }
  return blocks;
}

/** A step's icon, by name (Lucide's): an integration's steps wear its command mark. */
export type StepIcon =
  | "terminal"
  | "file-text"
  | "file-pen-line"
  | "search"
  | "globe"
  | "wrench"
  | "command";

const STEP_ICONS: Record<ToolStep["kind"], StepIcon> = {
  command: "terminal",
  read: "file-text",
  edit: "file-pen-line",
  search: "search",
  web: "globe",
  skill: "wrench",
  tool: "wrench",
};

export const stepIcon = (step: ToolStep): StepIcon =>
  step.source ? "command" : STEP_ICONS[step.kind];

export const stepGroupTitle = (source: string) => `Used ${source} integration`;

/** A step opens to its result or its detail, when it has either. */
export const stepExpandable = (item: StepItem) => Boolean(item.output || item.step.detail);

/** It runs: the turn is still going and the step hasn't reported (a step of a finished turn never will). */
export const stepPending = (item: StepItem, live: boolean) => live && item.output === undefined;

/** A compaction's line: under way, failed (its output says why), or done. */
export function compactionLabel(output: string | undefined, live: boolean): string {
  if (live && output === undefined) return "Compacting context";
  return output ? "Context compaction failed" : "Context compacted";
}

/** Indents JSON that doesn't parse (the chat keeps only the start of long outputs). */
export function indentJson(text: string): string {
  let out = "";
  let depth = 0;
  let inString = false;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "{" || c === "[") {
      depth += 1;
      out += c + newline();
    } else if (c === "}" || c === "]") {
      depth = Math.max(0, depth - 1);
      out += newline() + c;
    } else if (c === ",") out += c + newline();
    else if (c === ":") out += ": ";
    else if (!/\s/.test(c)) out += c;
  }
  return out;
}

/** JSON laid out to read, or null for what isn't JSON. */
export function prettyJson(text: string | undefined): string | null {
  if (!text || !/^\s*[[{]/.test(text)) return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return indentJson(text.trim());
  }
}

/** JSON in pieces to color: its strings, its other values (numbers, true, false, null), and the rest. */
export function jsonTokens(json: string): { text: string; kind: "plain" | "string" | "value" }[] {
  const tokens: { text: string; kind: "plain" | "string" | "value" }[] = [];
  let last = 0;
  for (const match of json.matchAll(
    /"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  )) {
    const index = match.index ?? 0;
    if (index > last) tokens.push({ text: json.slice(last, index), kind: "plain" });
    const token = match[0];
    tokens.push({ text: token, kind: token.startsWith('"') ? "string" : "value" });
    last = index + token.length;
  }
  tokens.push({ text: json.slice(last), kind: "plain" });
  return tokens;
}
