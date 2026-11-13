/**
 * A turn is a run on the gateway (POST /v1/runs into the chat's session), followed over its event
 * stream (GET /v1/runs/{id}/events), which replays from any event. The run belongs to Hermes, not
 * the app: a dropped connection is followed again from where it was, and a run the app quit during
 * is picked up on the next launch (the run's id is kept on the device until it ends).
 */

import {
  hermesStep,
  logger,
  readJson,
  TextStream,
  TOOL_OUTPUT_CHARS,
  writeJson,
} from "@otter/core/extension-kit";
import type {
  AgentId,
  ApprovalDecision,
  ApprovalRequest,
  ChatEvent,
  ChatSessionMessage,
  Emit,
} from "@otter/core/extension-kit";

import {
  authHeaders,
  lastReply,
  parseJson,
  readError,
  readSse,
  sessionMessages,
  type Ready,
} from "./http.js";

/** The gateway sends a keepalive every 10s: silence this long is a dead connection. */
const SILENT_MS = 45_000;
const RECONNECT_MS = [1_000, 3_000, 8_000];

export type Run = {
  requestId: string;
  runId: string;
  sessionId: string;
  ready: Ready;
  emit: Emit;
  /** The last event read: the stream is picked up after it. */
  seq: number;
  text: TextStream;
  stop: AbortController;
  /** Before the run's `done`: what to tell the chat once it has finished (its new title). */
  finishing?: () => Promise<void>;
};

/** How a run ended, as its last event. */
type End = Extract<ChatEvent, { type: "done" | "error" }>;

/** One agent's runs: those this device follows, and the approvals they wait on. */
export type Runs = {
  agent: AgentId;
  following: Map<string, Run>;
  pendingApprovals: Map<
    string,
    { requestId: string; runId: string; ready: Ready; emit: Emit; approval: ApprovalRequest }
  >;
};

export const newRuns = (agent: AgentId): Runs => ({
  agent,
  following: new Map(),
  pendingApprovals: new Map(),
});

export function dropApprovals(runs: Runs, requestId: string): void {
  for (const [approvalId, pending] of runs.pendingApprovals) {
    if (pending.requestId !== requestId) continue;
    runs.pendingApprovals.delete(approvalId);
    pending.emit({ requestId, type: "approvalResolved", approvalId });
  }
}

const RUNS_FILE = "hermes-runs.json";
/** The gateway keeps a run's record for a day. */
const KEPT_MS = 24 * 60 * 60 * 1000;
type Kept = { runId: string; sessionId: string; at: number };
/** Each agent's runs, by request id. */
type KeptRuns = Record<AgentId, Record<string, Kept>>;
/** One change to the file at a time, so none is lost: every Hermes agent keeps its runs in it. */
let saving: Promise<void> = Promise.resolve();

const keptRuns = async () => (await readJson<KeptRuns>(RUNS_FILE)) ?? {};

function saveKept(agent: AgentId, change: (runs: Record<string, Kept>) => void): Promise<void> {
  saving = saving.then(async () => {
    const all = await keptRuns();
    change((all[agent] ??= {}));
    const now = Date.now();
    for (const [id, runs] of Object.entries(all)) {
      for (const [requestId, run] of Object.entries(runs))
        if (!(run.at > now - KEPT_MS)) delete runs[requestId];
      if (Object.keys(runs).length === 0) delete all[id];
    }
    await writeJson(RUNS_FILE, all).catch((error: unknown) =>
      logger.info("agent", "hermes runs not saved", { error: String(error) }),
    );
  });
  return saving;
}

export const keepRun = (agent: AgentId, requestId: string, run: Kept) =>
  saveKept(agent, (runs) => {
    runs[requestId] = run;
  });

export const forgetRun = (agent: AgentId, requestId: string) =>
  saveKept(agent, (runs) => {
    delete runs[requestId];
  });

export async function keptRun(agent: AgentId, requestId: string): Promise<Kept | undefined> {
  await saving;
  return (await keptRuns())[agent]?.[requestId];
}

/**
 * Why the app stops following a run that goes on (it quits, Hermes's address changed): the chat
 * picks it up again once it can.
 */
export const LET_GO = "let go";

const RESTARTED = "agent_error: Hermes restarted before it finished this reply.";

const APPROVAL_CHOICES: ApprovalDecision[] = ["once", "session", "always", "deny"];

