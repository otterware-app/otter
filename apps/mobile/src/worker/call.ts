import { callHandler } from "@otter-mail/core";

/** One of core's handlers, called where core runs. */
export async function call<T>(channel: string, params?: unknown): Promise<T> {
  const reply = await callHandler(channel, params);
  if ("error" in reply) throw new Error(reply.error);
  return reply.result as T;
}
