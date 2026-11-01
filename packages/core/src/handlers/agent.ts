/**
 * Agent handlers: provider state/settings plus chat routing. Every call
 * answers well inside the 5s IPC budget — health checks and turns run in the
 * background and report via `agent:providersChanged` / `agent:chatEvent`.
 */

import { handle } from "../ipc.js";
import { runAsTask } from "./ipc-budget.js";
import { ATTACHMENTS_DIR, stageAttachment } from "../services/agent/attachments.js";
import * as agent from "../services/agent/service.js";
import { preferenceChanged } from "../services/preferences.js";
import { registeredAgents } from "../extensions.js";
import type { ApprovalDecision, ProviderKind, ChatAttachment } from "../services/agent/types.js";

type Params = Record<string, unknown> | undefined;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function providerOf(p: Params): ProviderKind {
  const kind = p?.provider;
  if (typeof kind === "string" && registeredAgents().has(kind)) return kind;
  throw new Error("Unknown agent provider.");
}

function sessionIdOf(p: Params): string {
  const sessionId = str(p?.sessionId);
  if (!sessionId) throw new Error("A session id is required.");
  return sessionId;
}

const MAX_ATTACHMENTS = 10;

/** Only staged files (inside the attachments folder) are passed to agents. */
function attachmentsOf(raw: unknown): ChatAttachment[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Params[])
    .filter(
      (a): a is Params & ChatAttachment =>
        typeof a?.path === "string" &&
        a.path.startsWith(`${ATTACHMENTS_DIR}/`) &&
        !a.path.includes("..") &&
        typeof a.name === "string" &&
        typeof a.mime === "string" &&
        (a.kind === "image" || a.kind === "file"),
    )
    .slice(0, MAX_ATTACHMENTS)
    .map((a) => ({
      id: str(a.id),
      name: a.name,
      mime: a.mime,
      size: Number(a.size) || 0,
      path: a.path,
      kind: a.kind,
    }));
}

export function registerAgentHandlers(): void {
  handle("agent:providers", async () => agent.providersState());

  handle("agent:refreshProviders", async () => {
    void agent.refreshProviders();
    return { ok: true };
  });

  handle("agent:updateSettings", async (params: unknown) => {
    const state = await agent.updateProviderSettings((params ?? {}) as Record<string, unknown>);
    preferenceChanged("assistant");
    return state;
  });

  handle("agent:send", async (params: unknown) => {
    const p = params as Params;
    const requestId = str(p?.requestId);
    const input = typeof p?.input === "string" ? p.input : "";
    const skill = p?.skill as Params;
    const skillName = str(skill?.name);
    const attachments = attachmentsOf(p?.attachments);
    if (!requestId || (!input.trim() && !skillName && attachments.length === 0))
      throw new Error("Nothing to send.");
    await agent.sendTurn(providerOf(p), {
      requestId,
      input,
      sessionId: str(p?.sessionId) || undefined,
      title: str(p?.title) || undefined,
      previousResponseId: str(p?.previousResponseId) || undefined,
      skill: skillName ? { name: skillName, path: str(skill?.path) || undefined } : undefined,
      attachments,
    });
    return { ok: true };
  });

  handle("agent:resume", async (params: unknown) => {
    const p = params as Params;
    const requestId = str(p?.requestId);
    if (!requestId) throw new Error("A request id is required.");
    return {
      resumed: await agent.resumeTurn(providerOf(p), { requestId, sessionId: sessionIdOf(p) }),
    };
  });

  // Dropped, picked or pasted files are copied into the attachments folder;
  // the renderer sends the returned records with a turn.
  handle("agent:stageAttachments", async (params: unknown) => {
    const p = params as Params;
    const items = Array.isArray(p?.items) ? (p.items as Params[]) : [];
    const staged: ChatAttachment[] = [];
    const errors: string[] = [];
    for (const item of items.slice(0, MAX_ATTACHMENTS)) {
      try {
        if (item?.bytes instanceof Uint8Array)
          staged.push(
            await stageAttachment(str(item.name) || "Pasted image.png", str(item.mime), item.bytes),
          );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }
    return { attachments: staged, errors };
  });

  handle("agent:respondApproval", async (params: unknown) => {
    const p = params as Params;
    const decision = p?.decision as ApprovalDecision;
    if (!["once", "session", "always", "deny"].includes(decision))
      throw new Error("Unknown decision.");
    await agent.respondApproval(providerOf(p), str(p?.requestId), str(p?.approvalId), decision);
    return { ok: true };
  });

  handle("agent:answerQuestion", async (params: unknown) => {
    const p = params as Params;
    const raw = p?.answers;
    // Answers by question id, each a list of choices (or free text); null skips the question.
    const answers =
      raw && typeof raw === "object"
        ? Object.fromEntries(
            Object.entries(raw as Record<string, unknown>).map(([id, values]) => [
              id,
              Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [],
            ]),
          )
        : null;
    await agent.answerQuestion(providerOf(p), str(p?.requestId), str(p?.questionId), answers);
    return { ok: true };
  });

  handle("agent:steer", async (params: unknown) => {
    const p = params as Params;
    const input = typeof p?.input === "string" ? p.input : "";
    if (!input.trim()) throw new Error("Nothing to send.");
    return {
      accepted: await agent.steerTurn(providerOf(p), str(p?.requestId), input),
    };
  });

  handle("agent:cancel", async (params: unknown) => {
    const p = params as Params;
    agent.cancelTurn(providerOf(p), str(p?.requestId));
    return { ok: true };
  });

  handle("agent:skills", async (params: unknown) => agent.listSkills(providerOf(params as Params)));

  handle("agent:sessions", async (params: unknown) => {
    const p = params as Params;
    const limit = typeof p?.limit === "number" && Number.isFinite(p.limit) ? p.limit : 40;
    return agent.listSessions(providerOf(p), limit);
  });

  handle("agent:sessionMessages", async (params: unknown) => {
    const p = params as Params;
    return agent.readSession(providerOf(p), sessionIdOf(p));
  });

  handle("agent:readFile", (params: unknown) => {
    const p = params as Params;
    const href = str(p?.href);
    if (!href) throw new Error("A file link is required.");
    return runAsTask(str(p?.taskId), () => agent.readFile(providerOf(p), str(p?.sessionId), href));
  });

  handle("agent:deleteSession", async (params: unknown) => {
    const p = params as Params;
    await agent.deleteSession(providerOf(p), sessionIdOf(p));
    return { ok: true };
  });
}