/** One of the run's events; how the run ended, once it says (for the caller to emit). */
export function onRunEvent(runs: Runs, run: Run, p: Record<string, unknown>): End | undefined {
  const { requestId, emit, text } = run;
  const event = String(p.event ?? "");
  switch (event) {
    case "message.delta":
      text.append(String(p.delta ?? ""));
      return undefined;
    case "message.interim":
      if (!p.already_streamed) text.snapshot(String(p.text ?? "").trim());
      text.start();
      return undefined;
    case "tool.started":
      text.start();
      emit({
        requestId,
        type: "tool",
        ...(p.tool_call_id ? { id: String(p.tool_call_id) } : {}),
        step: hermesStep(String(p.tool ?? p.tool_name ?? "tool"), p.preview),
      });
      return undefined;
    case "tool.completed":
    case "tool.failed": {
      const preview = String(p.preview ?? "").slice(0, TOOL_OUTPUT_CHARS);
      const failed = event === "tool.failed" || p.error === true;
      emit({
        requestId,
        type: "toolResult",
        ...(p.tool_call_id ? { id: String(p.tool_call_id) } : {}),
        output: preview || (failed ? "(failed)" : "(done)"),
      });
      return undefined;
    }
    case "approval.request": {
      const approvalId = String(p.request_id ?? "");
      if (!approvalId) return undefined;
      const choices = Array.isArray(p.choices)
        ? (p.choices as string[]).filter((c): c is ApprovalDecision =>
            APPROVAL_CHOICES.includes(c as ApprovalDecision),
          )
        : APPROVAL_CHOICES;
      const approval: ApprovalRequest = {
        id: approvalId,
        kind: "command",
        title: "Command approval",
        detail: p.command ? String(p.command) : undefined,
        reason: p.description ? String(p.description) : undefined,
        choices,
      };
      runs.pendingApprovals.set(approvalId, {
        requestId,
        runId: run.runId,
        ready: run.ready,
        emit,
        approval,
      });
      emit({ requestId, type: "approval", approval });
      return undefined;
    }
    case "approval.responded": {
      // Answered here, on another device, or in Hermes itself.
      const approvalId = p.request_id ? String(p.request_id) : undefined;
      for (const [id, pending] of runs.pendingApprovals)
        if (pending.requestId === requestId && (!approvalId || id === approvalId)) {
          runs.pendingApprovals.delete(id);
          emit({ requestId, type: "approvalResolved", approvalId: id });
        }
      return undefined;
    }
    case "run.completed":
      if (typeof p.output === "string" && p.output.trim()) text.snapshot(p.output);
      if (typeof p.pending_steer === "string" && p.pending_steer.trim())
        emit({ requestId, type: "steerReturned", text: p.pending_steer });
      return { requestId, type: "done", responseId: null };
    case "run.failed": {
      const reason = String(p.error || p.turn_exit_reason || "");
      return {
        requestId,
        type: "error",
        message: reason ? `agent_error: ${reason}` : "agent_error",
      };
    }
    case "run.cancelled":
      return { requestId, type: "error", message: "cancelled" };
    case "run.interrupted":
      return { requestId, type: "error", message: RESTARTED };
    default:
      return undefined;
  }
}

/**
 * The run as the gateway records it, once its stream is gone: how it ended, or nothing while it
 * goes on. A reply first read now (a run picked up again) comes from the session, tool steps and all.
 */
