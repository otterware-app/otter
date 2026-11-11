import type { ResultsTo, ScheduledTaskInput } from "@otter/contracts/scheduled";
import { handle } from "../ipc.js";
import { runAsTask } from "./ipc-budget.js";
import { ATTACHMENTS_DIR, stageAttachment } from "../services/agent/attachments.js";
import * as agent from "../services/agent/service.js";
import { agentChannels, deleteAgentChannel, makeAgentChannel } from "../services/agent/channels.js";
import { preferenceChanged } from "../services/preferences.js";
import { setWatching } from "../services/realtime.js";
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

function taskIdOf(p: Params): string {
  const id = str(p?.id);
  if (!id) throw new Error("A task id is required.");
  return id;
}

const MAX_TASK_NAME = 200;
const MAX_TASK_PROMPT = 5000;

function resultsToOf(raw: unknown): ResultsTo {
  const r = raw as Params;
  if (r?.kind === "new-chat" || r?.kind === "off") return { kind: r.kind };
  if (r?.kind === "channel") {
    const channel = str(r.channel);
    const to = str(r.to);
    if (!channel) throw new Error("Choose where its results go.");
    if (!to) throw new Error("Say who on it gets the results.");
    const accountId = str(r.accountId);
    return { kind: "channel", channel, to, ...(accountId ? { accountId } : {}) };
  }
  if (r?.kind === "webhook") {
    const url = str(r.url);
    if (!/^https?:\/\//i.test(url) || !URL.canParse(url))
      throw new Error("A webhook needs an http(s) address.");
    return { kind: "webhook", url };
  }
  throw new Error("Choose where its results go.");
}

/** A task as the app sends it; an edit may keep a schedule the app wouldn't let you pick. */
export function scheduledTaskInputOf(raw: unknown, editing = false): ScheduledTaskInput {
  const p = raw as Params;
  const name = str(p?.name);
  if (!name) throw new Error("Give the task a name.");
  if (name.length > MAX_TASK_NAME) throw new Error("That name is too long.");
  const prompt = typeof p?.prompt === "string" ? p.prompt.trim() : undefined;
  if (prompt !== undefined && !prompt) throw new Error("Say what the agent should do.");
  if (prompt && prompt.length > MAX_TASK_PROMPT) throw new Error("That's too long for a task.");
  const s = p?.schedule as Params;
  let schedule: ScheduledTaskInput["schedule"];
  if (s?.kind === "cron" && str(s.expr)) {
    if (str(s.expr).split(/\s+/).length < 5) throw new Error("That cron expression is incomplete.");
    schedule = { kind: "cron", expr: str(s.expr), ...(str(s.tz) ? { tz: str(s.tz) } : {}) };
  } else if (s?.kind === "every" && Number(s.everyMs) >= (editing ? 1000 : 60_000)) {
    schedule = { kind: "every", everyMs: Math.round(Number(s.everyMs)) };
  } else if (s?.kind === "at" && !Number.isNaN(Date.parse(str(s.at)))) {
    if (!editing && Date.parse(str(s.at)) <= Date.now())
      throw new Error("Pick a time in the future.");
    schedule = { kind: "at", at: new Date(str(s.at)).toISOString() };
  } else throw new Error("Choose when it runs.");
  return {
    name,
    ...(prompt !== undefined ? { prompt } : {}),
    schedule,
    ...(str(p?.agent) ? { agent: str(p?.agent) } : {}),
    ...(p?.resultsTo !== undefined ? { resultsTo: resultsToOf(p.resultsTo) } : {}),
    ...(str(p?.revision) ? { revision: str(p?.revision) } : {}),
  };
}

export function registerAgentHandlers(): void {
  handle("agent:providers", async () => agent.providersState());

  handle("agent:refreshProviders", async (params: unknown) => {
    const p = params as Params;
    void agent.refreshProviders(p?.provider ? [providerOf(p)] : undefined);
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

  handle("agent:watch", async (params: unknown) => {
    const p = params as Params;
    const sessions = (Array.isArray(p?.sessions) ? (p.sessions as Params[]) : [])
      .map((s) => ({
        id: str(s?.id),
        since: Number(s?.since) || 0,
        ...(typeof s?.cursor === "string" && s.cursor && { cursor: s.cursor }),
      }))
      .filter((s) => s.id);
    await agent.watchSessions(providerOf(p), sessions);
    return { ok: true };
  });

  // An agent's gateway allowed to tell this account's devices it delivered something (relay's agent-channels.ts).
  handle("agent:channels", () => agentChannels());
  handle("agent:makeChannel", async (params: unknown) => {
    const label = str((params as Params)?.label);
    if (!label) throw new Error("A label is required.");
    return makeAgentChannel(label);
  });
  handle("agent:deleteChannel", async (params: unknown) => {
    const id = str((params as Params)?.id);
    if (!id) throw new Error("A channel is required.");
    await deleteAgentChannel(id);
    return { ok: true };
  });

  handle("agent:notifyAsk", async (params: unknown) => {
    const p = params as Params;
    const key = str(p?.key);
    const title = str(p?.title);
    if (!key || !title) throw new Error("A key and a title are required.");
    agent.notifyAsk(providerOf(p), {
      key,
      title,
      subtitle: str(p?.subtitle) || undefined,
      body: str(p?.body) || undefined,
      chat: str(p?.chat) || undefined,
      focused: p?.focused === true,
    });
    return { ok: true };
  });

  handle("agent:watching", async (params: unknown) => {
    const p = params as Params;
    const window = str(p?.window);
    if (!window) throw new Error("A window is required.");
    setWatching(window, str(p?.session) || null);
    return { ok: true };
  });

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

  handle("agent:fork", async (params: unknown) => {
    const p = params as Params;
    const before = p?.before as Params | undefined;
    const fromEnd = Number(before?.fromEnd);
    return agent.forkSession(
      providerOf(p),
      sessionIdOf(p),
      before && {
        requestId: str(before.requestId) || undefined,
        fromEnd: Number.isInteger(fromEnd) && fromEnd >= 0 ? fromEnd : 0,
      },
    );
  });

  handle("agent:retitle", async (params: unknown) => {
    const p = params as Params;
    const title = str(p?.title).trim();
    const message = str(p?.message).trim();
    if (!title && !message) throw new Error("A title or a message is required.");
    return agent.retitleSession(providerOf(p), sessionIdOf(p), title ? { title } : { message });
  });

  handle("agent:browserView", async (params: unknown) => {
    const p = params as Params;
    const size = (key: string) =>
      Math.round(Math.min(Math.max(Number(p?.[key]) || 1280, 320), 2000));
    return agent.browserView(providerOf(p), sessionIdOf(p), {
      width: size("width"),
      height: size("height"),
      except: str(p?.except) || undefined,
    });
  });

  handle("agent:browserInput", async (params: unknown) => {
    const p = params as Params;
    const targetId = str(p?.targetId);
    if (!targetId) throw new Error("A tab is required.");
    await agent.browserInput(providerOf(p), {
      targetId,
      profile: str(p?.profile) || undefined,
      take: typeof p?.take === "boolean" ? p.take : undefined,
      seq: typeof p?.seq === "number" ? p.seq : undefined,
      events: Array.isArray(p?.events) ? (p.events as Record<string, unknown>[]) : undefined,
    });
    return { ok: true };
  });

  handle("agent:browserEvents", async (params: unknown) => {
    const p = params as Params;
    const targetId = str(p?.targetId);
    if (!targetId) throw new Error("A tab is required.");
    return agent.browserEvents(providerOf(p), {
      targetId,
      profile: str(p?.profile) || undefined,
      since: typeof p?.since === "number" ? p.since : undefined,
      run: str(p?.run) || undefined,
      waitMs: Math.min(Math.max(Number(p?.waitMs) || 0, 0), 25_000),
    });
  });

  handle("agent:browserUpload", async (params: unknown) => {
    const p = params as Params;
    const targetId = str(p?.targetId);
    if (!targetId) throw new Error("A tab is required.");
    const files = (Array.isArray(p?.files) ? p.files : []).flatMap((file) => {
      const f = file as Record<string, unknown> | null;
      return typeof f?.name === "string" && typeof f.data === "string"
        ? [{ name: f.name, data: f.data }]
        : [];
    });
    await agent.browserUpload(providerOf(p), {
      targetId,
      profile: str(p?.profile) || undefined,
      files,
    });
    return { ok: true };
  });

  handle("agent:scheduled", async () => agent.listScheduledTasks());

  handle("agent:saveScheduled", async (params: unknown) => {
    const p = params as Params;
    const id = await agent.saveScheduledTask(
      providerOf(p),
      str(p?.id) || null,
      scheduledTaskInputOf(p?.task, Boolean(str(p?.id))),
    );
    return { id };
  });

  handle("agent:setScheduledEnabled", async (params: unknown) => {
    const p = params as Params;
    await agent.setScheduledTaskEnabled(providerOf(p), taskIdOf(p), p?.enabled === true);
    return { ok: true };
  });

  handle("agent:runScheduled", async (params: unknown) => {
    const p = params as Params;
    await agent.runScheduledTask(providerOf(p), taskIdOf(p));
    return { ok: true };
  });

  handle("agent:deleteScheduled", async (params: unknown) => {
    const p = params as Params;
    await agent.deleteScheduledTask(providerOf(p), taskIdOf(p));
    return { ok: true };
  });

  handle("agent:scheduledRuns", async (params: unknown) => {
    const p = params as Params;
    const limit = Math.min(Math.max(Number(p?.limit) || 20, 1), 100);
    return agent.scheduledTaskRuns(providerOf(p), taskIdOf(p), limit);
  });

  handle("agent:scheduledTargets", async (params: unknown) => {
    const p = params as Params;
    const channel = str(p?.channel);
    if (!channel) return [];
    return agent.scheduledTargets(providerOf(p), str(p?.agent), channel);
  });

  handle("agent:scheduledRunTranscript", async (params: unknown) => {
    const p = params as Params;
    const runId = str(p?.runId);
    if (!runId) throw new Error("A run id is required.");
    return agent.scheduledRunTranscript(providerOf(p), taskIdOf(p), runId);
  });

  handle("agent:deleteSession", async (params: unknown) => {
    const p = params as Params;
    await agent.deleteSession(providerOf(p), sessionIdOf(p));
    return { ok: true };
  });
}
