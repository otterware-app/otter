import type { ApprovalRequest, ChatQuestion } from "@otter-mail/contracts/chats";

/** "Allow Hermes to …?", as the web's approval card asks it. */
export function approvalQuestion(agent: string, approval: ApprovalRequest): string {
  switch (approval.kind) {
    case "command":
      return `Allow ${agent} to run this command?`;
    case "fileChange":
      return `Allow ${agent} to edit files?`;
    case "permission":
      return `Allow ${agent} to change its permissions?`;
    case "tool":
      return approval.title === "Tool approval" || !approval.title
        ? `Allow ${agent} to use a tool?`
        : `Allow ${agent} to ${approval.title[0]!.toLowerCase()}${approval.title.slice(1)}?`;
  }
}

/** Shown as code: a command, a file list, a permission. */
export const approvalIsCode = (approval: ApprovalRequest) => approval.kind !== "tool";

/** The line under it: why, or what a tool will do. */
export const approvalNote = (approval: ApprovalRequest) =>
  [approval.reason, approval.kind === "tool" ? approval.detail : undefined]
    .filter(Boolean)
    .join("\n");

export type QuestionItem = ChatQuestion["questions"][number];

/** What's picked and typed for each of a question's items, by item id. */
export type QuestionDraft = { chosen: Record<string, string[]>; own: Record<string, string> };

export const emptyDraft: QuestionDraft = { chosen: {}, own: {} };

export const asksSecret = (q: ChatQuestion) => q.questions.some((i) => i.secret);

/** One choice answers it at once: a single item, picked from, nothing secret. */
export const isQuick = (q: ChatQuestion) =>
  q.questions.length === 1 && !q.questions[0]!.multiSelect && !asksSecret(q);

export function answersOf(q: ChatQuestion, draft: QuestionDraft): Record<string, string[]> {
  return Object.fromEntries(
    q.questions.map((item) => {
      const typed = (draft.own[item.id] ?? "").trim();
      return [item.id, [...(draft.chosen[item.id] ?? []), ...(typed ? [typed] : [])]];
    }),
  );
}

export function isComplete(q: ChatQuestion, draft: QuestionDraft): boolean {
  if (asksSecret(q)) return false;
  const answers = answersOf(q, draft);
  return q.questions.every((item) => (answers[item.id]?.length ?? 0) > 0);
}

/** Picks (or, multi-select, toggles) an option; a quick question answers with it. */
export function choose(
  q: ChatQuestion,
  draft: QuestionDraft,
  item: QuestionItem,
  label: string,
): { draft: QuestionDraft; answer?: Record<string, string[]> } {
  if (isQuick(q)) return { draft, answer: { [item.id]: [label] } };
  const current = draft.chosen[item.id] ?? [];
  if (item.multiSelect) {
    const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    return { draft: { ...draft, chosen: { ...draft.chosen, [item.id]: next } } };
  }
  return {
    draft: {
      chosen: { ...draft.chosen, [item.id]: [label] },
      own: { ...draft.own, [item.id]: "" },
    },
  };
}

/** Typing an answer of one's own; for a pick-one item it replaces the pick. */
export function typeOwn(draft: QuestionDraft, item: QuestionItem, text: string): QuestionDraft {
  return {
    chosen: !item.multiSelect && text ? { ...draft.chosen, [item.id]: [] } : draft.chosen,
    own: { ...draft.own, [item.id]: text },
  };
}

/** A model's short name for the header, without its provider ("openai/gpt-5", "OpenAI: GPT-5" → "GPT-5"). */
export function shortModelName(name: string): string {
  return name
    .split("/")
    .pop()!
    .replace(/^[^:]+:\s+/, "");
}

/** "Fast" is the service tier its model offers by that name. */
export function fastChoice(
  options: { id: string; choices: { id: string; label: string }[] }[] | undefined,
): string | undefined {
  return options?.find((o) => o.id === "serviceTier")?.choices.find((c) => c.label === "Fast")?.id;
}

/** Chats matching a search, by title. */
export function matchesQuery(text: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || (text ?? "").toLowerCase().includes(q);
}
