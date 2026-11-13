/**
 * Hermes over its built-in API server (https://<host>:8642, Bearer API_SERVER_KEY). Each Otter
 * chat is a Hermes session (/api/sessions), and each turn a run into it (runs.ts), which outlives
 * the app. Servers without the Sessions API chain the Responses API (/v1/responses with
 * previous_response_id) instead.
 */

import {
  utf8Decode,
  logger,
  dataUrl,
  readAttachment,
  TextStream,
  hermesStep,
  TOOL_OUTPUT_CHARS,
} from "@otter/core/extension-kit";
import type {
  AgentContext,
  AgentType,
  ChatAttachment,
  ChatProvider,
  ProviderModel,
  ProviderModelOption,
  Skill,
} from "@otter/core/extension-kit";

import {
  PROBE_TIMEOUT_MS,
  apiRoot,
  connectedPlatforms,
  rawMessages,
  authHeaders,
  contentText,
  listSessions as rawSessions,
  parseJson,
  readError,
  readSse,
  requireReady,
  sessionMessages,
  sessionOf,
  toSession,
  type RawSession,
  type Ready,
} from "./http.js";
import {
  LET_GO,
  follow,
  keepRun,
  keptRun,
  newRun,
  newRuns,
  replyOf,
  startRun,
  type Run,
} from "./runs.js";
import {
  DELIVERED,
  deliveredNow,
  deliveredReply,
  newDeliveries,
  ranTo,
  stopWatching,
  watchDeliveries,
  type Deliveries,
} from "./deliveries.js";
import { hermesSchedules } from "./schedules.js";
import { HERMES_DEFAULTS, type HermesSettings } from "./settings.js";

export { normalizeHermesBaseUrl } from "./http.js";
export { hermesSchedule, hermesTask } from "./schedules.js";

/** Sessions of Otter's own: those started through the API, and those its plugin delivered. */
const OWN_SOURCES = ["api_server", "otter"];

/** The Responses API streams only while the app holds it: a stream this quiet is a dead one. */
const IDLE_TIMEOUT_MS = 180_000;

/** Whole request cap is 10 MB; base64 grows images by a third. */
const HERMES_IMAGE_BUDGET = 7 * 1024 * 1024;
const HERMES_TEXT_BUDGET = 60 * 1024;
const TEXT_TYPES = /^(text\/|application\/(json|xml)|message\/rfc822)/;

async function hermesContent(input: string, attachments: ChatAttachment[]): Promise<unknown[]> {
  const unsupported = attachments.filter((a) => a.kind === "file" && !TEXT_TYPES.test(a.mime));
  if (unsupported.length > 0) {
    throw new Error(
      `Hermes can't read ${unsupported.map((a) => a.name).join(", ")}: its API takes images and text files only. Try Codex or Claude for PDFs and Office documents.`,
    );
  }
  const images = attachments.filter((a) => a.kind === "image");
  const imageBytes = images.reduce((sum, a) => sum + a.size, 0);
  if (imageBytes > HERMES_IMAGE_BUDGET) {
    throw new Error("Those images are too large for Hermes together (7 MB max per message).");
  }
  let text = input;
  for (const doc of attachments.filter((a) => a.kind === "file")) {
    const body = utf8Decode(await readAttachment(doc));
    text += `\n\n--- ${doc.name} ---\n${body}`;
  }
  if (new TextEncoder().encode(text).byteLength > HERMES_TEXT_BUDGET) {
    throw new Error("The attached text is too long for Hermes (about 60 KB per message).");
  }
  return [
    { type: "text", text: text || "See the attached image." },
    ...(await Promise.all(
      images.map(async (image) => ({
        type: "image_url",
        image_url: { url: await dataUrl(image) },
      })),
    )),
  ];
}

