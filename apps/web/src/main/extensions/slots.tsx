/**
 * The slots the app's screens draw extensions in (types.ts): the message
 * header, cards and body, the reader's toolbar and menus, the list's menu,
 * ⌘K, and the dialogs. Each draws the extensions that are on; the hooks run
 * for every extension that has them, on or off, so their order never changes.
 */

import { Fragment, useMemo, type ReactNode } from "react";

import { ContextMenuItem, DropdownMenuItem } from "../mail/menu";
import type { MessageDetail } from "../mail/types";
import { HintTooltip, IconBtn } from "../mail/ui";
import {
  EXTENSIONS,
  availableExtensions,
  useDisabledExtensions,
  useEnabledExtensions,
} from "./registry";
import type {
  ConversationInput,
  MessageCardProps,
  MessageTarget,
  PaletteCommand,
  UiExtension,
} from "./types";

/** Whether each extension is on here: in this app, and not turned off. */
function useIsOn(): (id: string) => boolean {
  const disabled = useDisabledExtensions();
  const available = new Set(availableExtensions().map((e) => e.manifest.id));
  return (id) => available.has(id) && !disabled.has(id);
}

const withBody = EXTENSIONS.filter((e) => e.useMessageBody);
const withConversation = EXTENSIONS.filter((e) => e.useConversation);

export function ExtensionMessageCards(props: MessageCardProps) {
  return useEnabledExtensions().flatMap(({ manifest, messageCards = [] }) =>
    messageCards.map((Card) => <Card key={`${manifest.id}:${Card.name}`} {...props} />),
  );
}

/** The body after the extensions that swap it (Translation), and their banners. */
export function useExtensionMessageBody(accountId: string, detail: MessageDetail | undefined) {
  const isOn = useIsOn();
  let bodyHtml = detail?.bodyHtml ?? null;
  let bodyText = detail?.bodyText ?? null;
  const banners: ReactNode[] = [];
  for (const { manifest, useMessageBody } of withBody) {
    // oxlint-disable-next-line react/hooks -- `withBody` is fixed when the module loads: the same hooks, in the same order, every render.
    const out = useMessageBody!({ accountId, detail, enabled: isOn(manifest.id) });
    if (out.banner) banners.push(<Fragment key={manifest.id}>{out.banner}</Fragment>);
    if (out.bodyHtml !== undefined) bodyHtml = out.bodyHtml;
    if (out.bodyText !== undefined) bodyText = out.bodyText;
  }
  return { banner: banners, bodyHtml, bodyText };
}

/** A link in a body an extension answers in place: `#otter-ext:<id>:<answer>` in the frame. */
export type BodyLinkHandler = {
  id: string;
  answer: (href: string) => string | null;
  open: (answer: string) => void;
};

/** The extensions answering links in this message's body (an invite's Yes / No / Maybe). */
export function useExtensionBodyLinks(
  messageId: string,
  detail: MessageDetail | undefined,
): BodyLinkHandler[] {
  const enabled = useEnabledExtensions();
  if (!detail) return [];
  return enabled.flatMap(({ manifest, bodyLinks }) =>
    bodyLinks?.applies(detail)
      ? [
          {
            id: manifest.id,
            answer: bodyLinks.answer,
            open: (answer: string) => bodyLinks.open(messageId, answer),
          },
        ]
      : [],
  );
}

/** Per open conversation: what wraps the reader, and the extensions' items in its "…" menu. */
export function useExtensionConversation(input: Omit<ConversationInput, "enabled">) {
  const isOn = useIsOn();
  const outputs: ({ id: string } & ReturnType<NonNullable<UiExtension["useConversation"]>>)[] = [];
  for (const { manifest, useConversation } of withConversation) {
    // oxlint-disable-next-line react/hooks -- `withConversation` is fixed when the module loads: the same hooks, in the same order, every render.
    const output = useConversation!({ ...input, enabled: isOn(manifest.id) });
    outputs.push({ id: manifest.id, ...output });
  }
  return {
    wrap: (children: ReactNode) =>
      outputs.reduceRight<ReactNode>((inner, o) => (o.wrap ? o.wrap(inner) : inner), children),
    menuItems: outputs.map((o) =>
      o.menuItems ? <Fragment key={o.id}>{o.menuItems}</Fragment> : null,
    ),
  };
}

function useMessageActions() {
  return useEnabledExtensions().flatMap((e) => e.messageActions ?? []);
}

/** The extensions' buttons in the reader's toolbar. */
export function ExtensionToolbarActions({ target }: { target: MessageTarget }) {
  return useMessageActions()
    .filter((a) => a.toolbar)
    .map(({ id, label, Icon, run }) => (
      <HintTooltip key={id} label={label} side="bottom">
        <IconBtn label={label} onClick={() => run(target)}>
          <Icon className="size-4" />
        </IconBtn>
      </HintTooltip>
    ));
}

/** The extensions' items in the reader's "…" menu. */
export function ExtensionMenuActions({ target }: { target: MessageTarget }) {
  return useMessageActions().map(({ id, label, menuLabel, run }) => (
    <DropdownMenuItem key={id} onSelect={() => run(target)}>
      {menuLabel ?? label}
    </DropdownMenuItem>
  ));
}

/** The extensions' items in the list's right-click menu. */
export function ExtensionContextMenuActions({ target }: { target: MessageTarget }) {
  return useMessageActions().map(({ id, label, menuLabel, run }) => (
    <ContextMenuItem key={id} onSelect={() => run(target)}>
      {menuLabel ?? label}
    </ContextMenuItem>
  ));
}

/** The extensions' commands for ⌘K. */
export function useExtensionCommands(): PaletteCommand[] {
  const enabled = useEnabledExtensions();
  return useMemo(() => enabled.flatMap((e) => e.commands ?? []), [enabled]);
}

/** Mounted once with the app: the dialogs extensions open. */
export function ExtensionDialogs() {
  return useEnabledExtensions().map(({ manifest, Dialogs }) =>
    Dialogs ? <Dialogs key={manifest.id} /> : null,
  );
}
