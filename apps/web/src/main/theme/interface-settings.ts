import { useSyncExternalStore } from "react";
import { setSyncedPreference, type SyncedKey } from "../synced-preferences";

export type InterfaceSetting = Readonly<{
  key: SyncedKey;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}>;

export type InterfaceToggle = Readonly<{
  key: SyncedKey;
  defaultValue: boolean;
}>;

export const GROUP_MESSAGES_BY_DAY: InterfaceToggle = {
  key: "otter:group-messages-by-day",
  defaultValue: true,
};

export const OPEN_MESSAGES_WITH_ARROWS: InterfaceToggle = {
  key: "otter:open-messages-with-arrows",
  defaultValue: false,
};

const TOGGLES = [GROUP_MESSAGES_BY_DAY, OPEN_MESSAGES_WITH_ARROWS];

/** How long an email opened by keyboard navigation stays visible before being read. */
export const MARK_READ_DELAY: InterfaceSetting = {
  key: "otter:mark-read-delay",
  min: 0,
  max: 5000,
  step: 250,
  defaultValue: 2000,
};

export const CONTRAST: InterfaceSetting = {
  key: "otter:contrast",
  min: 50,
  max: 200,
  step: 5,
  defaultValue: 100,
};

export const GLASS_OPACITY: InterfaceSetting = {
  key: "otter:glass-opacity",
  min: 40,
  max: 100,
  step: 5,
  defaultValue: 80,
};

export const INTERFACE_FONT_SIZE: InterfaceSetting = {
  key: "otter:interface-font-size",
  min: 12,
  max: 20,
  step: 1,
  defaultValue: 16,
};

const SETTINGS = [CONTRAST, GLASS_OPACITY, INTERFACE_FONT_SIZE, MARK_READ_DELAY];
const CHANGE_EVENT = "otter:interface-settings-change";

export const READING_WIDTHS = {
  normal: { label: "Normal", maxWidth: "48rem" },
  wide: { label: "Wide", maxWidth: "64rem" },
  full: { label: "Full width", maxWidth: "none" },
} as const;
export type ReadingWidth = keyof typeof READING_WIDTHS;
export const DEFAULT_READING_WIDTH: ReadingWidth = "full";
const READING_WIDTH_KEY = "otter:reading-width";

export const MAIL_LAYOUTS = {
  split: { label: "Split view", description: "Keep the message list beside the conversation." },
  full: { label: "Full inbox", description: "A wide inbox. Open a message to read it in full." },
  floating: {
    label: "Floating",
    description: "Open mail in a bottom-right panel. Keep browsing your inbox.",
  },
} as const;
export type MailLayout = keyof typeof MAIL_LAYOUTS;
export const DEFAULT_MAIL_LAYOUT: MailLayout = "split";
const MAIL_LAYOUT_KEY = "otter:mail-layout";

export function getMailLayout(): MailLayout {
  const value = localStorage.getItem(MAIL_LAYOUT_KEY);
  if (value === "flow" || value === "popup") return "floating";
  return value !== null && Object.hasOwn(MAIL_LAYOUTS, value)
    ? (value as MailLayout)
    : DEFAULT_MAIL_LAYOUT;
}

export function setMailLayout(layout: MailLayout): void {
  setSyncedPreference(MAIL_LAYOUT_KEY, layout);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function isReadingWidth(value: string | null): value is ReadingWidth {
  return value !== null && Object.hasOwn(READING_WIDTHS, value);
}

export function getReadingWidth(): ReadingWidth {
  const value = localStorage.getItem(READING_WIDTH_KEY);
  return isReadingWidth(value) ? value : DEFAULT_READING_WIDTH;
}

export function setReadingWidth(width: ReadingWidth): void {
  setSyncedPreference(READING_WIDTH_KEY, width);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function isValid(setting: InterfaceSetting, value: number): boolean {
  return Number.isInteger(value) && value >= setting.min && value <= setting.max;
}

export function getInterfaceSetting(setting: InterfaceSetting): number {
  const raw = localStorage.getItem(setting.key);
  const value = raw === null ? NaN : Number(raw);
  return isValid(setting, value) ? value : setting.defaultValue;
}

export function setInterfaceSetting(setting: InterfaceSetting, value: number): void {
  if (!isValid(setting, value)) return;
  setSyncedPreference(setting.key, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function getInterfaceToggle(setting: InterfaceToggle): boolean {
  const value = localStorage.getItem(setting.key);
  return value === "true" ? true : value === "false" ? false : setting.defaultValue;
}

export function setInterfaceToggle(setting: InterfaceToggle, value: boolean): void {
  setSyncedPreference(setting.key, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === READING_WIDTH_KEY ||
      e.key === MAIL_LAYOUT_KEY ||
      TOGGLES.some((setting) => setting.key === e.key) ||
      SETTINGS.some((setting) => setting.key === e.key)
    ) {
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useInterfaceSetting(setting: InterfaceSetting): number {
  return useSyncExternalStore(subscribe, () => getInterfaceSetting(setting));
}

export function useInterfaceToggle(setting: InterfaceToggle): boolean {
  return useSyncExternalStore(subscribe, () => getInterfaceToggle(setting));
}

export function useReadingWidth(): ReadingWidth {
  return useSyncExternalStore(subscribe, getReadingWidth);
}

export function useMailLayout(): MailLayout {
  return useSyncExternalStore(subscribe, getMailLayout);
}

export function applyInterfaceSettings(): void {
  const style = document.documentElement.style;

  const contrast = getInterfaceSetting(CONTRAST);
  style.setProperty("--appearance-contrast-base", `${Math.min(contrast, 100)}%`);
  style.setProperty("--appearance-contrast-boost", `${Math.max(contrast - 100, 0)}%`);
  style.setProperty("--appearance-contrast-border-boost", `${Math.max(contrast - 100, 0) / 4}%`);

  const glass = getInterfaceSetting(GLASS_OPACITY);
  style.setProperty("--glass-opacity", `${glass}%`);
  if (glass === 100) style.setProperty("--glass-blur", "0px");
  else style.removeProperty("--glass-blur");

  style.fontSize = `${getInterfaceSetting(INTERFACE_FONT_SIZE)}px`;

  style.setProperty("--reading-width", READING_WIDTHS[getReadingWidth()].maxWidth);
}

export function startInterfaceSettings(): () => void {
  applyInterfaceSettings();
  return subscribe(applyInterfaceSettings);
}
