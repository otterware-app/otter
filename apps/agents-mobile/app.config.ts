import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const production = process.env.OTTER_APP_VARIANT === "production";
const bundleIdentifier = production ? "dev.otterware.agents" : "dev.otterware.agents.dev";
const googleClientId = production
  ? "997327858649-vcvktkdnrs6p8c31ucsp1oeia7l8taho.apps.googleusercontent.com"
  : "997327858649-0dfa4knnv1ur7021dn1ojuovoj1i3ed8.apps.googleusercontent.com";
const googleScheme = googleClientId.split(".").toReversed().join(".");

const projectId = "1536a3a4-40a7-477e-8c1b-00c7e29ff6dc";
/**
 * The native app's fingerprint, which a release build and the updates published for it share
 * (scripts/agents-runtime.ts): an update reaches only the builds whose native code it runs on.
 */
const runtimeVersion = process.env.OTTER_AGENTS_RUNTIME_VERSION;

const camera = "Scan a QR code to connect your agent, or take a photo to send to it.";
const microphone = "Talk with your agent: it hears you while you're on a call.";
const assets = "./assets";
const appIcon = `${assets}/AppIcon.appiconset`;

const config: ExpoConfig = {
  name: "Otter Agents",
  slug: "otter-agents",
  owner: "otterware-app",
  extra: { eas: { projectId } },
  version: process.env.OTTER_AGENTS_RELEASE_VERSION ?? version,
  runtimeVersion: runtimeVersion ?? { policy: "appVersion" },
  // Checked at launch and applied at the next one, as t3code's app does.
  updates: {
    enabled: Boolean(runtimeVersion),
    url: `https://u.expo.dev/${projectId}`,
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
    requestHeaders: { "expo-channel-name": "production" },
  },
  platforms: ["ios"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  scheme: [bundleIdentifier, googleScheme],
  ios: {
    bundleIdentifier,
    buildNumber: process.env.OTTER_AGENTS_RELEASE_BUILD,
    appleTeamId: "838JVGY7W4",
    deploymentTarget: "27.0",
    supportsTablet: false,
    icon: production
      ? {
          light: `${appIcon}/icon-1024.png`,
          dark: `${appIcon}/icon-dark-1024.png`,
          tinted: `${appIcon}/icon-tinted-1024.png`,
        }
      : `${assets}/AppIconDev.appiconset/icon-1024.png`,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      GoogleClientID: googleClientId,
      NSMicrophoneUsageDescription: microphone,
      UIBackgroundModes: ["audio"],
    },
  },
  plugins: [
    "expo-router",
    "./plugins/with-agent-notifications.cjs",
    ...(process.env.OTTER_AGENTS_RELEASE_BUILD ? ["./plugins/with-release-signing.cjs"] : []),
    "@bacons/apple-targets",
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
