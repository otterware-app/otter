import { errorReportsAvailable } from "../error-reports";
import { features } from "../features";
import { CATEGORY_PANE, availableExtensions } from "../extensions/registry";
import { osNames } from "../os-names";
import type { SettingsPane } from "../mail/api";
import { commandLabel, DEFAULT_KEYBINDINGS, KEYBINDING_COMMANDS } from "../keybindings/commands";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly pane: SettingsPane;
  readonly item?: string;
  readonly targetId?: string;
  readonly searchTerms?: ReadonlyArray<string>;
  /**
   * Sorts after every other match. Keybinding commands mirror rows on other
   * panes, so "notifications" still leads with Notifications, not a command.
   */
  readonly secondary?: boolean;
  readonly available?: boolean;
}

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPane, string>> = {
  general: "General",
  otter: "Account",
  appearance: "Appearance",
  keybindings: "Keybindings",
  accounts: "Connections",
  calendar: "Calendar",
  agents: "Agents",
  integrations: "Integrations",
  features: "Features",
  browser: "Browser",
};

export const PLUG_IN_PANES: readonly SettingsPane[] = [
  "agents",
  "integrations",
  "features",
  "browser",
];

export function keybindingSearchAnchorId(command: string) {
  return `keybinding-${command}`;
}

const KEYBINDING_SEARCH_ITEMS: ReadonlyArray<SettingsSearchItem> = KEYBINDING_COMMANDS.toSorted(
  (left, right) => commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => ({
  id: keybindingSearchAnchorId(command),
  title: commandLabel(command),
  pane: "keybindings",
  searchTerms: [
    command,
    ...DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map((b) => b.key),
  ],
  secondary: true,
}));

