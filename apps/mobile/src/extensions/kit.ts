import type { ExtensionManifest } from "@otter-mail/contracts/extensions";
import { decodeEntities } from "@otter-mail/client-runtime/text";
import * as Clipboard from "expo-clipboard";
import type { ComponentType } from "react";
import { useColorScheme } from "react-native";

import { core } from "../state/core";
import type { MessageDetail } from "../state/mail";
import { palette } from "../features/theme";

/**
 * What an extension's `./mobile` half may use of the app, as `./ui` halves
 * have @otter-mail/web/extension-kit: `@otter-mail/mobile/extension-kit`
 * (an alias of this file, in Metro and tsconfig).
 */

export type { MessageDetail };

/** The open message, for a card above its body. `onTrash` moves it to Trash and leaves. */
export type MessageCardProps = {
  accountId: string;
  summary: { id: string; threadId: string; subject: string };
  detail: MessageDetail;
  onTrash?: () => void;
};

export interface MobileExtension {
  manifest: ExtensionManifest;
  messageCards?: ComponentType<MessageCardProps>[];
}

/** A core handler, the extension's own `./core` half's included. */
export const invoke = <T>(channel: string, params?: unknown): Promise<T> =>
  core.invoke<T>(channel, params);

export const useColors = () => palette(useColorScheme());

export const copyText = (text: string): Promise<boolean> => Clipboard.setStringAsync(text);

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
