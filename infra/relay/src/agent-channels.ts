/**
 * Agent channels: an agent's gateway (an OpenClaw or Hermes plugin) tells the
 * account's devices it has delivered something for the user. It sends a
 * pointer, with the chat's title and the agent's name for an iPhone's alert, never the text;
 * the devices read that from the gateway themselves. The relay passes pointers on and keeps none.
 */

import { zValidator } from "@hono/zod-validator";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { agentTokenHash, newAgentToken } from "@otter/contracts/agent-tokens";
import type { AgentChannel, AgentPointer } from "@otter/contracts/relay";

import { agentChannels } from "./schema.ts";
import type { App } from "./worker.ts";

export const CHANNEL_TOKEN_PREFIX = "otter_ch_";
const MAX_CHANNELS = 20;
/** How stale `lastUsedAt` may get before a pointer writes it again. */
const LAST_USED_EVERY_MS = 60 * 60 * 1000;

const id = z.string().max(200);
/** Words for an alert, cut to fit rather than turned away: a long title shouldn't cost the push. */
const shown = (limit: number) =>
  z
    .string()
    .trim()
    .transform((text) => Array.from(text).slice(0, limit).join(""));
const pointer = z.strictObject({
  kind: z.enum(["message", "question", "approval", "finished"]),
  agentId: z.string().min(1).max(100),
  sessionKey: z.string().max(300).nullable(),
  approvalId: id.optional(),
  approvalKind: z.enum(["exec", "plugin"]).optional(),
  resolved: z.boolean().optional(),
  questionId: id.optional(),
  title: shown(200).optional(),
  agentName: shown(100).optional(),
  at: z.number().int().nonnegative(),
});

const invalid = (result: { success: boolean }) => {
  if (!result.success) throw new HTTPException(400, { message: "Invalid request." });
};

/** The account's channels, behind the session check (worker.ts's `authed`). */
export function routes(): Hono<App> {
  const app = new Hono<App>();
  app.get("/agent-channels", async (c) => {
    const rows = await c.var.db
      .select()
      .from(agentChannels)
      .where(eq(agentChannels.userId, c.var.session.user.id));
    return c.json({
      channels: rows.map((r): AgentChannel => ({
        id: r.id,
        label: r.label,
        createdAt: r.createdAt.getTime(),
        lastUsedAt: r.lastUsedAt?.getTime() ?? null,
      })),
    });
  });
  app.post(
    "/agent-channels",
    zValidator("json", z.object({ label: z.string().trim().min(1).max(100) }), invalid),
    async (c) => {
      const userId = c.var.session.user.id;
      const [{ n }] = await c.var.db
        .select({ n: count() })
        .from(agentChannels)
        .where(eq(agentChannels.userId, userId));
      if (n >= MAX_CHANNELS) throw new HTTPException(413, { message: "Too many agent channels." });
      const { token, hash } = await newAgentToken(CHANNEL_TOKEN_PREFIX);
      const channel: AgentChannel = {
        id: crypto.randomUUID(),
        label: c.req.valid("json").label,
        createdAt: Date.now(),
        lastUsedAt: null,
      };
      await c.var.db.insert(agentChannels).values({
        id: channel.id,
        userId,
        tokenHash: hash,
        label: channel.label,
        createdAt: new Date(channel.createdAt),
      });
      return c.json({ channel, token });
    },
  );
  app.delete("/agent-channels/:id", async (c) => {
    await c.var.db
      .delete(agentChannels)
      .where(
        and(
          eq(agentChannels.userId, c.var.session.user.id),
          eq(agentChannels.id, c.req.param("id")),
        ),
      );
    return c.body(null, 204);
  });
  return app;
}

/** Where gateways send pointers, with their channel's token instead of a session. */
export function gatewayRoutes(
  publish: (env: App["Bindings"], userId: string, pointer: AgentPointer) => Promise<unknown>,
  /** Told after the gateway has its answer: a slow push doesn't hold up the agent's delivery. */
  notify: (env: App["Bindings"], userId: string, pointer: AgentPointer) => Promise<unknown>,
): Hono<App> {
  const app = new Hono<App>();
  app.post(
    "/channel/v1/pointers",
    bodyLimit({
      maxSize: 4096,
      onError: () => {
        throw new HTTPException(413, { message: "Too large." });
      },
    }),
    async (c, next) => {
      const token = c.req.header("authorization")?.match(/^Bearer (\S+)$/)?.[1];
      if (!token?.startsWith(CHANNEL_TOKEN_PREFIX))
        throw new HTTPException(401, { message: "Missing channel token." });
      await next();
    },
    zValidator("json", pointer, invalid),
    async (c) => {
      const token = c.req.header("authorization")!.slice("Bearer ".length);
      const [channel] = await c.var.db
        .select()
        .from(agentChannels)
        .where(eq(agentChannels.tokenHash, await agentTokenHash(token)));
      if (!channel) throw new HTTPException(401, { message: "Unknown channel token." });
      const now = Date.now();
      if (!channel.lastUsedAt || now - channel.lastUsedAt.getTime() > LAST_USED_EVERY_MS)
        await c.var.db
          .update(agentChannels)
          .set({ lastUsedAt: new Date(now) })
          .where(eq(agentChannels.id, channel.id));
      const told = { ...c.req.valid("json"), channel: channel.id };
      // A finished run is for the phones alone: an open app follows the run itself, and builds
      // from before this kind would take it for something the agent sent.
      if (told.kind !== "finished") await publish(c.env, channel.userId, told);
      c.executionCtx.waitUntil(notify(c.env, channel.userId, told).catch(() => {}));
      return c.body(null, 202);
    },
  );
  return app;
}
