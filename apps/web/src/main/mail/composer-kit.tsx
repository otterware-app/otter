import { TimePicker } from "./mail-schedule";
import { useCapabilities } from "./capabilities";
import { useState, type ReactNode } from "react";
import { PaperclipIcon, Trash2Icon } from "lucide-react";
import { matchesCommand } from "../keybindings/dispatch";
import { ShortcutText } from "../keybindings/store";
import type { DraftRemoteState, DraftSaveState } from "./use-draft-autosave";
import { normalizeAddressList } from "./address";
import { diffText } from "./text-diff";
import { htmlToText } from "./text";
import type { MessageDetail } from "./types";
import { HintTooltip } from "@otter/ui/components/tooltip";
import { Button, IconButton } from "@otter/ui/components/button";
import { Textarea } from "@otter/ui/components/textarea";
import { cn } from "@otter/ui/lib/utils";

export const COMPOSER_SURFACE =
  "rounded-3xl border border-(--chat-composer-outline) bg-(--chat-composer-surface) backdrop-blur-(--chat-composer-blur) shadow-composer transition-colors focus-within:border-input/70 dark:border-transparent dark:shadow-none dark:inset-shadow-2xs dark:inset-shadow-(color:--chat-composer-highlight) dark:focus-within:border-transparent";

export function ComposerCard({
  onSend,
  variant = "card",
  className,
  children,
}: {
  onSend: () => void;
  variant?: "card" | "plain";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex min-w-0 flex-col", variant === "card" && COMPOSER_SURFACE, className)}
      onKeyDown={(e) => {
        if ((e.target as Element).closest('[role="dialog"]')) return;
        if (matchesCommand(e.nativeEvent, "composer.send")) {
          e.preventDefault();
          onSend();
        }
      }}
    >
      {children}
    </div>
  );
}

export function ComposerField({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-start gap-3 border-b border-border/40 px-5 py-1 text-sm">
      <span className="flex h-8 w-14 shrink-0 items-center text-sm text-muted-foreground">
        {label}
      </span>
      <div className="flex min-h-8 min-w-0 flex-1 items-center">{children}</div>
      {trailing ? <div className="flex h-8 shrink-0 items-center gap-2">{trailing}</div> : null}
    </div>
  );
}

export function CcBccToggles({
  showCc,
  showBcc,
  onShowCc,
  onShowBcc,
}: {
  showCc: boolean;
  showBcc: boolean;
  onShowCc: () => void;
  onShowBcc: () => void;
}) {
  const toggle = "text-sm text-faint-foreground";
  return (
    <>
      {!showCc ? (
        <Button variant="ghost-muted" size="xs" className={toggle} onClick={onShowCc}>
          Cc
        </Button>
      ) : null}
      {!showBcc ? (
        <Button variant="ghost-muted" size="xs" className={toggle} onClick={onShowBcc}>
          Bcc
        </Button>
      ) : null}
    </>
  );
}

export function SubjectInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Textarea
      rows={1}
      value={value}
      onChange={(e) => {
        const field = e.target;
        // A pasted line break becomes a space. Written to the field before React
        // renders the value, the caret stays where the paste ended.
        if (/[\r\n]/.test(field.value)) {
          const caret = field.value.slice(0, field.selectionStart).replace(/[\r\n]+/g, " ");
          field.value = field.value.replace(/[\r\n]+/g, " ");
          field.setSelectionRange(caret.length, caret.length);
        }
        onChange(field.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) e.preventDefault();
      }}
      aria-label="Subject"
      className="min-h-0 flex-1 border-0 bg-transparent px-0 font-medium focus-visible:bg-transparent focus-visible:ring-0"
    />
  );
}

export type DraftVersionText = { to: string; cc?: string; subject: string; body: string };

const BANNER_ACTION = "font-medium hover:bg-warning/15";
const BANNER_CHOICE = "bg-warning/20 font-medium hover:bg-warning/30";

export function DraftRemoteBanner({
  remote,
  mine,
  onTakeTheirs,
  onKeepMine,
  onSaveAsNew,
}: {
  remote: DraftRemoteState | null;
  mine: DraftVersionText;
  onTakeTheirs: () => void;
  onKeepMine: () => void;
  onSaveAsNew: () => void;
}) {
  const [showDiff, setShowDiff] = useState(true);
  if (!remote) return null;
  return (
    <div className="border-b border-warning/30 bg-warning/10">
      <div role="status" className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
        <span className="min-w-0 flex-1 text-warning-foreground">
          {remote.kind === "conflict"
            ? "This draft was changed elsewhere while you were editing."
            : "This draft was sent or deleted elsewhere."}
        </span>
        {remote.kind === "conflict" ? (
          <>
            <Button
              variant="ghost-muted"
              size="xs"
              onClick={() => setShowDiff((v) => !v)}
              className={BANNER_ACTION}
            >
              {showDiff ? "Hide changes" : "Show changes"}
            </Button>
            <Button variant="ghost" size="xs" onClick={onTakeTheirs} className={BANNER_ACTION}>
              Use their version
            </Button>
            <Button variant="ghost" size="xs" onClick={onKeepMine} className={BANNER_CHOICE}>
              Keep mine
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="xs" onClick={onSaveAsNew} className={BANNER_CHOICE}>
            Keep as a new draft
          </Button>
        )}
      </div>
      {remote.kind === "conflict" && showDiff ? (
        <DraftDiff theirs={remote.detail} mine={mine} />
      ) : null}
    </div>
  );
}

