import type { ChatTurn, ChatTurnItem } from "@otter/contracts/chats";

export const isSteer = (turn: ChatTurn | undefined) =>
  turn?.role === "user" && (turn.intent === "steer" || turn.intent === "promoted");

export const shownItems = (turn: ChatTurn | undefined): ChatTurnItem[] =>
  (turn?.items ?? []).filter((item) => item.kind === "step" || item.text.trim());

export const isCompaction = (item: ChatTurnItem | undefined) =>
  item?.kind === "step" && Boolean(item.step.compaction);

/** A reply's work, up to its last step, and its answer: what it wrote after. */
export function splitAnswer(items: ChatTurnItem[]): { work: ChatTurnItem[]; answer: string } {
  const lastStep = items.findLastIndex((item) => item.kind === "step");
  return {
    work: items.slice(0, lastStep + 1),
    answer: items
      .slice(lastStep + 1)
      .map((item) => (item.kind === "text" ? item.text.trim() : ""))
      .join("\n\n"),
  };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  if (mins < 60) return `${mins}m ${total % 60}s`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export type ReplyLayout = {
  /** Part of the run in flight. */
  live: boolean;
  /** The run in flight starts here: its "Working for" row goes at the top. */
  working: boolean;
  /** The fold row drawn at this reply's top: its id, label and when its work started. */
  fold: { id: string; label: string; at?: number } | null;
  /** The fold this reply's work hides under (drawn at its segment's first reply). */
  foldedUnder: string | null;
  /**
   * Holds the run's answer, which no fold hides: what the run wrote after its last step (a steer
   * sent while it answered can split it across replies).
   */
  answers: boolean;
  /**
   * The run in flight ends here, thinking: it isn't in a step, a compaction, asking you or waiting
   * on subagents.
   */
  thinking: boolean;
  /** The run in flight ends here, in a step: the latest stays lit until the next thing happens. */
  stepping: boolean;
};

type Run = { replies: { turn: ChatTurn; steer: ChatTurn | null }[] };

/**
 * A run is the reply to a message and the replies to the steers sent into it. What's said in a
 * call is no run's: each spoken reply stands alone.
 */
function runsOf(turns: ChatTurn[]): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  let steer: ChatTurn | null = null;
  for (const turn of turns) {
    if (turn.spoken) {
      if (turn.role === "assistant") runs.push({ replies: [{ turn, steer: null }] });
      continue;
    }
    if (turn.role === "user") {
      if (current && isSteer(turn)) steer = turn;
      else current = steer = null;
      continue;
    }
    if (current && steer && !turn.delivered) current.replies.push({ turn, steer });
    else runs.push((current = { replies: [{ turn, steer: null }] }));
    steer = null;
  }
  return runs;
}

/**
 * How each reply shows, after T3 Code's timeline (MessagesTimeline.logic.ts). While a run goes,
 * nothing folds: "Working for" stays at its top, timed from its start, everything it does shows,
 * and "Thinking" ends it while no step runs. Once it's done, its work folds under "Worked for"
 * (the whole run, steers included) and its answer stays. A steer sent after the run wrote
 * something splits it: the work after the steer folds under its own "Continued for" row below the
 * steer (back-to-back steers split once, after the last). A run that failed or was stopped keeps
 * its work in view.
 */
export function layoutReplies(
  turns: ChatTurn[],
  {
    streaming,
    asking,
    waiting = false,
  }: { streaming: boolean; asking: boolean; /** Handed off to subagents. */ waiting?: boolean },
): Map<string, ReplyLayout> {
  const layouts = new Map<string, ReplyLayout>();
  const runs = runsOf(turns);
  const latest = runs.findLast((run) => !run.replies[0].turn.spoken);
  for (const run of runs) {
    const replies = run.replies.map(({ turn }) => turn);
    const last = replies[replies.length - 1];
    const live = streaming && run === latest && !last.finishedAt && !last.error;
    const lastStep = replies.findLastIndex((turn) =>
      shownItems(turn).some((item) => item.kind === "step"),
    );
    const base = { live, working: false, fold: null, foldedUnder: null };
    const idle = { thinking: false, stepping: false };
    replies.forEach((turn, index) =>
      layouts.set(turn.id, { ...base, ...idle, answers: index >= lastStep }),
    );
    if (live) {
      const tail = shownItems(last).at(-1);
      // A step still running before a steer is still what the run is doing.
      const running = replies
        .flatMap(shownItems)
        .some((item) => item.kind === "step" && item.output === undefined);
      layouts.set(replies[0].id, { ...layouts.get(replies[0].id)!, working: true });
      layouts.set(last.id, {
        ...layouts.get(last.id)!,
        thinking: !asking && !waiting && !running && tail?.kind !== "step",
        stepping: !asking && !waiting && tail?.kind === "step",
      });
      continue;
    }
    if (replies.some((turn) => turn.error)) continue;

    const segments: { replies: ChatTurn[]; steer: ChatTurn | null }[] = [
      { replies: [], steer: null },
    ];
    let wrote = false;
    let split: ChatTurn | null = null;
    for (const { turn, steer } of run.replies) {
      if (steer && wrote) split = steer;
      const has = shownItems(turn).length > 0;
      if (has && split) {
        segments.push({ replies: [], steer: split });
        split = null;
      }
      segments[segments.length - 1].replies.push(turn);
      wrote ||= has;
    }
    const hides = (segment: (typeof segments)[number]) =>
      segment.replies.some((turn) =>
        (layouts.get(turn.id)!.answers
          ? splitAnswer(shownItems(turn)).work
          : shownItems(turn)
        ).some((item) => !isCompaction(item)),
      );
    if (!segments.some(hides)) continue;

    const startedAt = replies[0].startedAt;
    const ends = replies.flatMap((turn) => (turn.finishedAt ? [turn.finishedAt] : []));
    const endedAt = ends.length > 0 ? Math.max(...ends) : undefined;
    const label = (verb: string, from?: number, to?: number) =>
      from !== undefined && to !== undefined ? `${verb} for ${formatDuration(to - from)}` : verb;
    segments.forEach((segment, index) => {
      if (index > 0 && !hides(segment)) return;
      const anchor = segment.replies[0];
      const at = segment.steer?.startedAt ?? startedAt;
      const fold = {
        id: anchor.id,
        label: segment.steer
          ? label("Continued", at, segments[index + 1]?.steer?.startedAt ?? endedAt)
          : label("Worked", startedAt, endedAt),
        at,
      };
      layouts.set(anchor.id, { ...layouts.get(anchor.id)!, fold });
      for (const turn of segment.replies)
        layouts.set(turn.id, { ...layouts.get(turn.id)!, foldedUnder: anchor.id });
    });
  }
  return layouts;
}

/** A steer right after another reads as one: only the first says it steered. */
export function continuesSteer(turns: ChatTurn[], index: number): boolean {
  if (!isSteer(turns[index])) return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn.spoken) continue;
    if (turn.role === "assistant" && !turn.error && shownItems(turn).length === 0) continue;
    return isSteer(turn);
  }
  return false;
}
