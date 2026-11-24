import { describe, expect, it } from "vite-plus/test";
import type { Skill } from "./api.ts";
import {
  composeOutgoing,
  composerHasContent,
  skillCommand,
  slashQuery,
  slashSkills,
  submitLabel,
  submitMode,
} from "./composer.ts";

const skill = (name: string): Skill => ({ name, description: "", category: null });
const skills = [skill("review"), skill("plan"), skill("pr-review")];

describe("skills", () => {
  it("takes a skill's command typed with a space as the skill", () => {
    expect(skillCommand("/Review the diff", skills)).toEqual({
      skill: skills[0],
      rest: "the diff",
    });
    expect(skillCommand("/review", skills)).toBeNull();
    expect(skillCommand("/nope it", skills)).toBeNull();
  });

  it("lists skills for what's typed after /", () => {
    expect(slashQuery("/Rev")).toBe("rev");
    expect(slashQuery("/rev it")).toBeNull();
    expect(slashQuery("hi")).toBeNull();
    expect(slashSkills(skills, "rev").map((s) => s.name)).toEqual(["review", "pr-review"]);
    expect(slashSkills(skills, null)).toEqual([]);
  });
});

describe("sending", () => {
  it("sends with no run; follows your follow-up behavior, or its opposite, while one goes", () => {
    const base = { running: true, compacting: false, followUp: "queue", alternate: false } as const;
    expect(submitMode({ ...base, running: false })).toBe("send");
    expect(submitMode(base)).toBe("queue");
    expect(submitMode({ ...base, alternate: true })).toBe("steer");
    expect(submitMode({ ...base, followUp: "steer" })).toBe("steer");
    expect(submitMode({ ...base, followUp: "steer", compacting: true })).toBe("queue");
    expect(submitLabel("steer", false)).toBe("Steer message");
    expect(submitLabel("steer", true)).toBe("Update queued message");
  });

  it("has something to send: words, a skill, files or quotes", () => {
    const empty = { draft: "  ", skill: null, files: 0, citations: 0 };
    expect(composerHasContent(empty)).toBe(false);
    expect(composerHasContent({ ...empty, files: 1 })).toBe(true);
    expect(composerHasContent({ ...empty, skill: skills[1] })).toBe(true);
  });

  it("titles a message by its skill, words, quote, then its first file", () => {
    const send = (over: Partial<Parameters<typeof composeOutgoing>[0]>) =>
      composeOutgoing({
        convoId: "c",
        agentId: "a",
        draft: "",
        skill: null,
        citations: [],
        staged: [],
        sent: [],
        attached: null,
        mailReader: undefined,
        ...over,
      });
    expect(send({ draft: " Hi ", skill: skills[1] })).toMatchObject({
      title: "/plan Hi",
      question: "Hi",
      input: "Hi",
    });
    expect(send({ citations: [{ id: "q", text: "quoted", comment: "why?" }] }).title).toBe("why?");
    expect(send({ sent: [{ name: "a.pdf", kind: "file", size: 1 }] })).toMatchObject({
      title: "a.pdf",
      sent: [{ name: "a.pdf" }],
      attachments: undefined,
    });
    expect(send({}).title).toBe("Attachment");
    expect(send({ citations: [{ id: "q", text: "line" }], draft: "Look" }).input).toContain(
      "> line",
    );
  });
});
