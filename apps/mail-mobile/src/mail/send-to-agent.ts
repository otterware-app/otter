import type { MessageSummary } from "@otter/client/mail/types";
import { resolveScheme } from "expo-linking";
import { useEffect, useState } from "react";
import { Linking } from "react-native";

import { mailFailure } from "./mail-actions.tsx";

function agentsScheme() {
  return resolveScheme({ isSilent: true }).endsWith(".dev")
    ? "dev.otterware.agents.dev"
    : "dev.otterware.agents";
}

type MailPointer = {
  kind: "mail" | "draft";
  account: string;
  threadID: string;
  messageIDs: string[];
  subject: string;
  from: string;
  quote?: string;
};

export function mailPointer(account: string, message: MessageSummary, quote?: string): MailPointer {
  return {
    kind: message.labelIds.includes("DRAFT") ? "draft" : "mail",
    account,
    threadID: message.threadId,
    messageIDs: [message.id],
    subject: message.subject || "(No subject)",
    from: message.fromEmail,
    quote: quote?.trim().slice(0, 4000) || undefined,
  };
}

export function useAgentsInstalled() {
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    let active = true;
    void Linking.canOpenURL(`${agentsScheme()}://new`).then(
      (result) => {
        if (active) setInstalled(result);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  return installed;
}

export function sendToAgent(mail: MailPointer[]) {
  if (mail.length === 0) return;
  const query = mail
    .map((pointer) => `mail=${encodeURIComponent(JSON.stringify(pointer))}`)
    .join("&");
  void Linking.openURL(`${agentsScheme()}://new?${query}`).catch(() => {
    mailFailure("Couldn't open Otter Agents.");
  });
}
