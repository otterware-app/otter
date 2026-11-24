import { create } from "zustand";
import type { MailChatContext } from "./chat-context.ts";

export type AttachedMail = NonNullable<MailChatContext["attached"]>;

/** The mail a chat's next message is about (Otter Mail's Send to agent), until it's sent or removed. */
const useAttached = create<Record<string, AttachedMail>>(() => ({}));

export const useChatMail = (chatId: string): AttachedMail | null =>
  useAttached((s) => s[chatId] ?? null);

export const chatMail = (chatId: string): AttachedMail | null =>
  useAttached.getState()[chatId] ?? null;

export function attachMail(chatId: string, mail: AttachedMail): void {
  useAttached.setState({ [chatId]: mail });
}

export function detachMail(chatId: string): void {
  useAttached.setState(
    (s) => Object.fromEntries(Object.entries(s).filter(([id]) => id !== chatId)),
    true,
  );
}
