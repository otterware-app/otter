export const MAILBOX_JUMP_COMMANDS = [
  "mailbox.jump.1",
  "mailbox.jump.2",
  "mailbox.jump.3",
  "mailbox.jump.4",
  "mailbox.jump.5",
  "mailbox.jump.6",
  "mailbox.jump.7",
  "mailbox.jump.8",
  "mailbox.jump.9",
] as const;

export const AGENT_PICKER_JUMP_COMMANDS = [
  "agentPicker.jump.1",
  "agentPicker.jump.2",
  "agentPicker.jump.3",
  "agentPicker.jump.4",
  "agentPicker.jump.5",
  "agentPicker.jump.6",
  "agentPicker.jump.7",
  "agentPicker.jump.8",
  "agentPicker.jump.9",
] as const;

export const KEYBINDING_COMMANDS = [
  "commandPalette.toggle",
  "sidebar.toggle",
  "agent.toggle",
  "agent.openWorkspace",
  "agent.newChat",
  "mode.mail",
  "mode.calendar",
  "mode.drive",
  "mode.agent",
  "browser.toggle",
  "browser.newTab",
  "tab.previous",
  "agentPicker.toggle",
  "composer.mode",
  "agent.sendQueuedNow",
  "agent.editQueued",
  ...AGENT_PICKER_JUMP_COMMANDS,
  "search.focus",
  "compose.new",
  "composer.send",
  "keybindings.show",
  "mail.undo",
  "mail.redo",
  "go.inbox",
  "go.sent",
  "go.starred",
  "go.drafts",
  "go.allMail",
  ...MAILBOX_JUMP_COMMANDS,
  "list.next",
  "list.previous",
  "list.extendSelectionDown",
  "list.extendSelectionUp",
  "list.open",
  "list.expandThread",
  "list.collapseThread",
  "message.close",
  "message.reply",
  "message.replyAll",
  "message.forward",
  "message.archive",
  "message.trash",
  "message.junk",
  "message.star",
  "message.markRead",
  "message.markUnread",
  "message.label",
  "message.move",
  "message.translate",
] as const;

export const LABEL_MOVE_PREFIX = "label.move:";

export type LabelMoveCommand = `${typeof LABEL_MOVE_PREFIX}${string}`;

export type KeybindingCommand = (typeof KEYBINDING_COMMANDS)[number] | LabelMoveCommand;

export type CommandHandlerKey = (typeof KEYBINDING_COMMANDS)[number] | "label.move";

export function labelMoveCommand(labelName: string): LabelMoveCommand {
  return `${LABEL_MOVE_PREFIX}${labelName}`;
}

export function labelMoveName(command: string): string | null {
  if (!command.startsWith(LABEL_MOVE_PREFIX)) return null;
  const name = command.slice(LABEL_MOVE_PREFIX.length).trim();
  return name || null;
}

export function isKeybindingCommand(value: string): value is KeybindingCommand {
  return (
    (KEYBINDING_COMMANDS as readonly string[]).includes(value) || labelMoveName(value) !== null
  );
}

export type KeybindingRule = {
  key: string;
  command: KeybindingCommand;
  when?: string;
};

export const WHEN_VARIABLES = [
  "editableFocus",
  "dialogOpen",
  "settingsOpen",
  "workspaceOpen",
  "messageOpen",
  "agentOpen",
  "agentPickerOpen",
  "true",
  "false",
] as const;

const OUTSIDE_FIELDS = "!editableFocus && !dialogOpen";
export const IN_MAIL = "!editableFocus && !dialogOpen && !settingsOpen && !workspaceOpen";
const ON_MESSAGE = `${IN_MAIL} && messageOpen`;

