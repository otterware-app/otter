import type { ChatContextKind, ChatContextMeta } from "@otter/contracts/chats";

import { clampTitle } from "./chat-store.ts";
import { useAccounts, useMessage } from "../mail/hooks.ts";
import type { MessageSummary } from "../mail/types.ts";

/**
 * Pointer-sized mail context for the agent chat. The agent can read the same
 * mailboxes (Claude and Codex through Otter's tools, Hermes and OpenClaw with gog on
 * its server), so ids are enough — no mail content leaves the app.
 */
export type AgentContext = {
  conversations: {
    account: string;
    threadId: string;
    subject: string;
    from: string;
    messageIds: string[];
    quote?: string;
    /** A draft's, when it's that the chat is about. */
    kind?: "mail" | "draft";
  }[];
};

export type QuoteContext = {
  text: string;
  account: string;
  accountId: string;
  threadId: string;
  subject: string;
  messageId: string;
};

export function contextFromMessages(
  messages: MessageSummary[],
  accountEmailById: (accountId: string | undefined) => string,
): AgentContext {
  return {
    conversations: messages.map((m) => ({
      account: accountEmailById(m.accountId),
      threadId: m.threadId || m.id,
      subject: m.subject || "(no subject)",
      from: m.fromEmail,
      messageIds: [m.id],
    })),
  };
}

export function contextFromQuote(q: QuoteContext): AgentContext {
  return {
    conversations: [
      {
        account: q.account,
        threadId: q.threadId,
        subject: q.subject,
        from: "",
        messageIds: [q.messageId],
        quote: q.text,
      },
    ],
  };
}

export function buildHandoffText(
  question: string,
  context: AgentContext,
  mailReader: string | undefined,
): string {
  // A marker, not a name: chats sync to older apps (and the iPhone's Otter Mail), which strip it.
  const lines: string[] = [question.trim(), "", "— context from Otter Mail —"];
  for (const c of context.conversations) {
    if (c.quote) {
      lines.push(
        `• Quoted from "${c.subject}" [${c.account}] (threadId ${c.threadId}):\n  “${c.quote}”`,
      );
    } else {
      const ids = [
        c.threadId && `threadId ${c.threadId}`,
        c.messageIds.length > 0 && `message ${c.messageIds.join(", ")}`,
      ].filter(Boolean);
      lines.push(
        `• ${c.kind === "draft" ? "Draft " : ""}[${c.account}] "${c.subject}" — from ${c.from} (${ids.join(", ")})`,
      );
    }
  }
  lines.push(
    mailReader
      ? `Fetch full content with ${mailReader} if needed.`
      : "Read them with the otter tools (get_thread) if needed.",
  );
  return lines.join("\n");
}

export type ContextKind = ChatContextKind;
export type ContextMeta = ChatContextMeta;

function kindOf(labelIds: string[]): ContextKind {
  if (labelIds.includes("DRAFT")) return "draft";
  if (labelIds.includes("SENT")) return "sent";
  return "mail";
}

function contextKind(labelSets: string[][]): ContextKind {
  if (labelSets.length === 0) return "mail";
  const kinds = new Set(labelSets.map(kindOf));
  return kinds.size === 1 ? [...kinds][0] : "mixed";
}

export type MailChatContext = {
  attached: {
    context: AgentContext;
    kind: ContextKind;
    name: string;
    detail: string;
    meta: ContextMeta;
  } | null;
  quote: QuoteContext | null;
  headline: string;
};

