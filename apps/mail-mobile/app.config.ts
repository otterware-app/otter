import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const production = process.env.OTTER_APP_VARIANT === "production";
const bundleIdentifier = production ? "dev.otterware.mail" : "dev.otterware.mail.dev";
const googleClientId = production
  ? "997327858649-vcvktkdnrs6p8c31ucsp1oeia7l8taho.apps.googleusercontent.com"
  : "997327858649-0dfa4knnv1ur7021dn1ojuovoj1i3ed8.apps.googleusercontent.com";
const icon = "../ios/OtterMail/Assets.xcassets/AppIcon.appiconset";

const config: ExpoConfig = {
  name: "Otter Mail",
  slug: "otter-mail",
  owner: "otterware-app",
  extra: { eas: { projectId: "2fbe5710-15c4-4415-a161-6653afc1db9e" } },
  version,
  platforms: ["ios"],
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  scheme: [bundleIdentifier, "ottermail-notifications"],
  ios: {
    bundleIdentifier,
    appleTeamId: "838JVGY7W4",
    deploymentTarget: "27.0",
    supportsTablet: false,
    icon: production
      ? {
          light: `${icon}/icon-1024.png`,
          dark: `${icon}/icon-dark-1024.png`,
          tinted: `${icon}/icon-tinted-1024.png`,
        }
      : "../ios/OtterMail/Assets.xcassets/AppIconDev.appiconset/icon-1024.png",
    infoPlist: {
      GoogleClientID: googleClientId,
      LSApplicationQueriesSchemes: ["dev.otterware.agents", "dev.otterware.agents.dev"],
    },
    config: { usesNonExemptEncryption: false },
  },
  plugins: [
    "expo-router",
    "./plugins/with-mail-auth.cjs",
    "./plugins/with-mail-notifications.cjs",
    "@bacons/apple-targets",
    ["expo-font", { fonts: ["../../packages/ui-native/fonts/InterVariable.ttf"] }],
    "expo-image",
    "expo-status-bar",
  ],
};

export default config;
