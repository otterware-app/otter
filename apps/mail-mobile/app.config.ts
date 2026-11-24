import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const bundleIdentifier = "dev.otterware.mail.dev";

const config: ExpoConfig = {
  name: "Otter Mail",
  slug: "otter-mail",
  owner: "otterware-app",
  extra: { eas: { projectId: "2fbe5710-15c4-4415-a161-6653afc1db9e" } },
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
    icon: "../ios/OtterMail/Assets.xcassets/AppIconDev.appiconset/icon-1024.png",
    config: { usesNonExemptEncryption: false },
  },
  plugins: [
    "expo-router",
    ["expo-font", { fonts: ["../../packages/ui-native/fonts/InterVariable.ttf"] }],
    "expo-image",
    "expo-status-bar",
  ],
};

export default config;