const REASONING_EFFORTS: [string, string][] = [
  ["minimal", "Minimal"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra High"],
];

type Capabilities = {
  fast?: boolean;
  reasoning?: boolean;
  can_disable_reasoning?: boolean;
};

type RawModelOptions = {
  model?: string;
  provider?: string;
  providers?: {
    slug?: string;
    name?: string;
    is_current?: boolean;
    authenticated?: boolean;
    models?: (string | { id?: string; slug?: string; name?: string })[];
    capabilities?: Record<string, Capabilities>;
  }[];
  capabilities?: Record<string, Capabilities>;
};

function hermesModelOptions(caps: Capabilities | undefined): ProviderModelOption[] {
  const options: ProviderModelOption[] = [];
  if (caps?.reasoning) {
    options.push({
      id: "reasoningEffort",
      label: "Reasoning",
      choices: [
        { id: "", label: "Default", description: "Hermes' configured effort" },
        ...(caps.can_disable_reasoning ? [{ id: "none", label: "Off" }] : []),
        ...REASONING_EFFORTS.map(([id, label]) => ({ id, label })),
      ].map((c, i) => (i === 0 ? { ...c, isDefault: true } : c)),
    });
  }
  if (caps?.fast) {
    options.push({
      id: "serviceTier",
      label: "Service Tier",
      choices: [
        { id: "default", label: "Standard", isDefault: true },
        {
          id: "priority",
          label: "Fast",
          description: "Priority processing, increased usage",
        },
      ],
    });
  }
  return options;
}

/**
 * GET /api/model/options — the providers and models Hermes is configured for
 * (the dashboard's model picker). Slugs are `provider::model`; the gateway's
 * current default is marked. Older gateways without the endpoint → [].
 */
async function fetchHermesCatalog(baseUrl: string, key: string): Promise<ProviderModel[]> {
  try {
    const response = await fetch(`${apiRoot(baseUrl)}/api/model/options`, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as RawModelOptions;
    const models: ProviderModel[] = [];
    for (const provider of body.providers ?? []) {
      if (!provider.slug || provider.authenticated === false) continue;
      for (const raw of provider.models ?? []) {
        const id = typeof raw === "string" ? raw : (raw.id ?? raw.slug ?? "");
        if (!id) continue;
        const caps = provider.capabilities?.[id] ?? body.capabilities?.[id];
        models.push({
          slug: `${provider.slug}::${id}`,
          name:
            id === "default"
              ? (provider.name ?? provider.slug)
              : typeof raw === "string"
                ? raw
                : (raw.name ?? id),
          subProvider: provider.name ?? provider.slug,
          ...(provider.slug === body.provider && id === body.model ? { isDefault: true } : {}),
          options: hermesModelOptions(caps),
        });
      }
    }
    return models;
  } catch (error) {
    logger.info("agent", "hermes model options failed", {
      error: String(error),
    });
    return [];
  }
}

function turnModelFields(settings: HermesSettings): Record<string, unknown> {
  const { model, reasoningEffort, serviceTier } = settings;
  const [provider, modelId] = model.includes("::") ? model.split("::", 2) : ["", ""];
  const modelOptions: Record<string, unknown> = {};
  if (reasoningEffort === "none") modelOptions.reasoning = { enabled: false };
  else if (reasoningEffort) modelOptions.reasoning = { effort: reasoningEffort };
  if (serviceTier && serviceTier !== "default") modelOptions.service_tier = serviceTier;
  return {
    ...(modelId ? { model: modelId, provider } : {}),
    ...(Object.keys(modelOptions).length > 0 ? { model_options: modelOptions } : {}),
  };
}

export async function probeHermesSessions(baseUrl: string, key: string): Promise<boolean> {
  try {
    const response = await fetch(`${apiRoot(baseUrl)}/api/sessions?limit=1`, {
      headers: authHeaders(key),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchHermesModels(baseUrl: string, key: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/models`, {
    headers: authHeaders(key),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (response.status === 401) throw new Error("The API key was rejected (401).");
  if (!response.ok)
    throw new Error(`The server answered ${response.status}. Is that the API server URL?`);
  const data = (await response.json()) as { data?: { id?: string }[] };
  return (data.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}

/** A new session, which Hermes names itself from the first message (as its own apps' chats). */
async function createSession(ready: Ready): Promise<string> {
  const response = await fetch(`${ready.root}/api/sessions`, {
    method: "POST",
    headers: authHeaders(ready.key, true),
    body: JSON.stringify({ source: "api_server" }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as { session?: RawSession };
  const id = toSession(body.session ?? {}).id;
  if (!id) throw new Error("The server returned no session id.");
  return id;
}

type ResponsesTurn = {
  requestId: string;
  input: string;
  previousResponseId?: string;
  modelFields: Record<string, unknown>;
  ready: Ready;
  signal: AbortSignal;
  resetIdle: () => void;
  emit: Parameters<ChatProvider["sendTurn"]>[2];
};

async function streamResponsesTurn(ctx: ResponsesTurn): Promise<void> {
  const { requestId, input, previousResponseId, ready, signal, resetIdle, emit } = ctx;
  const response = await fetch(`${ready.baseUrl}/responses`, {
    method: "POST",
    headers: authHeaders(ready.key, true),
    body: JSON.stringify({
      model: ready.agentModel,
      ...ctx.modelFields,
      input,
      stream: true,
      store: true,
      ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    }),
    signal,
  });
  if (response.status === 401) return emit({ requestId, type: "error", message: "unauthorized" });
  if (!response.ok || !response.body)
    return emit({
      requestId,
      type: "error",
      message: `http_${response.status}`,
    });

  let responseId: string | null = null;
  const textStream = new TextStream(requestId, emit);
  await readSse(
    response.body,
    (_name, json) => {
      if (json === "[DONE]") return;
      const event = parseJson(json);
      if (!event) return;
      const type = String(event.type ?? "");
      if (type === "response.created" || type === "response.completed") {
        const resp = event.response as { id?: string } | undefined;
        if (resp?.id) responseId = resp.id;
      } else if (type === "response.output_text.delta") {
        textStream.append(String(event.delta ?? ""));
      } else if (type === "response.output_item.added" || type === "response.output_item.done") {
        const item = event.item as
          | {
              type?: string;
              id?: string;
              content?: unknown;
              name?: string;
              arguments?: string;
              output?: { text?: string }[] | string;
            }
          | undefined;
        if (item?.type === "message") {
          if (type === "response.output_item.added") textStream.start(item.id);
          textStream.snapshot(contentText(item.content));
        } else if (type === "response.output_item.added" && item?.type === "function_call") {
          emit({ requestId, type: "tool", step: hermesStep(item.name ?? "tool", item.arguments) });
        } else if (type === "response.output_item.added" && item?.type === "function_call_output") {
          const text = (
            typeof item.output === "string"
              ? item.output
              : (item.output ?? []).map((part) => part?.text ?? "").join("")
          ).slice(0, TOOL_OUTPUT_CHARS);
          emit({ requestId, type: "toolResult", output: text });
        }
      } else if (type === "response.failed") {
        const resp = event.response as { error?: { message?: string } } | undefined;
        emit({
          requestId,
          type: "error",
          message: resp?.error?.message ? `agent_error: ${resp.error.message}` : "agent_error",
        });
      }
    },
    resetIdle,
  );
  emit({ requestId, type: "done", responseId });
}

/** What an agent in an Otter chat is told about sending to Otter (send_message, a scheduled task's deliver). */
export const otterTargetsNote = (sessionId: string) =>
  [
    "You are in a chat in Otter, the user's app for mail, calendar and agents. Otter is one of your platforms (`otter`):",
    `- "otter:${sessionId}": this chat.`,
    '- "otter:new" (or "otter"): a new Otter chat for each delivery, for a scheduled task that should post a fresh chat every run (a morning brief, an alert).',
  ].join("\n");

async function patchSession(ready: Ready, sessionId: string, patch: Record<string, unknown>) {
  const response = await fetch(`${ready.root}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: authHeaders(ready.key, true),
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(await readError(response));
}

/**
 * Before a run of yours says it's done: where it ended in the session (its reply after the last
 * message of yours), so what Hermes writes after it is told apart, and, after a new chat's first
 * turn, the name Hermes gave the session.
 */
function ownRun(deliveries: Deliveries, run: Run, first: boolean): Run {
  const { ready, sessionId, requestId, emit } = run;
  run.finishing = async () => {
    const [rows, session] = await Promise.all([
      rawMessages(ready, sessionId, 50).catch(() => []),
      first ? sessionOf(ready, sessionId).catch(() => null) : null,
    ]);
    const reply = run.text.text.trim();
    const after = rows.slice(rows.findLastIndex((m) => m.role === "user") + 1);
    const end = after.find(
      (m) => m.role === "assistant" && contentText(m.content).trim() === reply,
    );
    if (reply && end?.id !== undefined) ranTo(deliveries, sessionId, end.id);
    const title = session?.title?.trim();
    if (title) emit({ requestId, type: "title", title });
  };
  return run;
}

export type HermesProvider = ChatProvider<HermesSettings> & {
  saveKey(key: string): Promise<void>;
};

function createHermes(agent: AgentContext): HermesProvider {
  const { id, secrets } = agent;
  const runs = newRuns(id);
  const deliveries = newDeliveries(agent, runs);
  let skillsCache: { at: number; baseUrl: string; data: Skill[] } | null = null;
  /** Hermes has Otter's plugin: its agent can send to Otter's chats. */
  let otterPlatform = false;
  /** Turns over the Responses API, which end when the app lets go of them. */
  const responding = new Map<string, AbortController>();

  return {
    otherSessions: true,
    saveKey: (key) => secrets.set("key", key),
    async settingsView() {
      return { hasKey: (await secrets.get("key")).length > 0 };
    },

    async checkStatus(settings) {
      const base = {
        version: null,
        models: [],
        model: null,
        sessions: false,
      };
      const key = await secrets.get("key");
      if (!settings.baseUrl || !key) {
        return {
          ...base,
          installed: false,
          status: "warning",
          auth: { status: "unknown" },
          message: "Add the API server URL and key to connect.",
        };
      }
      try {
        const ready = {
          baseUrl: settings.baseUrl,
          root: apiRoot(settings.baseUrl),
          key,
          agentModel: "",
        };
        const [agentModels, sessions, catalog, platforms] = await Promise.all([
          fetchHermesModels(settings.baseUrl, key),
          probeHermesSessions(settings.baseUrl, key),
          fetchHermesCatalog(settings.baseUrl, key),
          connectedPlatforms(ready).catch((): string[] => []),
        ]);
        otterPlatform = platforms.includes("otter");
        const models: ProviderModel[] =
          catalog.length > 0
            ? catalog
            : agentModels.map((slug) => ({
                slug: "",
                name: slug,
                isDefault: true,
              }));
        return {
          ...base,
          installed: true,
          status: "ready",
          auth: { status: "authenticated" },
          models,
          sessions,
          message: `${new URL(settings.baseUrl).host} · ${
            sessions ? "chats persist on Hermes" : "no Sessions API, chats chain by response id"
          }`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rejected = message.includes("401");
        return {
          ...base,
          installed: rejected,
          status: "error",
          auth: { status: rejected ? "unauthenticated" : "unknown" },
          message: rejected ? message : `Can't reach Hermes. Are you on Tailscale? (${message})`,
        };
      }
    },

    async sendTurn(turn, settings, emit) {
      const { requestId } = turn;
      const ready = await requireReady(settings, secrets).catch(() => null);
      if (!ready) return emit({ requestId, type: "error", message: "not_configured" });

      const input = turn.skill
        ? `[IMPORTANT: The user invoked the "${turn.skill.name}" skill. Load it with skill_view and follow its instructions.]${
            turn.input ? `\n\n${turn.input}` : ""
          }`
        : turn.input;

      // Attachments ride as content parts: images inline, text documents as text. Hermes' API
      // refuses other documents (PDF, Office).
      let message: string | unknown[] = input;
      if (turn.attachments?.length) {
        try {
          message = await hermesContent(input, turn.attachments);
        } catch (error) {
          return emit({
            requestId,
            type: "error",
            message: `agent_error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
      const modelFields = turnModelFields(settings);

      let sessionId = turn.sessionId;
      const first = !sessionId;
      if (!sessionId && !turn.previousResponseId && settings.sessions) {
        try {
          sessionId = await createSession(ready);
          emit({ requestId, type: "session", sessionId });
        } catch (error) {
          logger.info("agent", "hermes session create failed, chaining", {
            error: String(error),
          });
        }
      }

      if (sessionId) {
        let started: Awaited<ReturnType<typeof startRun>>;
        try {
          started = await startRun(
            ready,
            requestId,
            sessionId,
            message,
            modelFields,
            otterPlatform ? otterTargetsNote(sessionId) : undefined,
          );
        } catch (error) {
          logger.info("agent", "hermes run not started", { requestId, error: String(error) });
          return emit({ requestId, type: "error", message: "unreachable" });
        }
        if ("error" in started) return emit({ requestId, type: "error", message: started.error });
        await keepRun(id, requestId, { runId: started.runId, sessionId, at: Date.now() });
        return follow(
          runs,
          ownRun(deliveries, newRun(requestId, started.runId, sessionId, ready, emit), first),
        );
      }

      const controller = new AbortController();
      responding.set(requestId, controller);
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(new Error("idle_timeout")), IDLE_TIMEOUT_MS);
      };
      try {
        resetIdle();
        await streamResponsesTurn({
          requestId,
          input,
          previousResponseId: turn.previousResponseId,
          modelFields,
          ready,
          signal: controller.signal,
          resetIdle,
          emit,
        });
      } catch (err) {
        const reason = controller.signal.reason;
        const message = controller.signal.aborted
          ? reason instanceof Error && reason.message === "idle_timeout"
            ? "timeout"
            : "cancelled"
          : "unreachable";
        logger.info("agent", "hermes turn failed", {
          requestId,
          message,
          error: String(err),
        });
        emit({ requestId, type: "error", message });
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        responding.delete(requestId);
      }
    },

    /**
     * A run this device started and lost (the app quit, the connection stayed down) is followed
     * again from its first event; one started elsewhere, or no longer on the gateway, shows what
     * its session holds. A scheduled run that came to Otter is its session's reply.
     */
    async resume({ requestId, sessionId }, settings, emit) {
      const current = runs.following.get(requestId);
      if (current) {
        for (const pending of runs.pendingApprovals.values())
          if (pending.requestId === requestId)
            emit({ requestId, type: "approval", approval: pending.approval });
        return;
      }
      const ready = await requireReady(settings, secrets).catch(() => null);
      if (!ready) return emit({ requestId, type: "error", message: "detached" });
      try {
        if (requestId.startsWith(DELIVERED)) {
          emit({ requestId, type: "transcript", messages: await deliveredReply(ready, requestId) });
          return emit({ requestId, type: "done", responseId: null });
        }
        const kept = await keptRun(id, requestId);
        if (kept) {
          logger.info("agent", "hermes resume", { requestId, runId: kept.runId });
          emit({ requestId, type: "transcript", messages: [] });
          return await follow(
            runs,
            ownRun(deliveries, newRun(requestId, kept.runId, sessionId, ready, emit), false),
          );
        }
        const reply = await replyOf(ready, sessionId);
        if (!reply.some((m) => m.role === "assistant" && m.text.trim()))
          return emit({ requestId, type: "error", message: "detached" });
        emit({ requestId, type: "transcript", messages: reply });
        emit({ requestId, type: "done", responseId: null });
      } catch (error) {
        logger.info("agent", "hermes resume failed", { requestId, error: String(error) });
        emit({ requestId, type: "error", message: "detached" });
      }
    },

    watch(settings, sessions, started, read) {
      if (settings.sessions) watchDeliveries(deliveries, sessions, started, read);
    },

    delivered() {
      deliveredNow(deliveries);
    },

    async respondApproval(requestId, approvalId, decision) {
      const pending = runs.pendingApprovals.get(approvalId);
      if (!pending || pending.requestId !== requestId) return;
      const { ready, runId, emit } = pending;
      const response = await fetch(`${ready.root}/v1/runs/${encodeURIComponent(runId)}/approval`, {
        method: "POST",
        headers: authHeaders(ready.key, true),
        body: JSON.stringify({ choice: decision, request_id: approvalId }),
      });
      if (!response.ok && response.status !== 409) throw new Error(await readError(response));
      runs.pendingApprovals.delete(approvalId);
      emit({ requestId, type: "approvalResolved", approvalId });
    },

    cancel(requestId) {
      const run = runs.following.get(requestId);
      if (run) {
        void fetch(`${run.ready.root}/v1/runs/${encodeURIComponent(run.runId)}/stop`, {
          method: "POST",
          headers: authHeaders(run.ready.key),
        }).catch(() => {});
        run.stop.abort();
      }
      responding.get(requestId)?.abort();
    },

    /**
     * POST /v1/runs/{id}/steer — lands after the current batch of tool calls.
     * Right after the run starts the agent may not accept steers yet: retry briefly.
     */
    async steer(requestId, input) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const run = runs.following.get(requestId);
        if (!run) return false;
        const response = await fetch(
          `${run.ready.root}/v1/runs/${encodeURIComponent(run.runId)}/steer`,
          {
            method: "POST",
            headers: authHeaders(run.ready.key, true),
            body: JSON.stringify({ message: input }),
            signal: AbortSignal.timeout(1_200),
          },
        ).catch(() => null);
        if (response?.ok) return true;
        if (response?.status !== 409) return false;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return false;
    },

    async listSkills(settings) {
      const ready = await requireReady(settings, secrets).catch(() => null);
      if (!ready) return [];
      if (
        skillsCache &&
        skillsCache.baseUrl === ready.baseUrl &&
        Date.now() - skillsCache.at < 300_000
      )
        return skillsCache.data;
      try {
        const response = await fetch(`${ready.baseUrl}/skills`, {
          headers: authHeaders(ready.key),
        });
        if (!response.ok) return skillsCache?.data ?? [];
        const body = (await response.json()) as { data?: Skill[] } | Skill[];
        const raw = Array.isArray(body) ? body : (body.data ?? []);
        const skills = raw.map((s) => ({
          name: String(s.name ?? ""),
          description: String(s.description ?? ""),
          category: s.category ?? null,
        }));
        skillsCache = { at: Date.now(), baseUrl: ready.baseUrl, data: skills };
        return skills;
      } catch {
        return skillsCache?.data ?? [];
      }
    },

    async listSessions(settings, limit, everywhere) {
      const ready = await requireReady(settings, secrets);
      const sessions = everywhere
        ? await rawSessions(ready, limit)
        : (
            await Promise.all(OWN_SOURCES.map((source) => rawSessions(ready, limit, source)))
          ).flat();
      return sessions
        .map(toSession)
        .filter((s) => s.id)
        .sort((a, b) => b.lastActive - a.lastActive)
        .slice(0, limit);
    },

    async readSession(settings, sessionId) {
      return sessionMessages(await requireReady(settings, secrets), sessionId);
    },

    /** A name you give the chat is the session's on Hermes too; asked again, Hermes's own name for it. */
    async retitle(settings, sessionId, name) {
      const ready = await requireReady(settings, secrets);
      if ("title" in name) {
        await patchSession(ready, sessionId, { title: name.title });
        return name.title;
      }
      return (await sessionOf(ready, sessionId))?.title?.trim() || null;
    },

    schedules: hermesSchedules(agent),

    async deleteSession(settings, sessionId) {
      const ready = await requireReady(settings, secrets);
      const response = await fetch(`${ready.root}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        headers: authHeaders(ready.key),
      });
      if (!response.ok && response.status !== 404) throw new Error(await readError(response));
    },

    shutdown() {
      stopWatching(deliveries);
      for (const run of runs.following.values()) run.stop.abort(LET_GO);
      for (const controller of responding.values()) controller.abort();
    },
  };
}

export const hermesAgent: AgentType<HermesSettings> = {
  kind: "hermes",
  displayName: "Hermes",
  defaults: HERMES_DEFAULTS,
  fields: { enabled: "boolean", model: "string", reasoningEffort: "string", serviceTier: "string" },
  restartFields: ["baseUrl"],
  secrets: ["key"],
  syncedSecret: "key",
  create: createHermes,
};
