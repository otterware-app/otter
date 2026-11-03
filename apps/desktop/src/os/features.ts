import type { BridgeFeatures } from "@otter-mail/contracts";

const everywhere = {
  historyButtons: true,
  windowTabs: true,
  launchAtLogin: true,
  defaultMailApp: true,
  dragOut: true,
  openFiles: true,
  externalAgent: true,
  localAgents: true,
  browser: true,
} satisfies Partial<BridgeFeatures>;

const mac: BridgeFeatures = {
  ...everywhere,
  windowControls: "left",
  tabWindows: true,
  dockBadge: true,
  translation: true,
};

const linux: BridgeFeatures = {
  ...everywhere,
  windowControls: "right",
  tabWindows: false,
  dockBadge: false,
  translation: false,
};

export function featuresFor(platform: NodeJS.Platform): BridgeFeatures {
  return platform === "darwin" ? mac : linux;
}
