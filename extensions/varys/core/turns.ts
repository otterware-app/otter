/**
 * A varys turn as Otter's chat shows it. varys streams a thread's turns as events (the SDK's
 * `threads.turn` for the turn a message of yours started, `threads.follow` for every run in a
 * thread, those the agent starts itself included), read from Live, which picks them up again
 * after a dropped connection. Here they become the chat's text, tool steps, approvals and
 * questions, and how the turn ended.
 */

import type {
  Approval,
  Following,
  Question,
  TranscriptItem,
  TurnEvent,
  Varys,
} from "@generalpursuit/varys";
import {
  TextStream,
  TOOL_OUTPUT_CHARS,
  logger,
  type ApprovalRequest,
  type ChatEvent,
  type ChatQuestion,
  type ChatSessionMessage,
  type Emit,
} from "@otter/core/extension-kit";

import { failed } from "./client.js";
import { varysStep } from "./steps.js";

export type Turn = {
  requestId: string;
  threadId: string;
  varys: Varys;
  /** Where its events go; a run the agent started holds them until the chat follows it. */
  emit: Emit;
  text: TextStream;
};

/** How a turn ended, as its last event. */
export type End = Extract<ChatEvent, { type: "done" | "error" }>;

/** The turns of your messages this device follows, by request id. */
export const following = new Map<string, { turn: Turn; end: (end: End) => void }>();

/** Approvals and questions waiting in a turn, by their inbox ids. */
export const asks = new Map<
  string,
  { requestId: string; ask: { approval: ApprovalRequest } | { question: ChatQuestion } }
>();

/** Why the app stops following a turn that goes on (it quits): the chat picks it up again. */
export const DETACHED = "detached";

/** An item with its place in the transcript (an owner's message has none until it's admitted). */
export const placed = (item: TranscriptItem) => /^\d+$/.test(item.id);

export function newTurn(requestId: string, threadId: string, varys: Varys, emit: Emit): Turn {
  const turn: Turn = {
    requestId,
    threadId,
    varys,
    emit,
    text: new TextStream(requestId, (event) => turn.emit(event)),
  };
  return turn;
}

export function approvalOf(approval: Approval): ApprovalRequest {
  const fields = approval.presentation.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
  return {
    id: approval.id,
    kind: "tool",
    title: approval.headline,
    detail: fields || approval.input,
    reason: approval.why,
    // "Allow in this thread" only where varys offers it.
    choices: approval.offer ? ["once", "session", "deny"] : ["once", "deny"],
  };
}

/** A varys question is asked in words and answered in words. */
export function questionOf(question: Question): ChatQuestion {
  return {
    id: question.id,
    questions: [
      {
        id: question.id,
        header: "",
        question: question.text,
        options: [],
        multiSelect: false,
        secret: false,
      },
    ],
    expiresAt: question.deadline ? Date.parse(question.deadline) : 0,
  };
}

const output = (text: string, failed: boolean) =>
  text.slice(-TOOL_OUTPUT_CHARS) || (failed ? "(failed)" : "(done)");

function ask(turn: Turn, item: Approval | Question): void {
  const { requestId } = turn;
  if (item.type === "approval") {
    const approval = approvalOf(item);
    asks.set(approval.id, { requestId, ask: { approval } });
    turn.emit({ requestId, type: "approval", approval });
  } else {
    const question = questionOf(item);
    asks.set(question.id, { requestId, ask: { question } });
    turn.emit({ requestId, type: "question", question });
  }
}

/** What a turn asked no longer waits: answered here or elsewhere, or withdrawn. */
export function resolved(turn: Turn, id: string): void {
  const waiting = asks.get(id);
  if (!waiting) return;
  asks.delete(id);
  const { requestId } = turn;
  turn.emit(
    "approval" in waiting.ask
      ? { requestId, type: "approvalResolved", approvalId: id }
      : { requestId, type: "questionResolved", questionId: id },
  );
}

