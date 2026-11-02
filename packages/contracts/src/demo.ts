/**
 * The demo mailboxes `pnpm dev:demo` and `pnpm dev:demo:desktop` open with
 * (docs/development.md): real mailboxes for development, never the user's own.
 * One variable, OTTER_MAIL_DEMO_MAILBOXES, holds them as a JSON list in the
 * main checkout's ignored `.env.local`; the dev runner adds the local IMAP
 * server's (`pnpm dev:mail`) and hands the list to the app, which adds the
 * ones it doesn't have yet. Development runs only: never in a build.
 */

import { z } from "zod";

export const DEMO_MAILBOXES_ENV = "OTTER_MAIL_DEMO_MAILBOXES";

const server = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  security: z.enum(["tls", "starttls"]),
});

export const demoGmailMailbox = z.object({
  provider: z.literal("gmail"),
  email: z.email(),
  password: z.string().optional(),
  refreshTokens: z
    .object({ desktop: z.string().min(1).optional(), web: z.string().min(1).optional() })
    .default({}),
});

export const demoOutlookMailbox = z.object({
  provider: z.literal("outlook"),
  email: z.email(),
  password: z.string().optional(),
  refreshTokens: z
    .object({ desktop: z.string().min(1).optional(), web: z.string().min(1).optional() })
    .default({}),
});

export const demoImapMailbox = z.object({
  provider: z.literal("imap"),
  email: z.email(),
  password: z.string().min(1),
  username: z.string().min(1).optional(),
  imap: server,
  smtp: server,
});

export const demoMailboxes = z.array(
  z.discriminatedUnion("provider", [demoGmailMailbox, demoOutlookMailbox, demoImapMailbox]),
);

export type DemoGmailMailbox = z.infer<typeof demoGmailMailbox>;
export type DemoOutlookMailbox = z.infer<typeof demoOutlookMailbox>;
export type DemoImapMailbox = z.infer<typeof demoImapMailbox>;
export type DemoMailbox = DemoGmailMailbox | DemoOutlookMailbox | DemoImapMailbox;

export function parseDemoMailboxes(json: string): DemoMailbox[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch (err) {
    throw new Error(`${DEMO_MAILBOXES_ENV} isn't JSON: ${String(err)}`, { cause: err });
  }
  const result = demoMailboxes.safeParse(value);
  if (!result.success) {
    throw new Error(`${DEMO_MAILBOXES_ENV} is invalid:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
