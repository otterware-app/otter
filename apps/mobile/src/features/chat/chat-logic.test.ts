import type { ApprovalRequest, ChatQuestion } from "@otter-mail/contracts/chats";
import { describe, expect, it } from "vite-plus/test";

import {
  answersOf,
  approvalNote,
  approvalQuestion,
  choose,
  emptyDraft,
  fastChoice,
  isComplete,
  shortModelName,
  typeOwn,
} from "./chat-logic";

const item = (id: string, multiSelect = false, secret = false) => ({
  id,
  header: id,
  question: `${id}?`,
  options: [{ label: "A" }, { label: "B" }],
  multiSelect,
  secret,
});
const question = (...items: ChatQuestion["questions"]): ChatQuestion => ({
  id: "q",
  questions: items,
  expiresAt: 0,
});

describe("approvals", () => {
  const tool: ApprovalRequest = {
    id: "1",
    kind: "tool",
    title: "Create a label",
    detail: "Work",
    choices: ["once", "session", "deny"],
  };

  it("asks in the web's words", () => {
    expect(approvalQuestion("Hermes", tool)).toBe("Allow Hermes to create a label?");
    expect(approvalQuestion("Hermes", { ...tool, title: "Tool approval" })).toBe(
      "Allow Hermes to use a tool?",
    );
    expect(approvalQuestion("OpenClaw", { ...tool, kind: "command" })).toBe(
      "Allow OpenClaw to run this command?",
    );
  });

  it("notes the reason, and a tool's detail", () => {
    expect(approvalNote({ ...tool, reason: "It asked" })).toBe("It asked\nWork");
    expect(approvalNote({ ...tool, kind: "command", detail: "ls" })).toBe("");
  });
});

describe("questions", () => {
  it("answers a single pick-one question with one tap", () => {
    const q = question(item("a"));
    expect(choose(q, emptyDraft, q.questions[0]!, "B").answer).toEqual({ a: ["B"] });
  });

  it("collects picks and typed answers until every item has one", () => {
    const q = question(item("a"), item("b", true));
    let draft = choose(q, emptyDraft, q.questions[0]!, "A").draft;
    expect(isComplete(q, draft)).toBe(false);
    draft = choose(q, draft, q.questions[1]!, "A").draft;
    draft = choose(q, draft, q.questions[1]!, "B").draft;
    draft = choose(q, draft, q.questions[1]!, "A").draft;
    draft = typeOwn(draft, q.questions[1]!, " mine ");
    expect(isComplete(q, draft)).toBe(true);
    expect(answersOf(q, draft)).toEqual({ a: ["A"], b: ["B", "mine"] });
  });

  it("replaces a pick-one item's pick with a typed answer, and the reverse", () => {
    const q = question(item("a"), item("b"));
    let draft = choose(q, emptyDraft, q.questions[0]!, "A").draft;
    draft = typeOwn(draft, q.questions[0]!, "other");
    expect(answersOf(q, draft).a).toEqual(["other"]);
    draft = choose(q, draft, q.questions[0]!, "B").draft;
    expect(answersOf(q, draft).a).toEqual(["B"]);
  });

  it("never completes a question that asks for a secret", () => {
    const q = question(item("a", false, true));
    expect(isComplete(q, typeOwn(emptyDraft, q.questions[0]!, "hunter2"))).toBe(false);
  });
});

describe("models", () => {
  it("shortens names to the model's own", () => {
    expect(shortModelName("anthropic/claude-sonnet")).toBe("claude-sonnet");
    expect(shortModelName("OpenAI: GPT-5")).toBe("GPT-5");
    expect(shortModelName("Fake Otter")).toBe("Fake Otter");
  });

  it("finds Fast among a model's service tiers", () => {
    expect(
      fastChoice([
        {
          id: "serviceTier",
          choices: [
            { id: "default", label: "Standard" },
            { id: "priority", label: "Fast" },
          ],
        },
      ]),
    ).toBe("priority");
    expect(fastChoice([])).toBeUndefined();
  });
});
