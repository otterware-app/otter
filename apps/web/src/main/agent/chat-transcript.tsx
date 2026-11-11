import { useEffect, useState, type ReactNode } from "react";
import { MessageScroller, useMessageScroller } from "@shadcn/react/message-scroller";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  FilePenLineIcon,
  GitForkIcon,
  LayersIcon,
  MailIcon,
  Minimize2Icon,
  RotateCcwIcon,
  SendIcon,
  TextQuoteIcon,
  XIcon,
} from "lucide-react";
import { IconBtn, HintTooltip, cn } from "../mail/ui";
import { CompactionRow, WorkLog, isCompaction, type TurnItem } from "./work-log";
import type { ChatChange } from "../mail/api";
import type { ContextKind, ContextMeta } from "./chat-context";
import { findTokenRanges, messageTokens } from "@otter/shared/chat-search";
import { retryTurn, runReplyIds, useChats, type ChatTurn } from "./chat-store";
import { Button } from "~/components/ui/button";
import { ChatMarkdown } from "./chat-markdown";
import { messageTime } from "./chat-time";
import { ChatChanges } from "./chat-changes";
import { SentAttachments } from "./chat-attachments";
import { IntentMarker } from "./chat-queue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../mail/menu";
import { toast } from "../mail/toast";

export function ContextKindIcon({ kind, className }: { kind: ContextKind; className?: string }) {
  const Icon =
    kind === "quote"
      ? TextQuoteIcon
      : kind === "draft"
        ? FilePenLineIcon
        : kind === "sent"
          ? SendIcon
          : kind === "mixed"
            ? LayersIcon
            : MailIcon;
  return <Icon className={className} />;
}

export function SkillBadge({
  name,
  onRemove,
  onAccent,
}: {
  name: string;
  onRemove?: () => void;
  onAccent?: boolean;
}) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold",
        onAccent ? "bg-foreground/8 text-foreground" : "bg-primary/10 text-primary",
      ].join(" ")}
    >
      <span className="opacity-50">/</span>
      {name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove skill"
          className="opacity-70 hover:opacity-100"
        >
          <XIcon className="size-3" />
        </button>
      ) : null}
    </span>
  );
}

