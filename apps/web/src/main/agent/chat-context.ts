import type { ChatContextKind, ChatContextMeta } from "@otter/contracts/chats";

import { useBrowser } from "../browser/store";

import type { ProviderKind } from "../mail/api";
import { clampTitle } from "./chat-store";
import { useAccounts, useMessage } from "../mail/hooks";
import type { MessageSummary } from "../mail/types";

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

/** The browser tab open beside the chat, which a message can take along. */
export type PageContext = { tabId: string; url: string; title: string };

export function buildHandoffText(
  question: string,
  context: AgentContext | null,
  provider: ProviderKind,
  page: PageContext | null = null,
): string {
  // A marker, not a name: chats sync to older apps (and the iPhone's Otter Mail), which strip it.
  const lines: string[] = [question.trim(), "", "— context from Otter Mail —"];
  if (page)
    lines.push(
      provider === "openclaw"
        ? `• The browser tab I have open: "${page.title}" — ${page.url}. It's shared with you in Otter's browser (browser profile "otter").`
        : `• The browser tab I have open: "${page.title}" — ${page.url}`,
    );
  if (!context || context.conversations.length === 0) return lines.join("\n");
  for (const c of context.conversations) {
    if (c.quote) {
      lines.push(
        `• Quoted from "${c.subject}" [${c.account}] (threadId ${c.threadId}):\n  “${c.quote}”`,
      );
    } else {
      lines.push(
        `• [${c.account}] "${c.subject}" — from ${c.from} (threadId ${c.threadId}, message ${c.messageIds.join(", ")})`,
      );
    }
  }
  lines.push(
    provider === "hermes" || provider === "openclaw"
      ? "Fetch full content with gog if needed."
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

/** What a message says it was about, with the tab it took along. */
export function withPage(meta: ContextMeta | undefined, page: PageContext | null) {
  if (!page) return meta;
  const item = {
    title: page.title,
    target: { kind: "page" as const, url: page.url, tab: page.tabId },
  };
  if (!meta) return { subjects: [page.title], count: 1, kind: "page" as const, items: [item] };
  return {
    ...meta,
    subjects: [...meta.subjects, page.title],
    count: meta.count + 1,
    kind: "mixed" as const,
    items: [...(meta.items ?? []), item],
  };
}

/** The tab showing in the browser panel, while the panel is open. */
export function usePageContext(browserVisible: boolean): PageContext | null {
  const tab = useBrowser((s) =>
    browserVisible ? s.tabs.find((t) => t.id === s.activeId && !t.chatId) : undefined,
  );
  if (!tab || !/^https?:/i.test(tab.url)) return null;
  return { tabId: tab.id, url: tab.url, title: tab.title || tab.url };
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
  page?: PageContext | null;
  headline: string;
};

export function useMailChatContext({
  accountId,
  messageId,
  selectedRows,
  quote,
  browserVisible = false,
}: {
  accountId: string | null;
  messageId: string | null;
  selectedRows?: MessageSummary[];
  quote?: QuoteContext | null;
  browserVisible?: boolean;
}): MailChatContext {
  const page = usePageContext(browserVisible);
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
        : page
          ? `What should we do on “${clampTitle(page.title)}”?`
          : "What should we do in your inbox?";
  if (!context) return { attached: null, quote: quote ?? null, page, headline };
  const conversations = context.conversations;
  return {
    attached: {
      context,
      kind,
      name: quote
        ? `“${quote.text}”`
        : conversations.length > 1
          ? `${conversations.length} conversations`
          : conversations[0].subject || "(no subject)",
      detail: quote
        ? "Quote"
        : conversations.length > 1
          ? conversations
              .slice(0, 3)
              .map((c) => c.subject || "(no subject)")
              .join(" · ")
          : conversations[0].from,
      meta: {
        count: conversations.length || 1,
        subjects: quote ? [quote.text] : conversations.map((x) => x.subject),
        kind,
        items: conversations.map((conversation) => ({
          title: conversation.subject,
          target: {
            kind: "thread" as const,
            id: conversation.threadId,
            accountId:
              accountsQuery.data?.find((a) => a.email === conversation.account)?.id ??
              conversation.account,
          },
        })),
      },
    },
    quote: quote ?? null,
    page,
    headline,
  };
}
