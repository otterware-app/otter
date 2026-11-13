/**
 * varys, through its SDK (@generalpursuit/varys) with this device's app grant, which works as
 * you. Each Otter chat is a varys thread and each turn a message of yours into it, sent with
 * Otter's request id as varys's and followed to its end over Live. Runs belong to varys, not
 * the app: a turn the app quit during is picked up again (`resume`).
 */

import type { Varys } from "@generalpursuit/varys";
import {
  getOtterUser,
  logger,
  readAttachment,
  type AgentContext,
  type AgentType,
  type ChatAttachment,
  type ChatProvider,
  type ChatSessionMessage,
  type Emit,
  type SendTurnInput,
} from "@otter/core/extension-kit";

import { TOKEN, answered, failed, varysConnection } from "./client.js";
import {
  AGENT_RUN,
  DELIVERED,
  agentRunTurn,
  deliveredNow,
  deliveredReply,
  newDeliveries,
  resumeAgentRun,
  stopWatching,
  watchDeliveries,
} from "./deliveries.js";
import { sameChoice, varysModels } from "./models.js";
import { revokeGrant } from "./relay.js";
import { varysSchedules } from "./schedules.js";
import { VARYS_DEFAULTS, type VarysSettings } from "./settings.js";
import { DETACHED, followTurn, messagesOf, newTurn, newTurns } from "./turns.js";

/** What Otter needs its grant to do: chats, and what they ask of you. */
const SCOPES = ["threads:read", "threads:write", "inbox"];

/** How far back a chat opened from varys's threads reads. */
const READ_ITEMS = 500;

async function upload(
  varys: Varys,
  threadId: string,
  draft: boolean,
  attachments: readonly ChatAttachment[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const attachment of attachments) {
    const bytes = await readAttachment(attachment);
    const file = new Blob([bytes.slice()], { type: attachment.mime });
    const uploaded = await answered(
      varys.threads.upload(threadId, file, { name: attachment.name, draft }),
    );
    ids.push(uploaded.attachmentId);
  }
  return ids;
}

/** A thread's items, the older ones too, up to `READ_ITEMS`. */
async function threadItems(varys: Varys, threadId: string) {
  const { conversation } = await answered(varys.threads.read(threadId));
  const pages = [conversation.items];
  let count = conversation.items.length;
  let earlier = conversation.earlier;
  while (earlier && count < READ_ITEMS) {
    const before = pages[0][0]?.id;
    if (!before) break;
    const page = await answered(varys.threads.older(threadId, { before, limit: 100 }));
    if (page.items.length === 0) break;
    pages.unshift(page.items);
    count += page.items.length;
    earlier = page.earlier;
  }
  return pages.flat();
}

/** A message picks a skill by naming it, as varys reads it. */
const withSkill = ({ input, skill }: SendTurnInput) =>
  skill ? `Use the skill \`${skill.name}\`.${input ? `\n\n${input}` : ""}` : input;

async function emitTitle(varys: Varys, threadId: string, requestId: string, emit: Emit) {
  const view = await varys.threads.read(threadId);
  if (view.isOk()) emit({ requestId, type: "title", title: view.value.title });
}

export type VarysProvider = ChatProvider<VarysSettings> & {
  /** The client for this device's grant; null while it isn't paired. */
  client(settings: VarysSettings): Promise<Varys | null>;
  /** Keeps a new grant's token, or forgets the grant (null): what the last one followed ends. */
  grant(token: string | null): Promise<void>;
};

export const varysAgent: AgentType<VarysSettings> = {
  kind: "varys",
  displayName: "varys",
  defaults: VARYS_DEFAULTS,
  fields: { enabled: "boolean", model: "string", reasoningEffort: "string", serviceTier: "string" },
  // A model the owner's logins can't use now falls back to varys's default.
  strictModels: true,
  // Each device pairs on its own, with a grant of its own.
  deviceFields: ["address", "agentId", "installation", "relayChannel"],
  secrets: [TOKEN],
  create: createVarys,
};