/** One of a turn's events in the chat; how the turn ended, once it says. */
export function onTurnEvent(turn: Turn, event: TurnEvent): End | undefined {
  const { requestId, text } = turn;
  switch (event.type) {
    case "message":
      // A message sent into the run (a steer): what follows is a new reply.
      text.start();
      return undefined;
    case "text":
      text.append(event.delta);
      return undefined;
    case "answer":
      text.snapshot(event.answer.text);
      text.start();
      return undefined;
    case "step":
      turn.emit({ requestId, type: "tool", id: event.call.callId, step: varysStep(event.call) });
      return undefined;
    case "result":
      turn.emit({
        requestId,
        type: "toolResult",
        id: event.result.callId,
        output: output(event.result.text, event.result.failed),
      });
      return undefined;
    case "note":
      // What the agent wrote here from another thread (a routine's report); the rest of what it
      // was told (your answer to a question, a summary of older messages) shows elsewhere.
      if (event.note.from) {
        text.start();
        text.snapshot(event.note.text);
        text.start();
      }
      return undefined;
    case "approval":
      ask(turn, event.approval);
      return undefined;
    case "question":
      ask(turn, event.question);
      return undefined;
    case "approvalResolved":
    case "questionResolved":
      resolved(turn, event.id);
      return undefined;
    // The run stopped to ask you (its approval or question shows "Waiting for you"), and goes on
    // with a reply of its own once you've answered.
    case "waiting":
    case "resumed":
      text.start();
      return undefined;
    case "done":
      return { requestId, type: "done", responseId: null };
    case "stopped":
      return { requestId, type: "error", message: "cancelled" };
    case "failed":
      return { requestId, type: "error", message: failed(event) };
    case "started":
      return undefined;
  }
}

/** Ends a turn here: what it asked of you no longer waits, then how it ended. */
export function endTurn(turn: Turn, end: End): void {
  for (const [id, { requestId }] of asks) if (requestId === turn.requestId) resolved(turn, id);
  turn.emit(end);
}

const until = (turn: Turn, done: (end: End) => void) => (event: TurnEvent) => {
  const end = onTurnEvent(turn, event);
  if (end) done(end);
};

/** Stops following once it's done; a follow that stopped early ends the turn. */
function closing(turn: Turn, followed: Following<unknown>, done: (end: End) => void) {
  void followed.ended.then((result) => {
    if (result.isOk()) return;
    const { code } = result.error;
    logger.info("agent", "varys turn not followed", { requestId: turn.requestId, code });
    const message = code === "closed" ? DETACHED : failed(result.error);
    done({ requestId: turn.requestId, type: "error", message });
  });
  return () => followed.close();
}

/**
 * Follows the turn a message of yours started, to its end: a run that stops to ask you waits for
 * your answer and goes on in the same turn. Ended here (the app quits), it ends `detached`, and
 * the chat picks it up again with `resume`.
 */
export async function followTurn(turn: Turn): Promise<void> {
  const { requestId, threadId, varys } = turn;
  const end = await new Promise<End>((resolve) => {
    let over = false;
    let close: (() => void) | undefined;
    const done = (end: End) => {
      if (over) return;
      over = true;
      close?.();
      resolve(end);
    };
    following.set(requestId, { turn, end: done });
    close = closing(turn, varys.threads.turn(threadId, requestId, until(turn, done)), done);
    if (over) close();
  });
  following.delete(requestId);
  endTurn(turn, end);
}

/** A thread's items as a chat's messages: your messages, its replies with their tool steps. */
export function messagesOf(items: readonly TranscriptItem[]): ChatSessionMessage[] {
  return items.flatMap((item): ChatSessionMessage[] => {
    switch (item.type) {
      case "message":
        return [{ role: "user", text: item.text }];
      case "answer":
        return [
          {
            role: "assistant",
            text: item.text,
            ...(item.calls.length > 0 && { toolCalls: item.calls.map((call) => varysStep(call)) }),
          },
        ];
      case "result":
        return [{ role: "tool", toolName: item.tool, text: output(item.text, item.failed) }];
      case "note":
        return item.from ? [{ role: "assistant", text: item.text }] : [];
    }
  });
}
