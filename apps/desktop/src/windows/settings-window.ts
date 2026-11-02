export type SettingsTarget = {
  pane?:
    | "general"
    | "appearance"
    | "keybindings"
    | "accounts"
    | "agents"
    | "integrations"
    | "features"
    | "browser"
    | "otter";
  item?: string;
};

let pendingTarget: SettingsTarget | null = null;

export function setSettingsTarget(target: SettingsTarget): void {
  pendingTarget = target;
}

export function takeSettingsTarget(): SettingsTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}
