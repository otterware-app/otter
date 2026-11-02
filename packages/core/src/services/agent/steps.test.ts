import { describe, expect, it } from "vite-plus/test";

import { claudeStep, codexStep, hermesStep } from "./steps.ts";

describe("tool steps", () => {
  it("names Otter Mail's tools by their titles, whichever agent calls them", () => {
    const expected = {
      kind: "tool",
      title: "Search mail",
      source: "Otter Mail",
      detail: '{"query":"from:unid.be"}',
    };
    expect(claudeStep("mcp__otter-mail__search_mail", { query: "from:unid.be" })).toEqual(expected);
    expect(
      codexStep({
        type: "mcpToolCall",
        server: "otter-mail",
        tool: "search_mail",
        arguments: { query: "from:unid.be" },
      }),
    ).toEqual(expected);
  });

  it("groups other integrations under their own name", () => {
    expect(claudeStep("mcp__linear__create_issue", {})).toEqual({
      kind: "tool",
      title: "Create issue",
      source: "Linear",
    });
  });

  it("reads reading a skill's instructions as reading the skill", () => {
    const skill = "Read Chris Google Accounts skill";
    expect(
      claudeStep("Read", { file_path: "/Users/c/.claude/skills/chris-google-accounts/SKILL.md" })
        ?.title,
    ).toBe(skill);
    expect(
      codexStep({
        type: "commandExecution",
        command: "/bin/zsh -lc 'cat /Users/c/.codex/skills/chris-google-accounts/SKILL.md'",
        commandActions: [
          { type: "unknown", command: "cat /Users/c/.codex/skills/chris-google-accounts/SKILL.md" },
        ],
      })?.title,
    ).toBe(skill);
    expect(hermesStep("skill_view", "chris-google-accounts").title).toBe(skill);
  });

  it("shows commands without Codex's shell wrapper", () => {
    expect(codexStep({ type: "commandExecution", command: "/bin/zsh -lc 'git status'" })).toEqual({
      kind: "command",
      title: "Ran git status",
      detail: "git status",
    });
    expect(claudeStep("Bash", { command: "git status" })?.title).toBe("Ran git status");
    expect(hermesStep("terminal", '{"command":"git status"}').title).toBe("Ran git status");
  });

  it("leaves out Claude's own bookkeeping and messages that aren't steps", () => {
    expect(claudeStep("ToolSearch", { query: "select:mcp__otter-mail__search_mail" })).toBeNull();
    expect(codexStep({ type: "agentMessage", text: "Hi" })).toBeNull();
  });
});