function ContextRecap({
  context,
  onOpen,
}: {
  context: ContextMeta;
  onOpen: (item: { title: string; target: ChatChange["target"] }) => void;
}) {
  const label =
    context.count > 1
      ? `${context.count} conversations`
      : (context.subjects[0] ?? "1 conversation");
  const items = context.items ?? [];
  const chipClass =
    "flex max-w-64 items-center gap-1.5 rounded-sm border border-border px-2 py-0.5 text-2xs font-medium text-muted-foreground";
  return (
    <div className="mb-1 flex justify-end">
      {items.length === 1 ? (
        <button
          type="button"
          onClick={() => onOpen(items[0])}
          title={items[0].title}
          aria-label={`Open context: ${items[0].title}`}
          className={`${chipClass} cursor-pointer hover:bg-accent-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring`}
        >
          <ContextKindIcon kind={context.kind} className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </button>
      ) : items.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={`${chipClass} cursor-pointer hover:bg-accent-surface hover:text-foreground`}
              aria-label={`Open ${label}`}
            >
              <ContextKindIcon kind={context.kind} className="size-3 shrink-0" />
              <span>{label}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {items.map((item) => (
              <DropdownMenuItem key={JSON.stringify(item)} onSelect={() => onOpen(item)}>
                {item.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className={chipClass}>
          <ContextKindIcon kind={context.kind} className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{label}</span>
        </span>
      )}
    </div>
  );
}

/** A turn no message of yours started: a scheduled task's result, or a message the agent sent. */
function DeliveryRow({ turn }: { turn: ChatTurn }) {
  const delivered = turn.delivered;
  if (!delivered) return null;
  const at = turn.startedAt
    ? new Date(turn.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;
  const automation = delivered.kind === "automation";
  const label = automation
    ? ["Scheduled", delivered.name, at].filter(Boolean).join(" · ")
    : [delivered.from ? `Sent by ${delivered.from}` : "Sent to you", at]
        .filter(Boolean)
        .join(" · ");
  const Icon = automation ? ClockIcon : SendIcon;
  const row = (
    <div className="flex min-w-0 items-center gap-1.5 px-1 pt-2 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </div>
  );
  return automation && delivered.schedule ? (
    <HintTooltip label={delivered.schedule}>{row}</HintTooltip>
  ) : (
    row
  );
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m ${total % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function WorkingTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <>{formatDuration(now - startedAt)}</>;
}

/** `compacting`: the agent compacts its context before it starts on your message. */
function WorkingRow({ startedAt, compacting }: { startedAt?: number; compacting: boolean }) {
  const verb = compacting ? "Compacting" : "Working";
  return (
    <div className="border-b border-border/40 pb-2 pt-1">
      <div className="flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums">
        <span className="relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-shimmer">
          {compacting ? <Minimize2Icon aria-hidden className="size-3 shrink-0" /> : null}
          {startedAt ? (
            <span>
              {verb} for <WorkingTimer startedAt={startedAt} />
            </span>
          ) : (
            `${verb}…`
          )}
        </span>
      </div>
    </div>
  );
}

function DetachedRow({ providerName }: { providerName: string }) {
  return (
    <div className="border-b border-border/40 pb-2 pt-1">
      <div className="flex h-6 min-w-0 items-baseline px-1 text-sm leading-relaxed text-muted-foreground">
        Lost {providerName} mid-reply. The rest shows here once it's back.
      </div>
    </div>
  );
}

function WorkFoldRow({
  label,
  expanded,
  onToggle,
}: {
  label: ReactNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Icon = expanded ? ChevronDownIcon : ChevronRightIcon;
  return (
    <div className="relative flex items-center gap-1 border-b border-border/40 pb-2 pe-0.5 pt-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-sm leading-relaxed text-muted-foreground tabular-nums hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring/70"
      >
        <span>{label}</span>
        <Icon className="size-3.5 opacity-70" />
      </button>
    </div>
  );
}

function ErrorRow({
  message,
  providerName,
  onRetry,
}: {
  message: string;
  providerName: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col px-0.5 py-1">
      <div className="flex items-center gap-1.5">
        <span className="flex size-6 shrink-0 items-center justify-center text-destructive">
          <CircleAlertIcon className="size-4 stroke-2" aria-hidden />
        </span>
        <span className="text-sm font-medium leading-relaxed text-destructive">
          {providerName} error
        </span>
      </div>
      <p className="ms-7 select-text text-sm leading-relaxed text-foreground/80">{message}</p>
      {onRetry ? (
        <div className="ms-7 pb-1 pt-1.5">
          <Button type="button" size="xs" variant="outline" onClick={onRetry}>
            <RotateCcwIcon aria-hidden />
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function MessageTime({ at }: { at: number | undefined }) {
  if (!at) return null;
  return (
    <HintTooltip label={new Date(at).toLocaleString([], { dateStyle: "full", timeStyle: "short" })}>
      <span className="px-1 text-xs text-muted-foreground tabular-nums opacity-0 transition-opacity group-hover:opacity-100">
        {messageTime(at)}
      </span>
    </HintTooltip>
  );
}

function CopyMessageButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <HintTooltip label={copied ? "Copied" : "Copy message"}>
      <IconBtn
        label={copied ? "Copied" : "Copy message"}
        className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(
            () => setCopied(true),
            () => toast.error("Couldn't copy message"),
          );
        }}
      >
        {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
      </IconBtn>
    </HintTooltip>
  );
}

/** Marks the query's words in a message, as Otter Code's find does for a search result. */
function highlightFound(turnId: string, query: string): (() => void) | undefined {
  const message = document.querySelector(`[data-message-id="${CSS.escape(turnId)}"]`);
  if (!message || !("highlights" in CSS)) return;
  const tokens = messageTokens(query);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const { start, end } of findTokenRanges(node.textContent ?? "", tokens)) {
      const range = new Range();
      range.setStart(node, start);
      range.setEnd(node, end);
      ranges.push(range);
    }
  }
  const highlight = new Highlight(...ranges);
  CSS.highlights.set("chat-found", highlight);
  return () => {
    if (CSS.highlights.get("chat-found") === highlight) CSS.highlights.delete("chat-found");
  };
}

const shownItems = (turn: ChatTurn | undefined): TurnItem[] =>
  (turn?.items ?? []).filter((item) => item.kind === "step" || item.text.trim());

const isSteer = (turn: ChatTurn | undefined) =>
  turn?.role === "user" && (turn.intent === "steer" || turn.intent === "promoted");

/** How many compactions a reply opens with: those ran before the agent read your message. */
function openingCompactions(items: TurnItem[]): number {
  const at = items.findIndex((item) => !isCompaction(item));
  return at < 0 ? items.length : at;
}

export function ChatTranscript({
  turns,
  streaming,
  detached,
  providerName,
  onOpenFile,
  loadImage,
  onOpenContext,
  onOpenChange,
  onFork,
}: {
  turns: ChatTurn[];
  streaming: boolean;
  detached: boolean;
  providerName: string;
  onOpenFile: (href: string) => void;
  loadImage: (href: string) => Promise<string>;
  onOpenContext: (item: { title: string; target: ChatChange["target"] }) => void;
  onOpenChange: (change: ChatChange) => Promise<void>;
  /** Forks the chat after this reply; absent when the agent can't. */
  onFork?: (turnId: string) => void;
}) {
  const [expandedFolds, setExpandedFolds] = useState<Set<string>>(() => new Set());
  const { scrollToEnd, scrollToMessage } = useMessageScroller();
  const found = useChats((s) => s.found);
  const retryable = useChats((s) => s.retries[turns[turns.length - 1]?.id ?? ""] !== undefined);
  const foundHere = found && turns.some((turn) => turn.id === found.turnId) ? found : null;
  // A match can be in the work a reply folds away: open it before the jump below.
  const [unfoldedFor, setUnfoldedFor] = useState<typeof foundHere>(null);
  if (foundHere && unfoldedFor !== foundHere) {
    setUnfoldedFor(foundHere);
    setExpandedFolds((prev) => new Set(prev).add(foundHere.turnId));
  }
  const sent = turns.filter((turn) => turn.role === "user").length;
  useEffect(() => {
    scrollToEnd();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Each message sent jumps to the end, even scrolled up.
  }, [sent, scrollToEnd]);
  // After the jump to the end above, so a chat opened from a search lands on its message.
  useEffect(() => {
    if (!foundHere) return;
    scrollToMessage(foundHere.turnId, { align: "center" });
    return highlightFound(foundHere.turnId, foundHere.query);
  }, [foundHere, scrollToMessage]);
  const toggleFold = (id: string) =>
    setExpandedFolds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const runReplies = streaming ? runReplyIds(turns) : new Set<string>();
  const isLive = (turn: ChatTurn) => runReplies.has(turn.id) && !turn.finishedAt && !turn.error;
  const runStartedAt = turns.find((turn) => runReplies.has(turn.id))?.startedAt;
  return turns.map((turn, index) => {
    if (turn.role === "user") {
      // A compaction before the run comes before the message, as in Otter Code: while it runs,
      // the message waits under it, dashed, not read yet; once done, its divider stays above.
      const reply = turns[index + 1];
      const replyItems = reply?.role === "assistant" ? shownItems(reply) : [];
      const opening = replyItems[openingCompactions(replyItems) - 1];
      const waiting = opening?.kind === "step" && isLive(reply) && opening.output === undefined;
      const compaction = opening?.kind === "step" && !waiting ? opening : null;
      return (
        <MessageScroller.Item key={turn.id} messageId={turn.id}>
          {compaction ? <CompactionRow output={compaction.output} live={false} /> : null}
          {waiting ? <WorkingRow startedAt={runStartedAt} compacting /> : null}
          <div className="group flex flex-col items-end gap-1 py-3">
            {turn.intent === "steer" || turn.intent === "promoted" ? (
              <IntentMarker intent={turn.intent} />
            ) : null}
            {turn.context ? <ContextRecap context={turn.context} onOpen={onOpenContext} /> : null}
            <div
              className={cn(
                "relative max-w-[80%] select-text whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed wrap-anywhere",
                waiting
                  ? "border border-dashed border-muted-foreground/40 text-muted-foreground"
                  : "bg-message text-message-foreground",
              )}
            >
              {turn.skill ? (
                <span className="mb-1 mr-1.5 inline-flex align-middle">
                  <SkillBadge name={turn.skill} onAccent />
                </span>
              ) : null}
              {turn.attachments ? <SentAttachments attachments={turn.attachments} /> : null}
              {turn.citations?.map((citation, at) => (
                // oxlint-disable-next-line react/no-array-index-key -- A sent message's citations never change.
                <div key={at} className="mb-2">
                  <div className="line-clamp-3 border-l-2 border-message-foreground/25 pl-2.5 text-message-foreground/70">
                    {citation.text}
                  </div>
                  {citation.comment ? <div className="mt-1">{citation.comment}</div> : null}
                </div>
              ))}
              {turn.text}
            </div>
            <div className="flex items-center">
              <MessageTime at={turn.startedAt} />
              {turn.text ? <CopyMessageButton text={turn.text} /> : null}
            </div>
          </div>
        </MessageScroller.Item>
      );
    }
    const isLast = turn.id === turns[turns.length - 1]?.id;
    const live = isLive(turn);
    const all = shownItems(turn);
    const opening = turns[index - 1]?.role === "user" ? openingCompactions(all) : 0;
    const items = all.slice(opening);
    // Drawn above the message that waits on it.
    const compactingFirst =
      live &&
      all.slice(0, opening).some((item) => item.kind === "step" && item.output === undefined);
    // A compaction mid-turn shows as its own live divider, in place of the working row.
    const compactingMidway =
      live &&
      items.some((item) => isCompaction(item) && item.kind === "step" && item.output === undefined);
    const lastStep = items.findLastIndex((item) => item.kind === "step");
    const work = items.slice(0, lastStep + 1);
    const answer = items
      .slice(lastStep + 1)
      .map((item) => (item.kind === "text" ? item.text.trim() : ""))
      .join("\n\n");
    const steps = work.filter((item) => item.kind === "step").length;
    // A compaction never folds away: it stays between the fold and the answer.
    const foldable = work.some((item) => !isCompaction(item));
    const expanded = expandedFolds.has(turn.id);
    const showWork = work.length > 0 && (!foldable || expanded);
    const keptCompactions =
      foldable && !expanded
        ? work.filter((item, i) => isCompaction(item) && !isCompaction(work[i + 1]))
        : [];
    const continued = isSteer(turns[index - 1]);
    const foldLabel = live ? (
      <span className="text-shimmer">
        {runStartedAt ? (
          <>
            Working for <WorkingTimer startedAt={runStartedAt} />
          </>
        ) : (
          "Working…"
        )}
      </span>
    ) : turn.startedAt && turn.finishedAt ? (
      `${continued ? "Continued" : "Worked"} for ${formatDuration(turn.finishedAt - turn.startedAt)}`
    ) : continued ? (
      "Continued"
    ) : (
      `Took ${steps} step${steps === 1 ? "" : "s"}`
    );
    return (
      <MessageScroller.Item key={turn.id} messageId={turn.id}>
        <div className="flex flex-col">
          <DeliveryRow turn={turn} />
          {live && isLast && !foldable && !compactingMidway && !compactingFirst ? (
            <WorkingRow startedAt={runStartedAt} compacting={false} />
          ) : null}
          {foldable ? (
            <WorkFoldRow
              label={foldLabel}
              expanded={expanded}
              onToggle={() => toggleFold(turn.id)}
            />
          ) : null}
          {keptCompactions.length > 0 ? <WorkLog items={keptCompactions} live={live} /> : null}
          {showWork ? (
            <WorkLog items={work} live={live} onOpenFile={onOpenFile} loadImage={loadImage} />
          ) : null}
          {answer ? (
            <div className="group min-w-0 px-1 py-2">
              <div data-cite-source>
                <ChatMarkdown text={answer} onOpenFile={onOpenFile} loadImage={loadImage} />
              </div>
              {!live ? (
                <div className="mt-1 flex items-center">
                  <MessageTime at={turn.finishedAt ?? turn.startedAt} />
                  <CopyMessageButton text={answer} />
                  {onFork && !streaming ? (
                    <HintTooltip label="Fork conversation">
                      <IconBtn
                        label="Fork conversation"
                        className="size-6 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        onClick={() => onFork(turn.id)}
                      >
                        <GitForkIcon className="size-3.5" />
                      </IconBtn>
                    </HintTooltip>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {isLast && !streaming && detached ? <DetachedRow providerName={providerName} /> : null}
          {turn.error ? (
            <ErrorRow
              message={turn.error}
              providerName={providerName}
              onRetry={isLast && retryable && !streaming ? () => retryTurn(turn.id) : undefined}
            />
          ) : null}
          {!live && turn.changes?.length ? (
            <ChatChanges changes={turn.changes} onOpen={onOpenChange} />
          ) : null}
          {turn.forked ? (
            <div className="flex items-center gap-3 py-4 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span className="flex items-center gap-1.5 rounded-full border px-3 py-1">
                <GitForkIcon className="size-3.5" />
                Forked from conversation
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          ) : null}
        </div>
      </MessageScroller.Item>
    );
  });
}
