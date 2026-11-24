import { citationText } from "@otter/client/agents/chat-cite";
import { Markdown } from "@otter/ui-native/components/markdown";
import { createContext, memo, use, useCallback } from "react";

/** What a link and Reply do in the Markdown under it, and what to mark as found. */
export type ChatText = {
  open: (href: string) => void;
  /** Quotes a selection in your next message; absent where nothing can be quoted (a chat that only reads here). */
  quote?: (text: string, source?: string) => void;
  find: string;
};

export const ChatTextContext = createContext<ChatText>({ open: () => {}, find: "" });

/** The design system's Markdown, its links and Reply going through the chat around it. */
export const ChatMarkdown = memo(function ChatMarkdown({
  markdown,
  muted,
  reserve,
  source,
}: {
  markdown: string;
  muted?: boolean;
  reserve?: number;
  source?: string;
}) {
  const chat = use(ChatTextContext);
  const quote = chat.quote;
  const reply = useCallback(
    (text: string) => {
      const quoted = citationText(text);
      if (quoted) quote?.(quoted, source);
    },
    [quote, source],
  );
  return (
    <Markdown
      markdown={markdown}
      muted={muted}
      reserve={reserve}
      find={chat.find}
      onLink={chat.open}
      onReply={quote && reply}
    />
  );
});
