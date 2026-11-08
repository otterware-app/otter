import { randomUUID } from "node:crypto";
import {
  createChannelPluginBase,
  createChatChannelPlugin,
  defineChannelPluginEntry,
} from "openclaw/plugin-sdk/channel-core";
import { toInboundMediaFacts } from "openclaw/plugin-sdk/channel-inbound";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-outbound";
import { runInDetachedAsyncContext } from "openclaw/plugin-sdk/concurrency-runtime";
import { defineStableChannelIngressIdentity } from "openclaw/plugin-sdk/channel-ingress-runtime";
import { resolveAgentWorkspaceDir } from "openclaw/plugin-sdk/agent-runtime";
import { dispatchGatewayMethod } from "openclaw/plugin-sdk/gateway-method-runtime";
import { resolveAgentIdFromSessionKey } from "openclaw/plugin-sdk/routing";
import { resolveOAuthDir } from "openclaw/plugin-sdk/state-paths";
import { createBrowserControl } from "./control.js";
import { runDetachedWebhookWork } from "openclaw/plugin-sdk/webhook-request-guards";
import { readWorkspaceFile } from "./files.js";
import { BROWSER_PROFILE, relayKey, SHARED_TABS_NOTE } from "./relay.js";
import {
  accountOf,
  chatOf,
  chatTarget,
  deliver,
  isNewChat,
  isOwnerConfigured,
  messageOf,
  newChatKey,
  otterTargetsNote,
  OWNER,
  startDetached,
  targetOf,
  TARGETS_HINT,
} from "./otter.js";

const owner = defineStableChannelIngressIdentity({
  key: "otter-sender",
  normalize: (value) => String(value).trim(),
  sensitivity: "pii",
});

let logger;
const warn = (message) => logger?.warn?.(message);

export const otterChannel = createChatChannelPlugin({
  base: {
    ...createChannelPluginBase({
      id: "otter",
      meta: { label: "Otter", blurb: "Send what your agents want you to see to Otter." },
      capabilities: { chatTypes: ["direct"] },
      config: {
        listAccountIds: (cfg) => (cfg?.channels?.otter ? ["default"] : []),
        resolveAccount: (cfg) => accountOf(cfg),
        inspectAccount: (cfg) => {
          const account = accountOf(cfg);
          return {
            enabled: account.enabled,
            configured: Boolean(cfg?.channels?.otter),
            tokenStatus: account.token ? "available" : "missing",
          };
        },
      },
    }),
    // Nothing to keep connected, but a channel that doesn't stay started reads as stopped, and the
    // gateway's health monitor restarts it every few minutes.
    gateway: { startAccount: (ctx) => waitUntilAbort(ctx.abortSignal) },
    messaging: {
      targetResolver: {
        looksLikeId: () => true,
        hint: TARGETS_HINT,
      },
      // A delivery to a chat is kept in its session; to "chat:new", in a chat it starts (the gateway
      // routes each delivery once, and sends it to that session).
      resolveOutboundSessionRoute: ({ agentId, target }) => {
        const to = targetOf(target);
        if (!to) return null;
        const sessionKey = isNewChat(to) ? newChatKey(agentId, randomUUID()) : chatOf(to);
        return {
          sessionKey,
          baseSessionKey: sessionKey,
          recipientSessionExact: true,
          peer: { kind: "direct", id: to },
          chatType: "direct",
          from: "otter",
          to,
        };
      },
    },
  },
  outbound: {
    deliveryMode: "direct",
    resolveTarget: (params) => {
      const to = targetOf(params?.to);
      return to
        ? { ok: true, to }
        : { ok: false, error: new Error(`Otter's targets are ${TARGETS_HINT}.`) };
    },
    sendText: (ctx) => deliver(ctx, undefined, { warn }),
    sendPayload: (ctx) => deliver(ctx, ctx.payload, { warn }),
  },
});

