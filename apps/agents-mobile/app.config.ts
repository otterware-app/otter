import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const bundleIdentifier =
  process.env.OTTER_APP_VARIANT === "production"
    ? "dev.otterware.agents"
    : "dev.otterware.agents.dev";

const camera = "Scan a QR code to connect your agent, or take a photo to send to it.";
const microphone = "Talk with your agent: it hears you while you're on a call.";

const config: ExpoConfig = {
  name: "Otter Agents",
  slug: "otter-agents",
  version,
  platforms: ["ios"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  scheme: bundleIdentifier,
  ios: {
    bundleIdentifier,
    appleTeamId: "838JVGY7W4",
    deploymentTarget: "27.0",
    supportsTablet: false,
    config: { usesNonExemptEncryption: false },
  },
  plugins: [
    "expo-router",
    ["expo-font", { fonts: ["../../packages/ui-native/fonts/InterVariable.ttf"] }],
    ["expo-camera", { cameraPermission: camera, microphonePermission: microphone }],
    // Photos come through the system's picker, which needs no access to the library.
    [
      "expo-image-picker",
      { photosPermission: false, cameraPermission: camera, microphonePermission: microphone },
    ],
    "expo-image",
    "expo-web-browser",
    "expo-sharing",
    "expo-status-bar",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
};

export default config;