export function createVarys(agent: AgentContext): VarysProvider {
  const connection = varysConnection(agent);
  const catalog = varysModels();
  const turns = newTurns();
  const deliveries = newDeliveries(turns);
  const turnOf = (requestId: string) =>
    turns.following.get(requestId)?.turn ?? agentRunTurn(deliveries, requestId);

  const provider: VarysProvider = {
    client: connection.client,

    async grant(token) {
      provider.shutdown();
      if (token) await agent.secrets.set(TOKEN, token);
      else await agent.secrets.delete(TOKEN);
    },

    async settingsView(settings) {
      return {
        paired: (await agent.secrets.get(TOKEN)).length > 0,
        relay: settings.relayChannel ? "on" : getOtterUser() ? "off" : "signedOut",
      };
    },

    async checkStatus(settings) {
      const base = {
        version: null,
        models: [{ slug: "", name: "varys", isDefault: true }],
        model: null,
        sessions: true,
      };
      const varys = await connection.client(settings).catch(() => null);
      if (!varys)
        return {
          ...base,
          installed: false,
          status: "warning",
          auth: { status: "unknown" },
          message: "Pair with an app code from varys to connect.",
        };
      const me = await varys.me();
      if (me.isErr())
        return {
          ...base,
          installed: true,
          status: "error",
          auth: { status: me.error.code === "signed_out" ? "unauthenticated" : "unknown" },
          message: me.error.message,
        };
      const host = new URL(settings.address).host;
      const missing = SCOPES.filter((scope) => !me.value.scopes.includes(scope as never));
      if (me.value.actsAs !== "client" || missing.length > 0)
        return {
          ...base,
          installed: true,
          status: "warning",
          auth: { status: "authenticated", label: me.value.name },
          message: `${host}: this app code doesn't work as you with chats and approvals. Make one with the Chat client preset, and pair again.`,
        };
      const listed = await catalog.list(varys);
      const models = "models" in listed && listed.models.length > 0 ? listed.models : base.models;
      return {
        ...base,
        installed: true,
        status: "ready",
        auth: { status: "authenticated", label: me.value.name },
        models,
        message:
          "refused" in listed && listed.refused === "FORBIDDEN"
            ? `${host} · Pair again to pick varys's models here.`
            : host,
      };
    },

    async sendTurn(turn, settings, emit) {
      const { requestId } = turn;
      const varys = await connection.client(settings).catch(() => null);
      if (!varys) return emit({ requestId, type: "error", message: "not_configured" });
      const first = !turn.sessionId;
      const threadId = turn.sessionId ?? crypto.randomUUID();
      let sent;
      try {
        const [attachments, choice] = await Promise.all([
          upload(varys, threadId, first, turn.attachments ?? []),
          catalog.choiceOf(varys, settings),
        ]);
        const message = {
          requestId,
          text: withSkill(turn),
          ...(attachments.length > 0 && { attachments }),
        };
        if (!first && choice) {
          const { model } = await answered(varys.threads.read(threadId));
          if (!sameChoice(model, choice)) await answered(varys.threads.setModel(threadId, choice));
        }
        sent = first
          ? await varys.threads.start({
              id: threadId,
              ...message,
              ...(choice && { model: choice }),
            })
          : await varys.threads.send(threadId, message);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return emit({ requestId, type: "error", message: failed({ message }) });
      }
      if (sent.isErr()) {
        logger.info("agent", "varys message not taken", { requestId, code: sent.error.code });
        return emit({ requestId, type: "error", message: failed(sent.error) });
      }
      if (first) emit({ requestId, type: "session", sessionId: threadId });
      await followTurn(newTurn(turns, requestId, threadId, varys, emit));
      if (first) await emitTitle(varys, threadId, requestId, emit);
    },

    /**
     * A turn this device lost: what's asked again where it still follows it, else followed again
     * from its start (the run so far, then the rest). A run the agent started, or what it wrote
     * while no run was followed, shows as its chat follows it.
     */
    async resume({ requestId, sessionId }, settings, emit) {
      const current = turns.following.get(requestId);
      if (current) {
        for (const { requestId: owner, ask } of turns.asks.values()) {
          if (owner !== requestId) continue;
          emit(
            "approval" in ask
              ? { requestId, type: "approval", approval: ask.approval }
              : { requestId, type: "question", question: ask.question },
          );
        }
        return;
      }
      const varys = await connection.client(settings).catch(() => null);
      if (!varys) return emit({ requestId, type: "error", message: DETACHED });
      try {
        if (requestId.startsWith(AGENT_RUN))
          return await resumeAgentRun(deliveries, varys, requestId, sessionId, emit);
        if (requestId.startsWith(DELIVERED)) {
          emit({ requestId, type: "transcript", messages: await deliveredReply(varys, requestId) });
          return emit({ requestId, type: "done", responseId: null });
        }
      } catch (error) {
        logger.info("agent", "varys resume failed", { requestId, error: String(error) });
        return emit({ requestId, type: "error", message: DETACHED });
      }
      const receipt = await varys.receipt(requestId);
      if (receipt.isErr())
        return emit({
          requestId,
          type: "error",
          message: receipt.error.code === "RECEIPT_NOT_FOUND" ? "not_received" : DETACHED,
        });
      logger.info("agent", "varys resume", { requestId });
      emit({ requestId, type: "transcript", messages: [] });
      await followTurn(newTurn(turns, requestId, sessionId, varys, emit));
    },

    watch(settings, sessions, started, read) {
      void connection
        .client(settings)
        .then(
          (varys) => varys && watchDeliveries(deliveries, varys, settings, sessions, started, read),
        )
        .catch((error: unknown) =>
          logger.info("agent", "varys watch failed", { error: String(error) }),
        );
    },

    delivered(_settings, sessionKey) {
      deliveredNow(deliveries, sessionKey);
    },

    cancel(requestId) {
      const turn = turnOf(requestId);
      if (!turn) return;
      // The chat stops at once; varys stops the run, or its wait for your answer.
      turns.following.get(requestId)?.end({ requestId, type: "error", message: "cancelled" });
      void turn.varys.threads.stop(turn.threadId).then((stopped) => {
        if (stopped.isErr())
          logger.info("agent", "varys didn't stop", { requestId, code: stopped.error.code });
      });
    },

    /** Joins the run after its current step. */
    async steer(requestId, input) {
      const turn = turnOf(requestId);
      if (!turn) return false;
      return (await turn.varys.threads.steer(turn.threadId, { text: input })).isOk();
    },

    async respondApproval(requestId, approvalId, decision) {
      const turn = turnOf(requestId);
      if (!turn || turns.asks.get(approvalId)?.requestId !== requestId) return;
      const decided = await turn.varys.inbox.decide(approvalId, {
        approve: decision !== "deny",
        ...(decision === "session" && { inThread: true }),
      });
      // Answered already: here, on another device, or in varys.
      if (decided.isErr() && decided.error.code !== "INBOX_ITEM_CLOSED")
        throw new Error(decided.error.message);
      turns.asks.delete(approvalId);
      turn.emit({ requestId, type: "approvalResolved", approvalId });
    },

    /** Skipped, a question stays in varys's inbox, to answer there. */
    async answerQuestion(requestId, questionId, answers) {
      const turn = turnOf(requestId);
      if (!turn || turns.asks.get(questionId)?.requestId !== requestId) return;
      const text = answers?.[questionId]?.join(", ").trim();
      if (text) {
        const sent = await turn.varys.inbox.answer(questionId, text);
        if (sent.isErr() && sent.error.code !== "INBOX_ITEM_CLOSED")
          throw new Error(sent.error.message);
      }
      turns.asks.delete(questionId);
      turn.emit({ requestId, type: "questionResolved", questionId });
    },

    async listSkills(settings) {
      const varys = await connection.client(settings).catch(() => null);
      if (!varys) return [];
      const skills = await varys.skills.list();
      if (skills.isErr()) {
        logger.info("agent", "varys skills unavailable", { code: skills.error.code });
        return [];
      }
      return skills.value.map(({ name, description }) => ({ name, description, category: null }));
    },

    async listSessions(settings, limit) {
      const varys = await connection.client(settings);
      if (!varys) return [];
      const { threads } = await answered(varys.threads.list());
      return threads.slice(0, limit).map((thread) => ({
        id: thread.id,
        title: thread.title,
        // A routine's threads say so, as its chats on Scheduled do.
        source: thread.routine ? `Scheduled · ${thread.routine.title}` : "varys",
        lastActive: Date.parse(thread.updatedAt),
        // varys doesn't count a thread's messages: one with none has no preview.
        messageCount: thread.preview ? 1 : 0,
        preview: thread.preview?.text ?? null,
      }));
    },

    async readSession(settings, sessionId): Promise<ChatSessionMessage[]> {
      const varys = await connection.client(settings);
      if (!varys) throw new Error("Connect varys in Settings first.");
      return messagesOf(await threadItems(varys, sessionId));
    },

    /** A name you give the chat is the thread's in varys too; asked again, varys's own name for it. */
    async retitle(settings, sessionId, name) {
      const varys = await connection.client(settings);
      if (!varys) throw new Error("Connect varys in Settings first.");
      if ("title" in name) {
        await answered(varys.threads.rename(sessionId, name.title));
        return name.title;
      }
      return (await answered(varys.threads.read(sessionId))).title;
    },

    // Deleting a thread is for your own devices in varys: the chat goes, the thread stays.
    async deleteSession() {},

    schedules: varysSchedules(agent.id, connection),

    async remove(settings) {
      await revokeGrant(agent.id, await connection.client(settings).catch(() => null), settings);
    },

    shutdown() {
      for (const { turn, end } of turns.following.values())
        end({ requestId: turn.requestId, type: "error", message: DETACHED });
      stopWatching(deliveries);
      catalog.forget();
      connection.close();
    },
  };
  return provider;
}
