import type { ChatContextMeta, ChatTurn, ChatTurnItem } from "@otter/contracts/chats";
import {
  continuesSteer,
  isCompaction,
  shownItems,
  splitAnswer,
  type ReplyLayout,
} from "./chat-runs.ts";
import type { StepItem } from "./work-log.ts";

/** How many compactions a reply opens with: those ran before the agent read your message. */
export function openingCompactions(items: ChatTurnItem[]): number {
  const at = items.findIndex((item) => !isCompaction(item));
  return at < 0 ? items.length : at;
}

export type MessageRow = {
  kind: "message";
  turn: ChatTurn;
  /** The compaction that ran before the agent read it, done: its divider stays above it. */
  compaction: StepItem | null;
  /** The agent compacts before it reads it: it waits, dashed, under "Compacting for". */
  waiting: boolean;
  /** When the run it waits on started, for "Compacting for". */
  runStartedAt?: number;
  /** It steered the run in flight (sent or promoted from the queue), marked where a steer starts. */
  steered: "steer" | "promoted" | null;
};

export type ReplyRow = {
  kind: "reply";
  turn: ChatTurn;
  layout: ReplyLayout | undefined;
  live: boolean;
  /** "Working for" at its top, unless the run compacts first (shown above its message). */
  working: boolean;
  /** What it did, as shown: under a closed fold, only the compactions that stay between. */
  work: ChatTurnItem[];
  /** Its answer, out of the folds, once the run is done. */
  answer: string;
  /** The agent was lost mid-reply: the rest shows once it's back. */
  detached: boolean;
  /** Sending its message again could fix its error. */
  retry: boolean;
  /** The mail, events and files it changed, once it's done. */
  showsChanges: boolean;
};

export type TranscriptRow = MessageRow | ReplyRow;

/**
 * A chat's turns as the transcript shows them: each message with what ran before the agent read
 * it, and each reply with its work (folded or not), its answer and how it ended.
 */
export function transcriptRows(
  turns: ChatTurn[],
  layouts: Map<string, ReplyLayout>,
  {
    streaming,
    detached,
    retryable,
    expanded,
  }: {
    streaming: boolean;
    /** The agent was lost mid-reply (the chat has a request still open). */
    detached: boolean;
    /** The last reply's error can be retried. */
    retryable: boolean;
    /** The folds opened. */
    expanded: ReadonlySet<string>;
  },
): TranscriptRow[] {
  const isLive = (turn: ChatTurn | undefined) => Boolean(turn && layouts.get(turn.id)?.live);
  const runStartedAt = turns.find((turn) => layouts.get(turn.id)?.working)?.startedAt;
  // What's said in a call after a reply doesn't make it any less the latest.
  const lastId = turns.findLast((t) => !t.spoken)?.id;
  return turns.map((turn, index): TranscriptRow => {
    if (turn.role === "user") {
      // A compaction before the run comes before the message, as in T3 Code: while it runs,
      // the message waits under it, dashed, not read yet; once done, its divider stays above.
      const reply = turns[index + 1];
      const replyItems = reply?.role === "assistant" ? shownItems(reply) : [];
      const opening = replyItems[openingCompactions(replyItems) - 1];
      const waiting = opening?.kind === "step" && isLive(reply) && opening.output === undefined;
      return {
        kind: "message",
        turn,
        compaction: opening?.kind === "step" && !waiting ? opening : null,
        waiting,
        runStartedAt,
        steered:
          (turn.intent === "steer" || turn.intent === "promoted") && !continuesSteer(turns, index)
            ? turn.intent
            : null,
      };
    }
    const isLast = turn.id === lastId;
    const layout = layouts.get(turn.id);
    const live = Boolean(layout?.live);
    const all = shownItems(turn);
    const opening = turns[index - 1]?.role === "user" ? openingCompactions(all) : 0;
    const items = all.slice(opening);
    // Drawn above the message that waits on it.
    const compactingFirst =
      live &&
      all.slice(0, opening).some((item) => item.kind === "step" && item.output === undefined);
    const { work, answer: final } = splitAnswer(items);
    // While it runs, everything shows where it was written: which text is the answer is known
    // once it's done, and only the run's last answer stays out of its folds.
    const answer = !live && layout?.answers ? final : "";
    const body = answer ? work : items;
    const folded = Boolean(layout?.foldedUnder && !expanded.has(layout.foldedUnder));
    return {
      kind: "reply",
      turn,
      layout,
      live,
      working: Boolean(layout?.working) && !compactingFirst,
      // A compaction never folds away: it stays between the fold and what follows.
      work: folded
        ? body.filter((item, i) => isCompaction(item) && !isCompaction(body[i + 1]))
        : body,
      answer,
      detached: isLast && !streaming && detached,
      retry: isLast && retryable && !streaming,
      showsChanges: !live && Boolean(turn.changes?.length),
    };
  });
}

/** The line over a turn no message of yours started: a scheduled task's result, or a message the agent sent. */
export function deliveryLabel(turn: ChatTurn): string | null {
  const delivered = turn.delivered;
  if (!delivered) return null;
  const at = turn.startedAt
    ? new Date(turn.startedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : null;
  return delivered.kind === "automation"
    ? ["Scheduled", delivered.name, at].filter(Boolean).join(" · ")
    : [delivered.from ? `Sent by ${delivered.from}` : "Sent to you", at]
        .filter(Boolean)
        .join(" · ");
}

/** What a message's mail context is called on its chip. */
export const contextLabel = (context: ChatContextMeta) =>
  context.count > 1 ? `${context.count} conversations` : (context.subjects[0] ?? "1 conversation");
