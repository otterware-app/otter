/**
 * What a tool is, and what it's handed. The tools read and change the user's
 * mailboxes through the same handlers the app's windows call (so an agent's
 * archive mirrors into the cache, orders its writes and updates the lists
 * like a click would) and through each mailbox's provider, never Gmail or
 * IMAP themselves: every account kind gets the same tools.
 */

import { registeredHandlers } from "../../../ipc.js";
import { turnedOffMailboxes } from "../../mail-sync.js";
import type { AgentAccess } from "@otter-mail/contracts/agent-tokens";
import type { ChatChange } from "@otter-mail/contracts";

import type { MailAccount } from "../../../types.js";
import type { Emit, RuntimeMode } from "../types.js";

export type ToolFiles = {
  save(name: string, bytes: Uint8Array): Promise<string>;
  read(path: string): Promise<{ name: string; bytes: Uint8Array }>;
};

export type ToolCaller = {
  /** The chat's runtime mode now: full access makes changes without asking. */
  mode(): RuntimeMode;
  turn(): { requestId: string; emit: Emit } | null;
  access?(): AgentAccess;
  files?: ToolFiles;
};

export type ToolContext = {
  caller: ToolCaller;
  changed?(change: ChatChange): void;
  /**
   * Asks the user before a change (unless the chat has full access or they
   * allowed this tool for the chat); throws when they decline. `detail` is
   * exactly what will happen, shown verbatim.
   */
  confirm(detail: string): Promise<void>;
};

export type ToolArgs = Record<string, unknown>;

export type AgentTool = {
  name: string;
  title: string;
  description: string;
  input: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  /** Only reads. Anything else confirms before changing a mailbox. */
  readOnly?: boolean;
  /** Can't be undone: it sends something to someone, or deletes for good. Not "safe". */
  permanent?: boolean;
  /** Needs files on this device (attachments). */
  needsFiles?: boolean;
  run(args: ToolArgs, ctx: ToolContext): Promise<unknown>;
};

export function str(args: ToolArgs, key: string): string {
  const value = optStr(args, key);
  if (!value) throw new Error(`"${key}" is required.`);
  return value;
}

export function optStr(args: ToolArgs, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`"${key}" must be a string.`);
  return value.trim() || undefined;
}

export function strList(args: ToolArgs, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : [value];
  if (!list.every((v) => typeof v === "string"))
    throw new Error(`"${key}" must be a list of strings.`);
  return list.map((v) => v.trim()).filter(Boolean);
}

export function optBool(args: ToolArgs, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`"${key}" must be true or false.`);
  return value;
}

export function optInt(args: ToolArgs, key: string, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1)
    throw new Error(`"${key}" must be a positive number.`);
  return Math.min(Math.floor(value), max);
}

/** Calls one of the backend's handlers, as a window would. */
export async function invoke<T>(channel: string, params: Record<string, unknown>): Promise<T> {
  const handler = registeredHandlers().get(channel);
  if (!handler) throw new Error(`No handler for ${channel}.`);
  return (await handler(params)) as T;
}

/** Every mailbox, with its capabilities (and `signedOut` when it can't be reached). */
export function listMailboxes(): Promise<MailAccount[]> {
  return invoke<MailAccount[]>("gmail:listAccounts", {});
}

export async function mailbox(args: ToolArgs, key = "account"): Promise<MailAccount> {
  const accounts = await listMailboxes();
  const wanted = optStr(args, key)?.toLowerCase();
  if (!wanted && accounts.length === 1) return accounts[0];
  const found = accounts.find(
    (a) => a.email.toLowerCase() === wanted || a.id.toLowerCase() === wanted,
  );
  if (found) return found;
  const known = accounts.map((a) => a.email).join(", ") || "none";
  throw new Error(
    wanted ? `No mailbox "${wanted}". Mailboxes: ${known}.` : `"${key}" is required: ${known}.`,
  );
}

export async function mailboxes(args: ToolArgs, key = "accounts"): Promise<MailAccount[]> {
  const wanted = strList(args, key);
  if (!wanted?.length) {
    const off = turnedOffMailboxes();
    return (await listMailboxes()).filter((a) => !off.has(a.id));
  }
  return Promise.all(wanted.map((account) => mailbox({ account })));
}