const ADDED = "rounded-sm bg-success/15 text-success-foreground";
const REMOVED = "rounded-sm bg-destructive/15 text-destructive-foreground line-through";

/* oxlint-disable react/no-array-index-key -- Stateless spans represent an ordered diff snapshot. */
function DraftDiff({ theirs, mine }: { theirs: MessageDetail; mine: DraftVersionText }) {
  const theirBody = theirs.bodyText ?? (theirs.bodyHtml ? htmlToText(theirs.bodyHtml) : "");
  const fields = [
    { label: "Subject", theirs: theirs.subject ?? "", mine: mine.subject },
    {
      label: "To",
      theirs: normalizeAddressList(theirs.to ?? ""),
      mine: normalizeAddressList(mine.to),
    },
    {
      label: "Cc",
      theirs: normalizeAddressList(theirs.cc ?? ""),
      mine: normalizeAddressList(mine.cc ?? ""),
    },
  ].filter((f) => f.theirs.trim() !== f.mine.trim());
  const parts = diffText(theirBody.trim(), mine.body.trim());
  const changed = parts.some((p) => p.kind !== "same");
  return (
    <div className="te-scroll max-h-56 space-y-2 overflow-y-auto border-t border-warning/20 bg-canvas/60 px-4 py-3 text-xs leading-relaxed">
      <div className="flex items-center gap-3 text-2xs text-muted-foreground">
        <span>Keeping yours would change their version:</span>
        <span className={cn(ADDED, "px-1")}>your text</span>
        <span className={cn(REMOVED, "px-1")}>their text</span>
      </div>
      {fields.map((f) => (
        <div key={f.label} className="flex gap-2">
          <span className="w-14 shrink-0 text-muted-foreground">{f.label}</span>
          <span className="min-w-0">
            {f.theirs ? <span className={REMOVED}>{f.theirs}</span> : null}{" "}
            {f.mine ? <span className={ADDED}>{f.mine}</span> : null}
          </span>
        </div>
      ))}
      <p className="whitespace-pre-wrap text-foreground/90">
        {changed
          ? parts.map((part, i) =>
              part.kind === "same" ? (
                <span key={i}>{part.text}</span>
              ) : part.kind === "added" ? (
                <span key={i} className={ADDED}>
                  {part.text}
                </span>
              ) : (
                <span key={i} className={cn(REMOVED, "mr-0.5")}>
                  {part.text}
                </span>
              ),
            )
          : "The message text is the same."}
      </p>
    </div>
  );
}
/* oxlint-enable react/no-array-index-key */

export function draftStatus(draft: {
  saveState: DraftSaveState;
  remoteNotice: boolean;
}): string | null {
  if (draft.remoteNotice) return "Updated elsewhere";
  return draftStatusText(draft.saveState);
}

export function draftStatusText(state: DraftSaveState): string | null {
  if (state === "saving") return "Saving draft…";
  if (state === "saved") return "Draft saved";
  if (state === "error") return "Couldn't save draft. Retrying…";
  return null;
}

export function ComposerFooter({
  onAttach,
  attachDisabled,
  onDiscard,
  status,
  statusTone = "muted",
  accountId,
  canSend,
  onSend,
  onSchedule,
  className,
}: {
  onAttach: () => void;
  attachDisabled?: boolean;
  onDiscard: () => void;
  status?: ReactNode;
  statusTone?: "muted" | "error";
  accountId: string | null | undefined;
  canSend: boolean;
  onSend: () => void;
  onSchedule: (time: number) => Promise<unknown>;
  className?: string;
}) {
  const capabilities = useCapabilities(accountId);
  return (
    <div className={cn("flex items-center gap-1 px-3 py-2.5", className)}>
      <HintTooltip label="Attach files">
        <IconButton label="Attach files" size="icon" disabled={attachDisabled} onClick={onAttach}>
          <PaperclipIcon className="size-4" />
        </IconButton>
      </HintTooltip>
      <HintTooltip label="Discard draft">
        <IconButton
          label="Discard draft"
          size="icon"
          onClick={onDiscard}
          className="hover:text-destructive-foreground"
        >
          <Trash2Icon className="size-4" />
        </IconButton>
      </HintTooltip>
      {status ? (
        <span
          className={cn(
            "min-w-0 truncate pl-2 text-sm",
            statusTone === "error" ? "text-destructive-foreground" : "text-faint-foreground",
          )}
        >
          {status}
        </span>
      ) : null}
      <span className="flex-1" />
      <TimePicker
        title="Schedule send"
        onServer={capabilities.serverScheduledSend}
        disabled={!canSend}
        onChoose={onSchedule}
      />
      <Button
        variant="primary"
        onClick={onSend}
        disabled={!canSend}
        className="gap-2 rounded-full px-4 font-medium disabled:opacity-30 data-disabled:opacity-30"
      >
        Send
        <ShortcutText command="composer.send" className="text-body font-normal opacity-60" />
      </Button>
    </div>
  );
}

export function ComposeDocument({
  fields,
  editor,
  attachments,
  footer,
}: {
  fields: ReactNode;
  editor: ReactNode;
  attachments?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="te-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-2 pt-2">
          {fields}
          <div className="flex min-h-0 flex-1 flex-col">{editor}</div>
          {attachments}
        </div>
      </div>
      <div className="shrink-0 border-t border-border/40">
        <div className="mx-auto w-full max-w-3xl px-2">{footer}</div>
      </div>
    </div>
  );
}
