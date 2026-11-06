import type { ChatContextMeta } from "@otter-mail/contracts/chats";

/**
 * "Ask the agent" about a conversation (the web's chat-context.ts): pointers,
 * not mail. The agent reads the same mailboxes through its tools, so ids are
 * enough.
 */
export type ThreadContext = {
  account: string;
  threadId: string;
  subject: string;
  from: string;
  messageIds: string[];
  labelIds: string[];
};

export function handoffText(question: string, context: ThreadContext, provider: string): string {
  return [
    question.trim(),
    "",
    "— context from Otter Mail —",
    `• [${context.account}] "${context.subject}" — from ${context.from} (threadId ${context.threadId}, message ${context.messageIds.join(", ")})`,
    provider === "hermes" || provider === "openclaw"
      ? "Fetch full content with gog if needed."
      : "Read them with the otter-mail tools (get_thread) if needed.",
  ].join("\n");
}

export function contextMeta(context: ThreadContext): ChatContextMeta {
  return {
    subjects: [context.subject],
    count: 1,
    kind: context.labelIds.includes("DRAFT")
      ? "draft"
      : context.labelIds.includes("SENT")
        ? "sent"
        : "mail",
  };
}
