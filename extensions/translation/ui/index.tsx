/**
 * Translation: mail in a language the user doesn't read gets a banner; once
 * translated, the body's text is swapped in place. It's per conversation
 * (starts on with "Translate automatically"): each message in another
 * language follows it, and the reader's "…" menu and shortcut switch it.
 */

import {
  DropdownMenuItem,
  features,
  toast,
  useCommandHandlers,
  useShortcutLabel,
  type ConversationInput,
  type MessageBodyInput,
  type UiExtension,
} from "@otter-mail/web/extension-kit";
import { LanguagesIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { manifest } from "../manifest";
import {
  ConversationTranslationContext,
  useIsForeignMessage,
  useMessageTranslation,
} from "./translate-banner";
import { useTranslationSettings } from "./translation";
import { TranslationSection } from "./translation-section";

function useMessageBody({ accountId, detail, enabled }: MessageBodyInput) {
  // Off: no detail, so nothing is detected or translated.
  const translation = useMessageTranslation(accountId, enabled ? detail : undefined);
  return enabled ? translation : {};
}

function useConversation({ accountId, messageId, message, enabled }: ConversationInput) {
  const { autoTranslate } = useTranslationSettings();
  const [translation, setTranslation] = useState<{ on: boolean; target: string | null }>({
    on: false,
    target: null,
  });
  // A new conversation (messageId) starts from the setting.
  /* oxlint-disable react/set-state-in-effect, react/exhaustive-effect-dependencies -- Re-run when the conversation changes, though the effect doesn't read it. */
  useEffect(
    () => setTranslation({ on: enabled && autoTranslate, target: null }),
    [messageId, autoTranslate, enabled],
  );
  /* oxlint-enable react/set-state-in-effect, react/exhaustive-effect-dependencies */
  const value = useMemo(() => ({ ...translation, set: setTranslation }), [translation]);
  const openedForeign = useIsForeignMessage(accountId, enabled ? message : undefined);
  const shortcut = useShortcutLabel("message.translate");

  const toggle = () => {
    if (!translation.on && !openedForeign) {
      toast.info("This message is already in a language you read");
      return;
    }
    console.log("[MessageReader:translate]", { messageId, on: !translation.on });
    setTranslation((t) => ({ ...t, on: !t.on }));
  };
  useCommandHandlers({
    // Inert without an open message, or with the extension off.
    "message.translate": () => {
      if (!enabled || !message) return false;
      toggle();
    },
  });

  return {
    wrap: (children: React.ReactNode) => (
      <ConversationTranslationContext.Provider value={value}>
        {children}
      </ConversationTranslationContext.Provider>
    ),
    menuItems:
      enabled && (openedForeign || translation.on) ? (
        <DropdownMenuItem icon={<LanguagesIcon />} accelerator={shortcut} onSelect={toggle}>
          {translation.on ? "Show original" : "Translate"}
        </DropdownMenuItem>
      ) : null,
  };
}

export default {
  manifest,
  Icon: LanguagesIcon,
  // Its manifest says where it runs; a browser without a translator has nothing to translate with.
  available: () => features.translation,
  useMessageBody,
  useConversation,
  Settings: TranslationSection,
} satisfies UiExtension;