async function settle(runs: Runs, run: Run): Promise<End | undefined> {
  const { requestId, ready, emit } = run;
  const response = await fetch(`${ready.root}/v1/runs/${encodeURIComponent(run.runId)}`, {
    headers: authHeaders(ready.key),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok && response.status !== 404) throw new Error(await readError(response));
  const status =
    response.status === 404 ? null : ((await response.json()) as Record<string, unknown>);
  const state = String(status?.status ?? "");
  if (state === "queued" || state === "running" || state.startsWith("waiting")) return undefined;
  if (status && state !== "completed")
    return onRunEvent(runs, run, { ...status, event: `run.${state}` });
  if (status && run.seq >= 0) return onRunEvent(runs, run, { ...status, event: "run.completed" });
  // Forgotten by a gateway that restarted since, or never streamed here.
  const reply = lastReply(await sessionMessages(ready, run.sessionId));
  if (!reply.some((m) => m.role === "assistant" && m.text.trim()))
    return { requestId, type: "error", message: RESTARTED };
  emit({ requestId, type: "transcript", messages: reply });
  return { requestId, type: "done", responseId: null };
}

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Follows the run to its end, through dropped connections; `detached` when the gateway stays out of reach. */
export async function follow(runs: Runs, run: Run): Promise<void> {
  const { requestId, emit } = run;
  runs.following.set(requestId, run);
  const detached = { requestId, type: "error", message: "detached" } as const;
  let failures = 0;
  try {
    for (;;) {
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      run.stop.signal.addEventListener("abort", abort);
      let silence: ReturnType<typeof setTimeout> | undefined;
      const alive = () => {
        clearTimeout(silence);
        silence = setTimeout(abort, SILENT_MS);
      };
      let end: End | undefined;
      try {
        alive();
        const response = await fetch(
          `${run.ready.root}/v1/runs/${encodeURIComponent(run.runId)}/events?last_seq=${run.seq}`,
          {
            headers: { ...authHeaders(run.ready.key), Accept: "text/event-stream" },
            signal: attempt.signal,
          },
        );
        if (response.status === 401) end = { requestId, type: "error", message: "unauthorized" };
        else if (response.status === 404) end = await settle(runs, run);
        else if (!response.ok || !response.body) throw new Error(`http_${response.status}`);
        else {
          await readSse(
            response.body,
            (_name, json) => {
              const p = end ? null : parseJson(json);
              if (!p) return;
              failures = 0;
              if (typeof p.seq === "number") run.seq = p.seq;
              end = onRunEvent(runs, run, p);
            },
            alive,
          );
          // Closed without saying how the run ended.
          end ??= await settle(runs, run);
        }
      } catch (error) {
        if (run.stop.signal.reason === LET_GO) return emit(detached);
        if (run.stop.signal.aborted) end = { requestId, type: "error", message: "cancelled" };
        else logger.info("agent", "hermes run stream dropped", { requestId, error: String(error) });
      } finally {
        clearTimeout(silence);
        run.stop.signal.removeEventListener("abort", abort);
      }
      if (end) {
        if (end.type === "done") await run.finishing?.().catch(() => {});
        emit(end);
        await forgetRun(runs.agent, requestId);
        return;
      }
      if (failures >= RECONNECT_MS.length) return emit(detached);
      await pause(RECONNECT_MS[failures++], run.stop.signal);
      if (run.stop.signal.reason === LET_GO) return emit(detached);
      if (run.stop.signal.aborted) return emit({ requestId, type: "error", message: "cancelled" });
    }
  } finally {
    runs.following.delete(requestId);
    dropApprovals(runs, requestId);
  }
}

export function newRun(
  requestId: string,
  runId: string,
  sessionId: string,
  ready: Ready,
  emit: Emit,
): Run {
  return {
    requestId,
    runId,
    sessionId,
    ready,
    emit,
    seq: -1,
    text: new TextStream(requestId, emit),
    stop: new AbortController(),
  };
}

/** POST /v1/runs into the session; its id. The request id makes sending it twice start it once. */
export async function startRun(
  ready: Ready,
  requestId: string,
  sessionId: string,
  input: string | unknown[],
  modelFields: Record<string, unknown>,
  instructions?: string,
): Promise<{ runId: string } | { error: string }> {
  const response = await fetch(`${ready.root}/v1/runs`, {
    method: "POST",
    headers: { ...authHeaders(ready.key, true), "Idempotency-Key": requestId },
    body: JSON.stringify({
      input: typeof input === "string" ? input : [{ role: "user", content: input }],
      session_id: sessionId,
      ...modelFields,
      ...(instructions ? { instructions } : {}),
    }),
  });
  if (response.status === 401) return { error: "unauthorized" };
  if (response.status === 404) return { error: "session_not_found" };
  if (!response.ok) {
    const message = await readError(response);
    logger.info("agent", "hermes run rejected", { requestId, status: response.status, message });
    return {
      error: response.status === 429 ? `agent_error: ${message}` : `http_${response.status}`,
    };
  }
  const body = (await response.json()) as { run_id?: string };
  if (!body.run_id) return { error: "agent_error: Hermes started no run." };
  return { runId: body.run_id };
}

/** The reply so far, for a run another device started or one this device lost track of. */
export async function replyOf(ready: Ready, sessionId: string): Promise<ChatSessionMessage[]> {
  return lastReply(await sessionMessages(ready, sessionId));
}
