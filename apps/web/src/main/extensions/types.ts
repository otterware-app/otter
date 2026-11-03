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
  Icon?: ComponentType<{ className?: string }>;
  /**
   * Whether this app has what it needs right now (`features`), beyond its
   * manifest's `platforms`; absent → yes. An app hides what it hasn't.
   */
  available?: () => boolean;
  agent?: AgentContribution;
  messageCards?: readonly ComponentType<MessageCardProps>[];
  useMessageBody?: (input: MessageBodyInput) => MessageBodyOutput;
  /** Links in a body it answers in place instead of opening (an invite's Yes / No / Maybe). */
  bodyLinks?: BodyLinks;
  useConversation?: (input: ConversationInput) => ConversationOutput;
  messageActions?: readonly MessageAction[];
  commands?: readonly PaletteCommand[];
  /** What ⌘K finds of its own for the text typed (Drive's documents), under `label`. */
  paletteSearch?: PaletteSearch;
  Dialogs?: ComponentType;
  Settings?: ComponentType;
  /** A connection (manifest category `connection`): listed in Connections beside the mailboxes. */
  connection?: ConnectionContribution;
  /** How it draws the workspaces its manifest declares (`contributes.workspaces`): one per id. */
  workspaces?: readonly WorkspaceContribution[];
};

/**
 * A workspace beside Mail, Calendar and Agent (VS Code's view container): a
 * mode at the sidebar's foot that swaps the sidebar and the main area, at
 * `/<id>/<location>/<item>`. The location and item are its own (a folder, a
 * document); the app keeps them in the address, its tabs and history.
 */
export type WorkspaceContribution = {
  /** The manifest's workspace id. */
  id: string;
  /** Its mark in the mode switcher and tabs: solid when selected, contoured when not. */
  Icon: ComponentType<{ selected?: boolean; className?: string }>;
  /** The location it opens on the first time. */
  home: string;
  Sidebar: ComponentType<WorkspaceProps>;
  Main: ComponentType<WorkspaceMainProps>;
};

export type WorkspaceLocation = { location: string; item: string | null };

export type WorkspaceProps = WorkspaceLocation & {
  /** Moves within the workspace (the item clears unless given). */
  go: (to: Partial<WorkspaceLocation>, replace?: boolean) => void;
};

export type WorkspaceMainProps = WorkspaceProps & {
  /** Names where it is in its tab and history (a document's title); null for the workspace's name. */
  setTitle: (title: string | null) => void;
  /** The window's controls to draw first in its title bar (the sidebar toggle, when it's hidden). */
  titleLeading: ReactNode;
  /** And last (the browser panel's toggle). */
  titleTrailing: ReactNode;
};

export type ConnectionContribution = {
  /** What it gives Otter Mail, as the list says it: "Tasks". */
  provides: string;
  /** Whether it's connected on this device: a query the list runs (share its key to stay in step). */
  status: { queryKey: readonly unknown[]; queryFn: () => Promise<{ connected: boolean }> };
};

export type MessageTarget = { accountId: string; messageId: string; subject: string };

export type MessageCardProps = {
  accountId: string;
  summary: MessageSummary;
  detail: MessageDetail;
  onTrash?: () => void;
};

export type MessageBodyInput = {
  accountId: string;
  detail: MessageDetail | undefined;
  enabled: boolean;
};

export type MessageBodyOutput = {
  banner?: ReactNode;
  bodyHtml?: string | null;
  bodyText?: string | null;
};

export type BodyLinks = {
  applies(detail: MessageDetail): boolean;
  answer(href: string): string | null;
  open(messageId: string, answer: string): void;
};

export type ConversationInput = {
  accountId: string;
  messageId: string | null;
  message: MessageDetail | undefined;
  enabled: boolean;
};

export type ConversationOutput = {
  wrap?: (children: ReactNode) => ReactNode;
  menuItems?: ReactNode;
};

export type MessageAction = {
  id: string;
  label: string;
  menuLabel?: string;
  Icon: ComponentType<{ className?: string }>;
  toolbar?: boolean;
  run(target: MessageTarget): void;
};

export type PaletteSearch = {
  label: string;
  search(query: string): Promise<PaletteResult[]>;
};
export type PaletteResult = PaletteCommand & { description?: string };
export type PaletteCommand = {
  id: string;
  title: string;
  keywords?: string;
  Icon: ComponentType<{ className?: string }>;
  run(): void;
};

export type AgentContribution = {
  Icon: ComponentType<{ className?: string }>;
  Settings: ComponentType<AgentSettingsProps>;
  Connect?: ComponentType<{
    state: ProvidersState;
    provider: ProviderSnapshot;
    onConnected: () => void;
  }>;
  missing: { headline: string; detail?: string };
  connectedAs?: boolean;
  /** It can't take a turn until signed in (the Otter Mail agent's OpenRouter key). */
  needsSignIn?: boolean;
  serverApprovals?: boolean;
  ownModelSettings?: boolean;
};

export type AgentSettingsProps = {
  state: ProvidersState;
  provider: ProviderSnapshot;
  update: (patch: AgentSettingsPatch) => void;
};
