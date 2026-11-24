import { useQuery } from "@tanstack/react-query";
import { chatTabId, type ChatTabRef } from "@otter/contracts/chats";
import { attachmentPreview } from "../file-preview.ts";
import { mailApi } from "../mail/api.ts";
import { agentApi, type AgentId, type ChatChange } from "./api.ts";
import type { Conversation } from "./chat-store.ts";

/** An image a chat links to (a file of its session's), as a data URL to show. */
export async function readChatImage(
  provider: AgentId,
  sessionId: string | null,
  href: string,
): Promise<string> {
  const file = await agentApi.readFile(provider, sessionId ?? "", href);
  const preview = attachmentPreview(file.name, file.mimeType);
  if (preview?.kind !== "image") throw new Error("This file isn't an image.");
  return `data:${preview.mimeType};base64,${file.data}`;
}

/** A file a chat links to, when it's one that can be previewed. */
export async function readChatFile(provider: AgentId, sessionId: string | null, href: string) {
  const file = await agentApi.readFile(provider, sessionId ?? "", href);
  if (!attachmentPreview(file.name, file.mimeType))
    throw new Error("This file type can't be previewed.");
  return file;
}

export const chatFileKey = (
  provider: AgentId | undefined,
  sessionId: string | null | undefined,
  href: string,
) => ["chat-file", provider, sessionId, href] as const;

/** A file of the chat's session, as its tab shows it. */
export function useChatFile(convo: Conversation | undefined, href: string) {
  return useQuery({
    queryKey: chatFileKey(convo?.provider, convo?.sessionId, href),
    enabled: Boolean(convo),
    retry: false,
    queryFn: () => agentApi.readFile(convo!.provider, convo!.sessionId ?? "", href),
  });
}

/** Why a chat's file can't show: a chat that ran on another computer keeps its files there. */
export const chatFileProblem = (error: Error, convo: Conversation | undefined) =>
  convo?.device?.name ? `This file is on ${convo.device.name}, where the chat ran.` : error.message;

/** A file's tab title: its name. */
export const fileTabTitle = (href: string) => href.split(/[\\/]/).pop() || href;

/**
 * The message a mail tab of the chat shows: a thread's latest, or a draft's current version
 * (loaded into the cache to open).
 */
export function useChatTabMessage(ref: ChatTabRef | undefined) {
  const mail = ref?.kind === "thread" || ref?.kind === "draft" ? ref : null;
  return useQuery({
    queryKey: ["chat-tab-message", mail ? chatTabId(mail) : null],
    enabled: mail !== null,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      if (!mail) return null;
      if (mail.kind === "draft") {
        const version = await mailApi.getDraftVersion(mail.accountId, mail.id);
        if (!version.messageId) throw new Error("This draft was sent or deleted.");
        await mailApi.loadDraftVersion(mail.accountId, mail.id, version.messageId);
        return version.messageId;
      }
      const messages = await mailApi.getThread(mail.accountId, mail.id);
      const last = messages.at(-1);
      if (!last) throw new Error("This conversation is no longer available.");
      return last.id;
    },
  });
}

/**
 * Where something the agent changed opens beside the chat: mail as a tab, an event's page when
 * the app has pages (`pages`); null for what opens elsewhere.
 */
export function chatChangeTab(
  change: ChatChange,
  pages: boolean,
): { ref: ChatTabRef; title: string } | null {
  const { target } = change;
  if (target.kind === "thread" || target.kind === "draft")
    return {
      ref: { kind: target.kind, accountId: target.accountId, id: target.id },
      title: change.title,
    };
  if (target.kind === "event" && target.url && pages)
    return { ref: { kind: "page", url: target.url }, title: change.title };
  return null;
}