export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "todoist",
    title: "Todoist",
    pane: "accounts",
    item: "todoist",
    searchTerms: ["tasks projects due date priority API token connect disconnect"],
  },
  {
    id: "otter-drive",
    title: "Otter Drive",
    pane: "accounts",
    item: "otter-drive",
    available: window.desktopBridge.platform !== "web",
    searchTerms: ["artifacts files documents attachments save sign in organization"],
  },
  {
    id: "launch-at-login",
    title: "Launch at login",
    pane: "general",
    available: features.launchAtLogin,
    searchTerms: ["startup open automatically log in mac computer"],
  },
  {
    id: "dock-badge",
    title: "Show unread count on Dock icon",
    pane: "general",
    available: features.dockBadge,
    searchTerms: ["badge number unread"],
  },
  {
    id: "sync-interval",
    title: "Check for new mail",
    pane: "general",
    searchTerms: ["sync fetch refresh background interval cadence manually minutes seconds"],
  },
  {
    id: "notifications",
    title: "Notifications",
    pane: "general",
    searchTerms: ["alerts new mail inbox only all off banner"],
  },
  {
    id: "calendar-week-start",
    title: "Start of week",
    pane: "calendar",
    searchTerms: ["first day week sunday monday saturday calendar"],
  },
  {
    id: "calendar-weekends",
    title: "Show weekends",
    pane: "calendar",
    searchTerms: ["saturday sunday work week weekdays calendar"],
  },
  {
    id: "calendar-declined",
    title: "Show declined events",
    pane: "calendar",
    searchTerms: ["declined invitations no rsvp hide calendar"],
  },
  {
    id: "calendar-meetings",
    title: "Conferencing",
    pane: "calendar",
    searchTerms: ["google meet microsoft teams video call online meeting conference default"],
  },
  {
    id: "calendar-time-format",
    title: "Time format",
    pane: "calendar",
    searchTerms: ["12-hour 24-hour clock AM PM calendar"],
  },

  {
    id: "advance-direction",
    title: "After archive, delete, or move",
    pane: "general",
    searchTerms: ["next previous message select auto advance"],
  },
  {
    id: "read-languages",
    title: "Languages I read",
    pane: "features",
    item: "translation",
    available: features.translation,
    searchTerms: ["translation translate language foreign"],
  },
  {
    id: "auto-translate",
    title: "Translate automatically",
    pane: "features",
    item: "translation",
    available: features.translation,
    searchTerms: ["translation language foreign auto"],
  },
  {
    id: "default-mail-app",
    title: "Default email app",
    pane: "general",
    available: features.defaultMailApp,
    searchTerms: ["mailto links handler mac system"],
  },
  {
    id: "tour",
    title: "Tour",
    pane: "general",
    searchTerms: ["getting started walkthrough help onboarding"],
  },
  {
    id: "setup",
    title: "Setup",
    pane: "general",
    searchTerms: ["getting started onboarding run again wizard"],
  },
  {
    id: "updates",
    title: "Updates",
    pane: "general",
    searchTerms: ["version check restart to update release about channel stable nightly"],
  },
  {
    id: "send-feedback",
    title: "Send feedback",
    pane: "general",
    searchTerms: ["support report bug problem suggest feature help"],
  },
  {
    id: "error-reports",
    title: "Send error reports",
    pane: "general",
    available: errorReportsAvailable,
    searchTerms: ["crash diagnostics sentry privacy telemetry bug"],
  },
  {
    id: "open-source-licenses",
    title: "Open-source licenses",
    pane: "general",
    searchTerms: ["third party notices credits acknowledgements attribution legal about"],
  },
  {
    id: "otter-account",
    title: "Otter account",
    pane: "otter",
    searchTerms: ["sign in sign out profile sync devices realtime push"],
  },
  {
    id: "devices",
    title: "Devices",
    pane: "otter",
    searchTerms: ["signed in sessions sign out computers phones"],
  },
  {
    id: "delete-otter-account",
    title: "Delete Otter account",
    pane: "otter",
    searchTerms: ["remove close"],
  },
  {
    id: "color-scheme",
    title: "Color scheme",
    pane: "appearance",
    searchTerms: ["mode light dark system"],
  },
  {
    id: "themes",
    title: "Themes",
    pane: "appearance",
    searchTerms: ["colors palette look", "custom create duplicate import export"],
  },
  {
    id: "contrast",
    title: "Contrast",
    pane: "appearance",
    searchTerms: ["text borders legibility accessibility"],
  },
  {
    id: "glass-opacity",
    title: "Glass opacity",
    pane: "appearance",
    searchTerms: ["transparency blur translucent menus dialogs solid"],
  },
  {
    id: "font-size",
    title: "Font size",
    pane: "appearance",
    searchTerms: ["text size bigger smaller zoom scale typography accessibility"],
  },
  {
    id: "mail-layout",
    title: "Mail layout",
    pane: "appearance",
    searchTerms: [
      "auto split view full inbox",
      "reading pane columns wide list layout automatic responsive narrow window",
    ],
  },
  {
    id: "reading-width",
    title: "Reading width",
    pane: "appearance",
    searchTerms: ["email thread message reader wide narrow full column space"],
  },
  {
    id: "group-messages-by-day",
    title: "Group messages by day",
    pane: "appearance",
    searchTerms: ["date separators today yesterday collapse expand sections inbox"],
  },
  {
    id: "full-width-rows",
    title: "Full-width rows",
    pane: "appearance",
    searchTerms: ["dividers lines separators cards edge to edge gmail compact list rows"],
  },
  {
    id: "open-messages-with-arrows",
    title: "Open messages with arrow keys",
    pane: "appearance",
    searchTerms: ["keyboard navigation j k highlight selection enter reading pane preview"],
  },
  {
    id: "mark-read-delay",
    title: "Mark as read delay",
    pane: "appearance",
    searchTerms: ["unread read timer seconds keyboard arrows preview browsing"],
  },
  {
    id: "panel-animations",
    title: "Panel animations",
    pane: "appearance",
    searchTerms: ["motion speed duration fast slow"],
  },
  {
    id: "keybindings",
    title: "Keybindings",
    pane: "keybindings",
    searchTerms: ["keyboard shortcuts hotkeys commands bindings"],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "mailboxes",
    title: "Connections",
    pane: "accounts",
    searchTerms: [
      "mailboxes accounts connected google gmail outlook microsoft icloud imap todoist otter drive turn on off order reorder drag add",
    ],
  },
  {
    id: "mailbox-status",
    title: "Mailbox status",
    pane: "accounts",
    searchTerms: ["sync now sign in again refresh password"],
  },
  {
    id: "mailbox-display-name",
    title: "Display name",
    pane: "accounts",
    searchTerms: ["account rename name sidebar"],
  },
  {
    id: "mailbox-color",
    title: "Mailbox color",
    pane: "accounts",
    searchTerms: ["account colour combined"],
  },
  {
    id: "mailbox-picture",
    title: "Picture",
    pane: "accounts",
    searchTerms: ["mailbox account picture photo avatar image profile icon"],
  },
  {
    id: "signature",
    title: "Signature",
    pane: "accounts",
    searchTerms: ["sign off footer replies forwards"],
  },
  {
    id: "mailbox-access",
    title: "Access",
    pane: "accounts",
    searchTerms: ["permission allow calendar sign in again scopes grant"],
  },
  {
    id: "send-as",
    title: "Send from",
    pane: "accounts",
    searchTerms: ["alias aliases addresses from custom domain icloud send mail as"],
  },
  {
    id: "own-mailbox",
    title: "Own mailbox",
    pane: "accounts",
    searchTerms: ["alias mailbox address tab inbox separate custom domain icloud filter"],
  },
  {
    id: "alias-mail-in-parent",
    title: "Their mail in the account's tab too",
    pane: "accounts",
    searchTerms: ["alias mailbox mail parent tab twice duplicate rest only icloud"],
  },
  {
    id: "alias-mailbox",
    title: "Address with its own mailbox",
    pane: "accounts",
    searchTerms: ["alias mailbox name color signature stop"],
  },
  {
    id: "remove-mailbox",
    title: "Remove account",
    pane: "accounts",
    searchTerms: ["delete mailbox sign out"],
  },
  {
    id: "add-agent",
    title: "Add agent",
    pane: "agents",
    searchTerms: [
      "agents new another add server gateway team claude codex hermes openclaw varys connect",
    ],
  },
  {
    id: "agent-providers",
    title: "New chats start with",
    pane: "agents",
    searchTerms: [
      "agents api key server model claude codex hermes openclaw varys enable turn on off default new chats",
    ],
  },
  {
    id: "agent-binary-path",
    title: "Binary path",
    pane: "agents",
    available: features.localAgents,
    searchTerms: ["agents cli claude codex runtime home config directory launch arguments"],
  },
  {
    id: "agent-access",
    title: "Access",
    pane: "agents",
    available: features.localAgents,
    searchTerms: ["agents permissions runtime mode full access supervised approvals"],
  },
  {
    id: "agent-models",
    title: "Models",
    pane: "agents",
    searchTerms: ["agents favorites hidden default model"],
  },
  {
    id: "hermes-connection",
    title: "Connection",
    pane: "agents",
    searchTerms: ["hermes base url api key server connect"],
  },
  {
    id: "hermes-deliveries",
    title: "Messages from Hermes",
    pane: "agents",
    searchTerms: ["hermes plugin platform channel cron scheduled deliver send_message notify"],
  },
  {
    id: "openclaw-connection",
    title: "Connection",
    pane: "agents",
    searchTerms: ["openclaw gateway address token connect pair approve device tailscale"],
  },
  {
    id: "openclaw-deliveries",
    title: "Messages from your agents",
    pane: "agents",
    searchTerms: ["openclaw channel cron scheduled job deliver announce notify approval inbox"],
  },
  {
    id: "varys-connection",
    title: "Connection",
    pane: "agents",
    searchTerms: ["varys pair pairing link app code connect grant tailscale"],
  },
  {
    id: "varys-deliveries",
    title: "Messages from varys",
    pane: "agents",
    searchTerms: ["varys relay push routine notify approval question"],
  },
  {
    id: "follow-up-behavior",
    title: "Follow-up behavior",
    pane: "agents",
    searchTerms: ["chat queue steer running agent"],
  },
  {
    id: "connected-agents",
    title: `Agents on this ${osNames.computer}`,
    pane: "agents",
    available: features.localAgents,
    searchTerms: ["mcp server token connect claude code codex cursor external tools"],
  },
  {
    id: "browser-links",
    title: "Open links",
    pane: "browser",
    available: features.browser,
    searchTerms: ["links mail chat tab default browser safari chrome external"],
  },
  {
    id: "browser-extensions-button",
    title: "Extensions button",
    pane: "browser",
    available: features.browser,
    searchTerms: ["toolbar puzzle pin extensions menu"],
  },
  {
    id: "browser-extensions",
    title: "Extensions",
    pane: "browser",
    available: features.browser,
    searchTerms: [
      "chrome web store add-ons plugins ad blocker password manager developer mode unpacked",
    ],
  },
  {
    id: "browser-data",
    title: "Clear browsing data",
    pane: "browser",
    available: features.browser,
    searchTerms: ["cookies cache site data sign out history"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map<string, SettingsSearchItem>(
  SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item]),
);

export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID.get(id)!;
  return { id: anchorId, title };
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function extensionSearchItems(): SettingsSearchItem[] {
  return availableExtensions().map(({ manifest }) => ({
    id: `extension-${manifest.id}`,
    title: manifest.name,
    pane: CATEGORY_PANE[manifest.category],
    // An agent's page is each agent's you add, not its kind's.
    ...(manifest.category === "agent" ? {} : { item: manifest.id }),
    searchTerms: [`${manifest.description} extension`],
  }));
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = [...SETTINGS_SEARCH_ITEMS, ...extensionSearchItems()],
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");

  return items
    .flatMap((item, index) => {
      const title = normalizeSearchText(item.title);
      const fields = [
        title,
        normalizeSearchText(SETTINGS_SECTION_LABELS[item.pane]),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
      ];
      if (item.available === false) return [];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
