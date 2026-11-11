import { setSyncedPreference } from "../synced-preferences";
import { useId, useState, useSyncExternalStore } from "react";
import { ArrowUpIcon, ChevronDownIcon, PencilIcon, Redo2Icon, XIcon } from "lucide-react";
import { Btn, HintTooltip, IconBtn, cn } from "../mail/ui";
import { useShortcutLabel } from "../keybindings/store";
import type { QueuedMessage } from "./chat-store";

export type FollowUpBehavior = "queue" | "steer";

const FOLLOW_UP_KEY = "assistant:follow-up-behavior" as const;
const listeners = new Set<() => void>();

export function getFollowUpBehavior(): FollowUpBehavior {
  return localStorage.getItem(FOLLOW_UP_KEY) === "steer" ? "steer" : "queue";
}

export function setFollowUpBehavior(value: FollowUpBehavior): void {
  setSyncedPreference(FOLLOW_UP_KEY, value);
  for (const listener of listeners) listener();
}

window.addEventListener("storage", (event) => {
  if (event.key === FOLLOW_UP_KEY) for (const listener of listeners) listener();
});

export function useFollowUpBehavior(): FollowUpBehavior {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, getFollowUpBehavior);
}

const QUEUE_VISIBLE_ROWS = 3;

/**
 * The chat's queued messages at the end of its transcript, as T3 Code shows them: each in
 * full, dashed and unfilled until it's sent, with Send now, Edit and Remove under it.
 */
export function QueuedMessages({
  items,
  editingId,
  canSend,
  onSend,
  onEdit,
  onCancelEdit,
  onRemove,
}: {
  items: QueuedMessage[];
  editingId: string | null;
  /** A run is going that a message can join. */
  canSend: boolean;
  onSend: (id: string) => void;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onRemove: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const sendShortcut = useShortcutLabel("agent.sendQueuedNow");
  const editShortcut = useShortcutLabel("agent.editQueued");
  const listId = useId();
  if (items.length === 0) return null;
  const collapsible = items.length > QUEUE_VISIBLE_ROWS;
  const visible = collapsible && !showAll ? items.slice(0, QUEUE_VISIBLE_ROWS - 1) : items;

  return (
    <section
      aria-label={`${items.length} queued message${items.length === 1 ? "" : "s"}`}
      className="relative flex w-full flex-col gap-2 pb-4 pt-1"
    >
      <span className="sr-only" aria-live="polite">
        {items.length} queued
      </span>
      <ol id={listId} className="flex flex-col items-end gap-3">
        {visible.map((item, index) => {
          const isEditing = item.id === editingId;
          const text = `${item.skill ? `/${item.skill.name} ` : ""}${item.question}`.trim();
          return (
            <li
              key={item.id}
              aria-label={`Queued message ${index + 1} of ${items.length}, not sent`}
              aria-current={isEditing ? "true" : undefined}
              className="flex w-full flex-col items-end gap-1"
            >
              <div
                className={cn(
                  "flex min-w-0 max-w-[80%] flex-col gap-2 rounded-2xl border border-dashed px-3 py-2 text-sm leading-relaxed",
                  isEditing
                    ? "border-primary/60 text-foreground"
                    : "border-muted-foreground/40 text-muted-foreground",
                )}
              >
                {item.sent?.length ? (
                  <span className="flex flex-wrap items-center gap-1">
                    {item.sent.map((file) =>
                      file.thumb ? (
                        <img
                          key={file.name}
                          src={file.thumb}
                          alt={file.name}
                          className="size-8 rounded-md border border-border/70 object-cover"
                        />
                      ) : (
                        <span
                          key={file.name}
                          className="max-w-40 truncate rounded-md border border-border/70 px-1.5 py-0.5 text-xs"
                        >
                          {file.name}
                        </span>
                      ),
                    )}
                  </span>
                ) : null}
                {text ? <p className="whitespace-pre-wrap wrap-anywhere">{text}</p> : null}
              </div>
              <div className="flex items-center gap-0.5 pe-1 text-xs text-muted-foreground">
                {isEditing ? (
                  <>
                    <span className="px-1 text-foreground">Editing in the composer</span>
                    <Btn
                      size="xs"
                      variant="ghost"
                      aria-label="Cancel editing queued message"
                      onClick={onCancelEdit}
                    >
                      Cancel
                    </Btn>
                  </>
                ) : (
                  <>
                    {canSend ? (
                      <HintTooltip
                        label="Send into the current turn"
                        hint={index === 0 ? sendShortcut : undefined}
                      >
                        <Btn size="xs" variant="ghost-muted" onClick={() => onSend(item.id)}>
                          <ArrowUpIcon />
                          Send now
                        </Btn>
                      </HintTooltip>
                    ) : null}
                    <HintTooltip
                      label="Edit in the composer"
                      hint={index === items.length - 1 ? editShortcut : undefined}
                    >
                      <IconBtn
                        label="Edit queued message"
                        className="size-6"
                        onClick={() => onEdit(item.id)}
                      >
                        <PencilIcon className="size-3.5" />
                      </IconBtn>
                    </HintTooltip>
                    <HintTooltip label="Remove from queue">
                      <IconBtn
                        label="Remove queued message"
                        className="size-6"
                        onClick={() => onRemove(item.id)}
                      >
                        <XIcon className="size-3.5" />
                      </IconBtn>
                    </HintTooltip>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={showAll}
          aria-controls={listId}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setShowAll((value) => !value)}
          className="flex cursor-pointer items-center gap-1 self-end pe-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {showAll ? "Show fewer" : `Show all ${items.length} queued`}
          <ChevronDownIcon
            aria-hidden
            className={cn("size-3.5 transition-transform", showAll && "rotate-180")}
          />
        </button>
      ) : null}
    </section>
  );
}

export function IntentMarker({ intent }: { intent: "steer" | "promoted" }) {
  return (
    <HintTooltip
      label={
        intent === "promoted"
          ? "Originally queued, then promoted to steer the active turn"
          : "Steered the active turn"
      }
    >
      <div className="me-1 flex items-center justify-end gap-1 text-xs leading-none text-muted-foreground">
        <Redo2Icon aria-hidden className="size-3" />
        Steer
      </div>
    </HintTooltip>
  );
}