/** What you sent from Otter as the channel's owner: an inbound message, as from any chat app. */
async function inboundOf(api, message) {
  const { sessionKey, agentId, text, messageId, files } = message;
  const inbound = api.runtime.channel.inbound;
  const saved = await Promise.all(
    files.map((file) =>
      api.runtime.channel.media.saveMediaBuffer(
        Buffer.from(file.content, "base64"),
        file.mimeType,
        "inbound",
        undefined,
        typeof file.fileName === "string" ? file.fileName : undefined,
      ),
    ),
  );
  const channelIngress = await inbound.ingress.resolve({
    channelId: "otter",
    accountId: "default",
    identity: owner,
    subject: { stableId: OWNER },
    conversation: { kind: "direct", id: sessionKey },
    contextBinding: { agentId, sessionKey, messageId, inboundEventKind: "user_request" },
    event: { kind: "message", authMode: "inbound", mayPair: false },
    policy: { dmPolicy: "allowlist" },
    allowFrom: [OWNER],
    readStoreAllowFrom: async () => [],
  });
  const to = chatTarget(sessionKey);
  return inbound.buildContext({
    channelIngress,
    channel: "otter",
    accountId: "default",
    messageId,
    timestamp: Date.now(),
    from: `otter:${OWNER}`,
    sender: { id: OWNER, name: "Otter" },
    conversation: { kind: "direct", id: sessionKey },
    route: { agentId, accountId: "default", routeSessionKey: sessionKey },
    reply: { to, originatingTo: to },
    message: { body: text, rawBody: text, commandBody: text, bodyForAgent: text },
    ...(saved.length > 0 && {
      media: toInboundMediaFacts(
        saved.map((file) => ({ path: file.path, contentType: file.contentType, messageId })),
      ),
    }),
  });
}

function dispatch(api, cfg, { agentId, sessionKey, messageId }, ctxPayload) {
  return api.runtime.channel.inbound.dispatch({
    cfg,
    channel: "otter",
    accountId: "default",
    route: { agentId, sessionKey },
    ctxPayload,
    replyOptions: { runId: messageId, sourceReplyDeliveryMode: "automatic" },
    // The reply is kept in the chat's session, which Otter is reading as it's written.
    delivery: { deliver: async () => ({ visibleReplySent: true }) },
  });
}

