/**
 * The renderer's half of extensions (packages/contracts/src/extensions.ts):
 * what an extension's `./ui` contributes, slot by slot (VS Code's
 * contribution points). The app draws each slot from the extensions that are
 * on (registry.ts, slots.tsx); an extension never reaches into the app's
 * screens.
 */

import type { ExtensionManifest } from "@otter-mail/contracts/extensions";
import type { ComponentType, ReactNode } from "react";

import type { AgentSettingsPatch, ProviderSnapshot, ProvidersState } from "../mail/api";
import type { MessageDetail, MessageSummary } from "../mail/types";

export type UiExtension = {
  manifest: ExtensionManifest;
  /** Its mark in Settings (an agent's is `agent.Icon`). */
  Icon?: ComponentType<{ className?: string }>;
  /**
   * Whether this app has what it needs right now (`features`), beyond its
   * manifest's `platforms`; absent → yes. An app hides what it hasn't.
   */
  available?: () => boolean;
  /** An agent: Settings → Agents lists it, the chat runs on it. Its on/off is the agent's own. */
  agent?: AgentContribution;
  /** Cards above a message's body; each draws nothing for mail it isn't about. */
  messageCards?: readonly ComponentType<MessageCardProps>[];
  /**
   * Swaps a message's body text, with a banner above it (Translation). A
   * hook, called for every message whether the extension is on or not (hooks
   * keep their order), told which.
   */
  useMessageBody?: (input: MessageBodyInput) => MessageBodyOutput;
  /** Links in a body it answers in place instead of opening (an invite's Yes / No / Maybe). */
  bodyLinks?: BodyLinks;
  /** Per open conversation: context around the reader, and items in its "…" menu. A hook, like `useMessageBody`. */
  useConversation?: (input: ConversationInput) => ConversationOutput;
  /** On a message: in the reader's toolbar and "…" menu, and the list's right-click menu. */
  messageActions?: readonly MessageAction[];
  /** In ⌘K. */
  commands?: readonly PaletteCommand[];
  /** Mounted once with the app: the dialogs its actions and commands open. */
  Dialogs?: ComponentType;
  /** Its settings, on its page in Settings. */
  Settings?: ComponentType;
};

export type MessageTarget = { accountId: string; messageId: string; subject: string };

export type MessageCardProps = {
  accountId: string;
  summary: MessageSummary;
  detail: MessageDetail;
  /** Moves the conversation to the trash (a sign-in code's Copy & trash). */
  onTrash?: () => void;
};

export type MessageBodyInput = {
  accountId: string;
  detail: MessageDetail | undefined;
  enabled: boolean;
};

/** Undefined fields keep the message's own. */
export type MessageBodyOutput = {
  banner?: ReactNode;
  bodyHtml?: string | null;
  bodyText?: string | null;
};

export type BodyLinks = {
  /** Whether this message's links are its to answer. */
  applies(detail: MessageDetail): boolean;
  /** The answer a link stands for (`accepted`), or null when it's an ordinary link. */
  answer(href: string): string | null;
  /** Someone clicked a link standing for `answer` in `messageId`. */
  open(messageId: string, answer: string): void;
};

export type ConversationInput = {
  accountId: string;
  messageId: string | null;
  message: MessageDetail | undefined;
  enabled: boolean;
};

export type ConversationOutput = {
  /** Wraps the reader, to give its messages a context. */
  wrap?: (children: ReactNode) => ReactNode;
  /** Items in the reader's "…" menu. */
  menuItems?: ReactNode;
};

export type MessageAction = {
  id: string;
  /** In the toolbar's tooltip; the menus use `menuLabel` when it differs ("Add to Todoist…"). */
  label: string;
  menuLabel?: string;
  Icon: ComponentType<{ className?: string }>;
  /** Also a button in the reader's toolbar, not only in its menus. */
  toolbar?: boolean;
  run(target: MessageTarget): void;
};

export type PaletteCommand = {
  id: string;
  title: string;
  keywords?: string;
  Icon: ComponentType<{ className?: string }>;
  run(): void;
};

/** The agent contribution's renderer side: everything else about an agent is core's contract. */
export type AgentContribution = {
  Icon: ComponentType<{ className?: string }>;
  /** Its own settings in Settings → Agents (connection, models, access), under the shared header. */
  Settings: ComponentType<AgentSettingsProps>;
  /** A short connect form the setup offers when it isn't ready yet (Hermes' server and key). */
  Connect?: ComponentType<{
    state: ProvidersState;
    provider: ProviderSnapshot;
    onConnected: () => void;
  }>;
  /** What its status says when it isn't there: "Not connected" (a server), "Not found" (a CLI). */
  missing: { headline: string; detail?: string };
  /** Its sign-in label is who it takes this device for: "Connected as …" (OpenClaw). */
  connectedAs?: boolean;
  /** It can't take a turn until signed in (the Otter Mail agent's OpenRouter key). */
  needsSignIn?: boolean;
  /** Its approvals are set on its server, not per chat: the composer offers no access mode. */
  serverApprovals?: boolean;
  /** Its agents bring their own model settings (OpenClaw): no reasoning or speed choices. */
  ownModelSettings?: boolean;
};

export type AgentSettingsProps = {
  state: ProvidersState;
  provider: ProviderSnapshot;
  update: (patch: AgentSettingsPatch) => void;
};
