import { Button, Section, Text, VStack } from "@expo/ui/swift-ui";
import {
  font,
  foregroundStyle,
  listRowBackground,
  textSelection,
} from "@expo/ui/swift-ui/modifiers";
import type { ExtensionManifest } from "@otter-mail/contracts/extensions";
import { decodeEntities } from "@otter-mail/client-runtime/text";
import * as Clipboard from "expo-clipboard";
import type { ComponentProps, ComponentType } from "react";
import { useColorScheme } from "react-native";

import { agents, type AgentProvider, type ProvidersState } from "../state/chats";
import { agentServerUrl, core } from "../state/core";
import type { MessageDetail } from "../state/mail";
import { palette, type Palette } from "../features/theme";

/**
 * What an extension's `./mobile` half may use of the app, as `./ui` halves
 * have @otter-mail/web/extension-kit: `@otter-mail/mobile/extension-kit`
 * (an alias of this file, in Metro and tsconfig).
 */

export type { AgentProvider, MessageDetail, Palette, ProvidersState };
export * as SwiftUI from "@expo/ui/swift-ui";
export * as SwiftUIModifiers from "@expo/ui/swift-ui/modifiers";
export { updateAgentSettings } from "../state/chats";

/** The open message, for a card above its body. `onTrash` moves it to Trash and leaves. */
export type MessageCardProps = {
  accountId: string;
  summary: { id: string; threadId: string; subject: string };
  detail: MessageDetail;
  onTrash?: () => void;
};

/** An agent's page in Settings → Agents: SwiftUI sections in the page's Form. */
export type AgentSettingsProps = {
  provider: AgentProvider;
  colors: Palette;
  /** Signed in to the Otter account. */
  signedIn: boolean;
};

export interface MobileExtension {
  manifest: ExtensionManifest;
  messageCards?: ComponentType<MessageCardProps>[];
  agent?: {
    Settings: ComponentType<AgentSettingsProps>;
    /** Its server asks before acting, so the chat has no approval mode. */
    serverApprovals?: boolean;
    /** Its models aren't tuned with Reasoning or Fast here. */
    ownModelSettings?: boolean;
  };
}

/** `pnpm dev:fake`'s agent server, which needs no Otter account. */
export const devAgentServer = Boolean(agentServerUrl);

/** A core handler that answers with the agents' state: the app takes it at once. */
export async function invokeProviders(channel: string, params?: unknown): Promise<ProvidersState> {
  const state = await core.invoke<ProvidersState>(channel, params);
  agents.set(state);
  return state;
}

/** A section whose rows sit on the theme's cards, as Settings' others. */
export function SettingsGroup({
  colors,
  ...props
}: ComponentProps<typeof Section> & { colors: Palette }) {
  return <Section {...props} modifiers={[listRowBackground(colors.card)]} />;
}

/** A command to run elsewhere (on the gateway's computer), and a button that copies it. */
export function Command({
  value,
  colors,
  title,
}: {
  value: string;
  colors: Palette;
  title?: string;
}) {
  return (
    <>
      <VStack alignment="leading" spacing={6}>
        {title ? <Text>{title}</Text> : null}
        <Text
          modifiers={[
            font({ textStyle: "footnote", design: "monospaced" }),
            foregroundStyle(colors.secondary),
            textSelection(true),
          ]}
        >
          {value}
        </Text>
      </VStack>
      <Button label="Copy the command" onPress={() => void copyText(value)} />
    </>
  );
}

/** A core handler, the extension's own `./core` half's included. */
export function invoke<T>(channel: string, params?: unknown): Promise<T> {
  return core.invoke<T>(channel, params);
}

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

/** An agent's state in Settings, as the Swift app words it. */
export function agentStatus(p: AgentProvider): { text: string; color: (c: Palette) => string } {
  const muted = (c: Palette) => c.secondary;
  if (!p.enabled) return { text: "Off", color: muted };
  if (p.settings.pairingRequest) return { text: "Waiting for approval", color: muted };
  if (p.checkedAt === null) return { text: "Checking…", color: muted };
  if (p.status === "ready") return { text: "Connected", color: (c) => c.focus };
  if (p.status === "error") return { text: "Not answering", color: (c) => c.error };
  return { text: "Not connected", color: muted };
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** How an agent's tools are approved (core's RuntimeMode), as the Swift app names them. */
export const RUNTIME_MODES = [
  ["approval-required", "Supervised"],
  ["auto-accept-edits", "Auto accept edits"],
  ["full-access", "Full access"],
] as const;
