const linux = window.desktopBridge.platform === "linux";
const web = window.desktopBridge.platform === "web";

export const osNames = {
  computer: linux || web ? "computer" : "Mac",
  system: linux ? "Linux" : "macOS",
};