export default defineChannelPluginEntry({
  id: "otter",
  name: "Otter",
  description: "Send what your agents want you to see to Otter.",
  plugin: otterChannel,
  registerFull(api) {
    logger = api.logger;
    // What Otter's targets are, for a turn in an Otter chat: the Codex harness leaves channels'
    // message-tool hints out of its instructions, but every harness runs this hook.
    api.on("before_prompt_build", (_event, ctx) =>
      ctx?.channel === "otter" || ctx?.messageProvider === "otter"
        ? { appendSystemContext: `${otterTargetsNote(ctx.sessionKey)}\n\n${SHARED_TABS_NOTE}` }
        : undefined,
    );

    // What you send in an Otter chat, as the gateway's owner: `chat.send`'s run, with the authority
    // a configured channel owner has (an automation another chat made, for one).
    api.registerGatewayMethod(
      "otter.chat.send",
      async ({ params, context }) => {
        const cfg = context?.getRuntimeConfig?.() ?? api.config;
        if (!isOwnerConfigured(cfg)) throw new Error("otter_not_owner");
        const message = messageOf(params);
        // The run starts outside the request that carried it (the gateway's context-free root,
        // whatever request loaded this plugin), so it's the channel owner's, not that
        // connection's, and outlives it. What fails before it starts fails the request.
        await startDetached(
          (work, fail) => runInDetachedAsyncContext(() => runDetachedWebhookWork(work).catch(fail)),
          () => inboundOf(api, message),
          (ctxPayload) => dispatch(api, cfg, message, ctxPayload),
          (error) => warn(`otter: a message from Otter failed: ${String(error)}`),
        );
        return { runId: message.messageId, status: "started" };
      },
      { scope: "operator.admin" },
    );

    // Otter's preview of a file an agent linked: PDFs and other files sessions.files.get won't send.
    api.registerGatewayMethod(
      "otter.files.get",
      async ({ params, context }) => {
        const { sessionKey, path } = params ?? {};
        if (typeof sessionKey !== "string" || typeof path !== "string" || !path)
          throw new Error("sessionKey and path are required");
        const cfg = context?.getRuntimeConfig?.() ?? api.config;
        const workspace = resolveAgentWorkspaceDir(cfg, resolveAgentIdFromSessionKey(sessionKey));
        return { file: await readWorkspaceFile(workspace, path) };
      },
      { scope: "operator.read" },
    );

    // Take control of the agent's browser from Otter: your input goes to the tab as a person's
    // would, and the agent's browser waits until you hand it back.
    const browser = async (method, path, query, body) => {
      const result = await dispatchGatewayMethod("browser.request", {
        method,
        path,
        ...(query ? { query } : {}),
        ...(body ? { body } : {}),
      });
      if (!result?.ok) throw new Error(result?.error?.message ?? "The browser didn't answer.");
      return result.payload;
    };
    const pendingDialog = async (targetId, profile) => {
      const query = { ...(profile ? { profile } : {}), targetId };
      return (await browser("GET", "/dialogs", query))?.browserState?.dialogs?.pending?.[0];
    };
    const control = createBrowserControl({
      async openDialog(targetId, profile) {
        const open = await pendingDialog(targetId, profile);
        return open
          ? {
              dialogType: String(open.type),
              message: String(open.message ?? ""),
              defaultPrompt: String(open.defaultValue ?? ""),
            }
          : null;
      },
      async answerDialog(targetId, profile, { accept, promptText }) {
        const pending = await pendingDialog(targetId, profile);
        if (!pending) throw new Error("No pop-up is open.");
        await browser("POST", "/hooks/dialog", profile ? { profile } : undefined, {
          targetId,
          dialogId: pending.id,
          accept,
          ...(typeof promptText === "string" ? { promptText } : {}),
        });
      },
      async cdpUrlFor(profile) {
        const profiles = (await browser("GET", "/profiles"))?.profiles ?? [];
        const found = profiles.find((p) => (profile ? p.name === profile : p.isDefault));
        const url = typeof found?.cdpUrl === "string" ? URL.parse(found.cdpUrl) : null;
        if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
          throw new Error("This browser can't be controlled from Otter.");
        return url.href;
      },
    });
    api.lifecycle?.onDispose?.(() => control.dispose());
    const targetOf = (params) => {
      if (typeof params?.targetId !== "string" || !params.targetId)
        throw new Error("targetId is required");
      return params.targetId;
    };
    const profileOf = (params) =>
      typeof params?.profile === "string" ? params.profile : undefined;
    api.registerGatewayMethod(
      "otter.browser.control",
      async ({ params }) => {
        if (params?.take === true) await control.take(targetOf(params), profileOf(params));
        else control.release(targetOf(params));
        return { controlled: params?.take === true };
      },
      { scope: "operator.admin" },
    );
    api.registerGatewayMethod(
      "otter.browser.input",
      async ({ params }) => {
        await control.input(targetOf(params), profileOf(params), params?.seq, params?.events);
        return {};
      },
      { scope: "operator.admin" },
    );
    api.registerGatewayMethod(
      "otter.browser.events",
      ({ params }) =>
        control.events(
          targetOf(params),
          profileOf(params),
          params?.since,
          params?.waitMs,
          params?.run,
        ),
      { scope: "operator.admin" },
    );
    api.registerGatewayMethod(
      "otter.browser.upload",
      async ({ params }) => {
        await control.upload(targetOf(params), profileOf(params), params?.files);
        return {};
      },
      { scope: "operator.admin" },
    );
    // The tabs you share from Otter's browser: Otter connects to the gateway's extension relay
    // as OpenClaw's Chrome extension does, with the relay's key from here.
    api.registerGatewayMethod(
      "otter.browser.pairing",
      async () => ({ key: await relayKey(resolveOAuthDir()), profile: BROWSER_PROFILE }),
      { scope: "operator.admin" },
    );
    api.on("before_tool_call", (event) =>
      /(^|__)browser$/.test(event.toolName) && !control.allows(event.params)
        ? {
            block: true,
            blockReason:
              "The user has taken control of the browser. Reading pages still works; wait until they hand it back before acting on one.",
          }
        : undefined,
    );
  },
});
