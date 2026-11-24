import { useState } from "react";
import type { ChatQuestion } from "./api.ts";

export type Answers = Record<string, string[]>;

/**
 * Answering an agent's question: options chosen and words of your own for each of its questions.
 * One question with one answer and no secret is answered as soon as an option is chosen. A
 * secret only goes through the agent's own app: it can be skipped, not answered here.
 */
export function useQuestionAnswers(
  question: ChatQuestion,
  onAnswer: (answers: Answers | null) => void,
) {
  const [chosen, setChosen] = useState<Answers>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  const secret = question.questions.some((q) => q.secret);
  const quick = question.questions.length === 1 && !question.questions[0].multiSelect && !secret;

  const answers: Answers = Object.fromEntries(
    question.questions.map((q) => {
      const typed = own[q.id]?.trim();
      return [q.id, [...(chosen[q.id] ?? []), ...(typed ? [typed] : [])]];
    }),
  );
  const complete = !secret && question.questions.every((q) => answers[q.id].length > 0);

  const choose = (id: string, label: string, multi: boolean) => {
    if (quick) return onAnswer({ [id]: [label] });
    setChosen((all) => {
      const current = all[id] ?? [];
      const next = multi
        ? current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
        : [label];
      return { ...all, [id]: next };
    });
    if (!multi) setOwn((all) => ({ ...all, [id]: "" }));
  };

  /** Your own words take the place of an option where only one answer goes. */
  const type = (id: string, value: string, multi: boolean) => {
    setOwn((all) => ({ ...all, [id]: value }));
    if (!multi && value) setChosen((all) => ({ ...all, [id]: [] }));
  };

  return {
    chosen,
    own,
    answers,
    complete,
    secret,
    choose,
    type,
    isChosen: (id: string, label: string) => chosen[id]?.includes(label) ?? false,
  };
}
