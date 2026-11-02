import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { mailApi } from "../mail/api";
import type { ContactSuggestion } from "../mail/types";
import { Kbd, cn } from "../mail/ui";
import { useCalendar, type Teammate } from "./calendar-store";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ⌘P: someone whose calendar to show over yours, from your contacts or by address. */
export function TeamPicker({ onClose }: { onClose: () => void }) {
  const addTeammate = useCalendar((s) => s.addTeammate);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ContactSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      mailApi
        .suggestContacts({ q: query.trim(), limit: 8 })
        .then((list) => {
          if (live) setFound(list);
        })
        .catch(() => {
          if (live) setFound([]);
        });
    }, 80);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const typed = query.trim();
  const options: Teammate[] = [
    ...found.map((c) => ({ email: c.email, name: c.name || c.email })),
    ...(EMAIL.test(typed) && !found.some((c) => c.email.toLowerCase() === typed.toLowerCase())
      ? [{ email: typed, name: typed }]
      : []),
  ];
  const at = Math.min(highlight, Math.max(options.length - 1, 0));
  const pick = (teammate: Teammate | undefined) => {
    if (!teammate) return;
    addTeammate(teammate);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex justify-center bg-black/20 pt-[18vh]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Show a teammate's calendar"
        className="flex h-fit w-[520px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-border/70 text-foreground shadow-[0_24px_60px_-20px_rgb(0_0_0/55%)] animate-calendar-pop [background:linear-gradient(var(--popover),var(--popover)),var(--canvas)]"
      >
        <div className="flex h-12 items-center gap-3 px-4">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            placeholder="Show a teammate's calendar…"
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setHighlight((h) => Math.max(h - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(options[at]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-placeholder"
          />
        </div>
        {options.length ? (
          <div className="flex max-h-72 flex-col gap-px overflow-y-auto border-t border-border/60 p-1.5">
            {options.map((option, i) => (
              <button
                key={option.email}
                type="button"
                onPointerEnter={() => setHighlight(i)}
                onClick={() => pick(option)}
                className={cn(
                  "flex h-9 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm outline-none",
                  i === at && "bg-foreground/[0.07]",
                )}
              >
                <span className="min-w-0 max-w-[60%] shrink-0 truncate font-medium">
                  {option.name}
                </span>
                {option.name !== option.email ? (
                  <span className="min-w-0 truncate text-muted-foreground">{option.email}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex h-9 items-center gap-4 border-t border-border/60 px-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Kbd>↑↓</Kbd> Navigate
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd> Select
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
