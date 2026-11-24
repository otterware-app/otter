import { CheckIcon, MessageCircleQuestionIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ChatQuestion } from "../mail/api";
import { COMPOSER_SURFACE } from "../mail/composer-kit";
import { Button } from "@otter/ui/components/button";
import { Input } from "@otter/ui/components/input";
import { cn } from "@otter/ui/lib/utils";
import { Kbd } from "@otter/ui/components/kbd";

export function QuestionCard({
  agent,
  question,
  pendingCount,
  responding,
  onAnswer,
}: {
  agent: string;
  question: ChatQuestion;
  pendingCount: number;
  responding: boolean;
  onAnswer: (answers: Record<string, string[]> | null) => void;
}) {
  const [chosen, setChosen] = useState<Record<string, string[]>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  const card = useRef<HTMLDivElement>(null);
  const secret = question.questions.some((q) => q.secret);
  const quick = question.questions.length === 1 && !question.questions[0].multiSelect && !secret;

  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) card.current?.focus();
  }, []);

  const answers = Object.fromEntries(
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

  return (
    <div
      ref={card}
      tabIndex={-1}
      role="group"
      aria-label={`${agent} asks`}
      onKeyDown={(event) => {
        if (responding) return;
        if (event.key === "Escape") {
          event.preventDefault();
          onAnswer(null);
        } else if (event.key === "Enter" && !event.shiftKey && complete) {
          event.preventDefault();
          onAnswer(answers);
        }
      }}
      className={cn("flex flex-col gap-3 px-4 pt-3.5 pb-3 outline-none", COMPOSER_SURFACE)}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <MessageCircleQuestionIcon className="size-3.5" aria-hidden />
        <span>{agent} asks</span>
        {pendingCount > 1 ? (
          <span className="ml-auto tabular-nums">1 of {pendingCount}</span>
        ) : null}
      </div>
      <div className="flex max-h-[45vh] min-w-0 flex-col gap-4 overflow-auto [scrollbar-width:thin]">
        {question.questions.map((q) => (
          <div key={q.id} className="flex flex-col gap-1.5">
            <p className="text-md leading-snug text-foreground">{q.question}</p>
            {q.secret ? (
              <p className="text-body text-muted-foreground">
                This asks for a secret, which only goes through {agent}&rsquo;s own app.
              </p>
            ) : (
              <>
                {q.multiSelect ? (
                  <p className="text-xs text-muted-foreground">Choose any that apply.</p>
                ) : null}
                <div className="flex flex-col gap-1">
                  {q.options.map((option) => {
                    const on = chosen[q.id]?.includes(option.label) ?? false;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role={q.multiSelect ? "checkbox" : "radio"}
                        aria-checked={on}
                        disabled={responding}
                        onClick={() => choose(q.id, option.label, q.multiSelect)}
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-body outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:opacity-64",
                          on
                            ? "border-primary/60 bg-primary/8"
                            : "border-border/70 hover:bg-accent-surface",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                            q.multiSelect ? "rounded" : "rounded-full",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border",
                          )}
                          aria-hidden
                        >
                          {on ? <CheckIcon className="size-3" /> : null}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <span className="text-foreground">{option.label}</span>
                          {option.description ? (
                            <span className="text-muted-foreground">{option.description}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Input
                  value={own[q.id] ?? ""}
                  disabled={responding}
                  placeholder="Or answer in your own words"
                  aria-label={`Your own answer to: ${q.question}`}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOwn((all) => ({ ...all, [q.id]: value }));
                    if (!q.multiSelect && value) setChosen((all) => ({ ...all, [q.id]: [] }));
                  }}
                  className="bg-transparent text-body focus-visible:bg-transparent"
                />
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button
          size="sm"
          disabled={responding}
          onClick={() => onAnswer(null)}
          className="rounded-pill pr-1.5"
        >
          Skip
          <Kbd>Esc</Kbd>
        </Button>
        {secret ? null : (
          <Button
            size="sm"
            disabled={responding || !complete}
            onClick={() => onAnswer(answers)}
            className="rounded-pill pr-1.5"
          >
            Answer
            <Kbd>↩</Kbd>
          </Button>
        )}
      </div>
    </div>
  );
}
