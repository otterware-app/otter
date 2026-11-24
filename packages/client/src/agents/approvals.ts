import type { ApprovalDecision, ApprovalRequest } from "./api.ts";

export const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** The files an approval to edit names, one path a line. */
export const approvalFiles = (approval: ApprovalRequest) =>
  approval.kind === "fileChange" ? (approval.detail ?? "").split("\n").filter(Boolean) : [];

/**
 * A list of files as a sentence names them: the first three by name ("a.ts, b.ts and c.ts"),
 * then how many more. `joiner` goes before each one shown after the first.
 */
export function fileList(paths: string[]): {
  shown: { path: string; name: string; joiner: string }[];
  more: number;
} {
  const shown = paths.slice(0, 3);
  return {
    shown: shown.map((path, i) => ({
      path,
      name: basename(path),
      joiner: i === 0 ? "" : i === shown.length - 1 && paths.length <= 3 ? " and " : ", ",
    })),
    more: Math.max(0, paths.length - 3),
  };
}

/** What an approval asks you, with the files it edits named. */
export function approvalQuestion(agent: string, approval: ApprovalRequest): string {
  switch (approval.kind) {
    case "command":
      return `Allow ${agent} to run this command?`;
    case "fileChange": {
      const paths = approvalFiles(approval);
      if (paths.length === 0) return `Allow ${agent} to edit files?`;
      const { shown, more } = fileList(paths);
      const names = shown.map((f) => f.joiner + f.name).join("");
      return `Allow ${agent} to edit ${names}${more ? ` and ${more} more` : ""}?`;
    }
    case "permission":
      return `Allow ${agent} to change its permissions?`;
    case "tool":
      return approval.title === "Tool approval"
        ? `Allow ${agent} to use a tool?`
        : `Allow ${agent} to ${approval.title[0]!.toLowerCase()}${approval.title.slice(1)}?`;
  }
}

/** What an approval says of itself under the question: why, and for a tool, what it's given. */
export const approvalNote = (approval: ApprovalRequest) =>
  [approval.reason, approval.kind === "tool" ? approval.detail : undefined]
    .filter(Boolean)
    .join("\n");

/** Its detail is code to show as it is: a command, or permissions. */
export const approvalShowsCode = (approval: ApprovalRequest) =>
  (approval.kind === "command" || approval.kind === "permission") && Boolean(approval.detail);

/**
 * The answers beside Allow once and Deny: for this chat or always, when the agent offers them,
 * and stopping it.
 */
export function approvalMore(approval: ApprovalRequest): {
  label: string;
  decision: Extract<ApprovalDecision, "session" | "always"> | "stop";
}[] {
  return [
    ...(approval.choices.includes("session")
      ? [{ label: "Allow for this chat", decision: "session" as const }]
      : []),
    ...(approval.choices.includes("always")
      ? [{ label: "Always allow", decision: "always" as const }]
      : []),
    { label: "Stop the agent", decision: "stop" as const },
  ];
}
