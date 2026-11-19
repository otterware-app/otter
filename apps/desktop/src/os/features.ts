import type { BridgeFeatures } from "@otter/contracts";

const everywhere = {
  historyButtons: true,
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
  dockBadge: true,
  swipeNavigation: true,
  translation: true,
  phoneCalls: true,
};

const linux: BridgeFeatures = {
  ...everywhere,
  windowControls: "right",
  dockBadge: false,
  swipeNavigation: false,
  translation: false,
  phoneCalls: false,
};

export function featuresFor(platform: NodeJS.Platform): BridgeFeatures {
  return platform === "darwin" ? mac : linux;
}