export function useMailChatContext({
  accountId,
  messageId,
  selectedRows,
  quote,
}: {
  accountId: string | null;
  messageId: string | null;
  selectedRows?: MessageSummary[];
  quote?: QuoteContext | null;
}): MailChatContext {
  const accountsQuery = useAccounts();
  const accountEmailById = (id: string | undefined) =>
    accountsQuery.data?.find((a) => a.id === id)?.email ?? id ?? "";
  const openMessage = useMessage(accountId, messageId);
  const multiSelected = selectedRows && selectedRows.length > 0;
  const mailContext: AgentContext | null = quote
    ? contextFromQuote(quote)
    : multiSelected
      ? contextFromMessages(selectedRows, accountEmailById)
      : accountId && messageId && openMessage.data
        ? {
            conversations: [
              {
                account: accountEmailById(accountId),
                threadId: openMessage.data.threadId || openMessage.data.id,
                subject: openMessage.data.subject || "(no subject)",
                from: openMessage.data.fromEmail,
                messageIds: [openMessage.data.id],
              },
            ],
          }
        : null;
  const context = mailContext;
  const kind: ContextKind = quote
    ? "quote"
    : contextKind(
        multiSelected
          ? selectedRows.map((r) => r.labelIds)
          : openMessage.data
            ? [openMessage.data.labelIds]
            : [],
      );
  const headline = quote
    ? "What should we do with this excerpt?"
    : multiSelected
      ? `What should we do with these ${selectedRows.length} conversations?`
      : openMessage.data
        ? `What should we do with “${clampTitle(openMessage.data.subject || "this conversation")}”?`
        : "What should we do in your inbox?";
  if (!context) return { attached: null, quote: quote ?? null, headline };
  return {
    attached: attachedContext(
      context,
      kind,
      (account) => accountsQuery.data?.find((a) => a.email === account)?.id ?? account,
    ),
    quote: quote ?? null,
    headline,
  };
}

/** What a chat is about, as the composer shows it and a turn keeps it. `accountId`: a mailbox's id, by its address. */
export function attachedContext(
  context: AgentContext,
  kind: ContextKind,
  accountId: (account: string) => string,
): NonNullable<MailChatContext["attached"]> {
  const conversations = context.conversations;
  const quote = kind === "quote" ? (conversations[0]?.quote ?? "") : null;
  return {
    context,
    kind,
    name:
      quote !== null
        ? `“${quote}”`
        : conversations.length > 1
          ? `${conversations.length} conversations`
          : conversations[0].subject || "(no subject)",
    detail:
      quote !== null
        ? "Quote"
        : conversations.length > 1
          ? conversations
              .slice(0, 3)
              .map((c) => c.subject || "(no subject)")
              .join(" · ")
          : conversations[0].from,
    meta: {
      count: conversations.length || 1,
      subjects: quote !== null ? [quote] : conversations.map((x) => x.subject),
      kind,
      items: conversations.map((conversation) => ({
        title: conversation.subject,
        target: {
          kind: "thread" as const,
          id: conversation.threadId,
          accountId: accountId(conversation.account),
        },
      })),
    },
  };
}

/**
 * The mail in the link Otter Mail for iPhone opens Otter Agents with to start a chat about it
 * (Send to agent): `<scheme>://new?mail=<json>&mail=<json>`, each a pointer as
 * `apps/mail-mobile/src/mail/send-to-agent.ts` writes one. Empty for any other link.
 */
export function mailOfLink(link: string): AgentContext["conversations"] {
  if (!URL.canParse(link)) return [];
  const url = new URL(link);
  if (url.host !== "new") return [];
  return url.searchParams.getAll("mail").flatMap((json) => {
    try {
      const mail = JSON.parse(json) as Record<string, unknown>;
      const text = (key: string) => (typeof mail[key] === "string" ? (mail[key] as string) : "");
      const messageIds = Array.isArray(mail.messageIDs)
        ? mail.messageIDs.filter((id): id is string => typeof id === "string")
        : [];
      if (!text("account") || (!text("threadID") && messageIds.length === 0)) return [];
      return [
        {
          account: text("account"),
          threadId: text("threadID"),
          subject: text("subject"),
          from: text("from"),
          messageIds,
          ...(typeof mail.quote === "string" && { quote: mail.quote }),
          kind: text("kind") === "draft" ? ("draft" as const) : ("mail" as const),
        },
      ];
    } catch {
      return [];
    }
  });
}

/** A new chat's mail from Otter Mail's link, as the composer attaches it; null when it has none. */
export function mailLinkContext(link: string): MailChatContext["attached"] {
  const conversations = mailOfLink(link);
  const [first] = conversations;
  if (!first) return null;
  const kind: ContextKind =
    first.quote !== undefined
      ? "quote"
      : conversations.every((c) => c.kind === first.kind)
        ? (first.kind ?? "mail")
        : "mixed";
  return attachedContext({ conversations }, kind, (account) => account);
}