export const DEFAULT_KEYBINDINGS: ReadonlyArray<KeybindingRule> = [
  { key: "mod+k", command: "commandPalette.toggle" },
  { key: "mod+b", command: "sidebar.toggle", when: OUTSIDE_FIELDS },
  { key: "mod+i", command: "agent.toggle", when: "!dialogOpen" },
  { key: "mod+shift+f", command: "agent.openWorkspace", when: "!dialogOpen" },
  { key: "mod+n", command: "agent.newChat", when: "agentOpen && !dialogOpen" },
  { key: "mod+shift+o", command: "agent.newChat", when: "!dialogOpen" },
  { key: "g m", command: "mode.mail", when: OUTSIDE_FIELDS },
  { key: "g c", command: "mode.calendar", when: OUTSIDE_FIELDS },
  { key: "g d", command: "mode.drive", when: OUTSIDE_FIELDS },
  { key: "g a", command: "mode.agent", when: OUTSIDE_FIELDS },
  { key: "mod+shift+b", command: "browser.toggle", when: "!dialogOpen" },
  { key: "mod+t", command: "browser.newTab", when: "!dialogOpen" },
  { key: "ctrl+tab", command: "tab.previous", when: "!dialogOpen" },
  { key: "mod+shift+m", command: "agentPicker.toggle", when: "agentOpen" },
  { key: "mod+shift+a", command: "composer.mode", when: "agentOpen" },
  {
    key: "mod+shift+enter",
    command: "agent.sendQueuedNow",
    when: "agentOpen",
  },
  {
    key: "alt+arrowup",
    command: "agent.editQueued",
    when: "agentOpen && editableFocus",
  },
  ...AGENT_PICKER_JUMP_COMMANDS.map((command, i): KeybindingRule => ({
    key: `mod+${i + 1}`,
    command,
    when: "agentPickerOpen",
  })),
  { key: "/", command: "search.focus", when: OUTSIDE_FIELDS },
  { key: "mod+f", command: "search.focus", when: "!dialogOpen" },
  { key: "c", command: "compose.new", when: OUTSIDE_FIELDS },
  { key: "mod+enter", command: "composer.send" },
  { key: "?", command: "keybindings.show", when: OUTSIDE_FIELDS },
  { key: "z", command: "mail.undo", when: OUTSIDE_FIELDS },
  { key: "shift+z", command: "mail.redo", when: OUTSIDE_FIELDS },
  { key: "g i", command: "go.inbox", when: IN_MAIL },
  { key: "g t", command: "go.sent", when: IN_MAIL },
  { key: "g s", command: "go.starred", when: IN_MAIL },
  ...MAILBOX_JUMP_COMMANDS.map((command, i): KeybindingRule => ({
    key: `mod+${i + 1}`,
    command,
    when: "!dialogOpen",
  })),
  { key: "j", command: "list.next", when: IN_MAIL },
  { key: "arrowdown", command: "list.next", when: IN_MAIL },
  { key: "k", command: "list.previous", when: IN_MAIL },
  { key: "arrowup", command: "list.previous", when: IN_MAIL },
  { key: "shift+arrowdown", command: "list.extendSelectionDown", when: IN_MAIL },
  { key: "shift+arrowup", command: "list.extendSelectionUp", when: IN_MAIL },
  { key: "enter", command: "list.open", when: IN_MAIL },
  { key: "arrowright", command: "list.expandThread", when: IN_MAIL },
  { key: "arrowleft", command: "list.collapseThread", when: IN_MAIL },
  { key: "u", command: "message.close", when: ON_MESSAGE },
  { key: "escape", command: "message.close", when: ON_MESSAGE },
  { key: "r", command: "message.reply", when: ON_MESSAGE },
  { key: "a", command: "message.replyAll", when: ON_MESSAGE },
  { key: "f", command: "message.forward", when: ON_MESSAGE },
  { key: "e", command: "message.archive", when: IN_MAIL },
  { key: "#", command: "message.trash", when: IN_MAIL },
  { key: "backspace", command: "message.trash", when: IN_MAIL },
  { key: "delete", command: "message.trash", when: IN_MAIL },
  { key: "!", command: "message.junk", when: IN_MAIL },
  { key: "s", command: "message.star", when: IN_MAIL },
  { key: "shift+i", command: "message.markRead", when: IN_MAIL },
  { key: "shift+u", command: "message.markUnread", when: IN_MAIL },
  { key: "l", command: "message.label", when: IN_MAIL },
  { key: "v", command: "message.move", when: IN_MAIL },
  { key: "t", command: "message.translate", when: ON_MESSAGE },
];

function titleCaseSegment(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function commandLabel(command: string): string {
  const labelName = labelMoveName(command);
  if (labelName !== null) return `Move to Label: ${labelName}`;
  return command.split(".").map(titleCaseSegment).join(": ");
}
