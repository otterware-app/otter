import type { ExpoConfig } from "expo/config";

import packageJson from "./package.json";

type AppVariant = "development" | "preview" | "production";

const APP_VARIANT = resolveAppVariant(process.env.APP_VARIANT);
const runtimeVersionPolicy =
  process.env.MOBILE_VERSION_POLICY ??
  (APP_VARIANT === "development" ? "appVersion" : "fingerprint");

const fromRepoRoot = (relativePath: string) => `../../${relativePath}`;

const GOOGLE_IOS_CLIENT_ID = {
  development: "997327858649-0dfa4knnv1ur7021dn1ojuovoj1i3ed8.apps.googleusercontent.com",
  production: "997327858649-vcvktkdnrs6p8c31ucsp1oeia7l8taho.apps.googleusercontent.com",
} as const;

const PROD_ICON = {
  light: fromRepoRoot("assets/prod/otter-mail-ios-1024.png"),
  dark: fromRepoRoot("assets/prod/otter-mail-ios-dark-1024.png"),
  tinted: fromRepoRoot("assets/prod/otter-mail-ios-tinted-1024.png"),
};

/** The launch screen: the default theme's canvas (packages/shared's codex), light and dark. */
const CANVAS = { light: "#ffffff", dark: "#181818" };

/**
 * The required-reason APIs React Native, Expo and the native modules call
 * (otter-worker's uptime is SystemBootTime), and the reasons they do.
 */
const ACCESSED_APIS = [
  ["NSPrivacyAccessedAPICategoryUserDefaults", ["CA92.1"]],
  ["NSPrivacyAccessedAPICategoryFileTimestamp", ["C617.1", "0A2A.1", "3B52.1"]],
  ["NSPrivacyAccessedAPICategoryDiskSpace", ["E174.1", "85F4.1"]],
  ["NSPrivacyAccessedAPICategorySystemBootTime", ["35F9.1"]],
] as const;

/**
 * Each variant is its own app: its bundle ID, Keychain access group and App
 * Group, so a development or preview build never reads production's sign-ins.
 */
const VARIANT_CONFIG = {
  development: {
    appName: "Otter Mail Dev",
    scheme: "ottermail-dev",
    iosBundleIdentifier: "dev.otterware.mail.dev",
    icon: {
      light: fromRepoRoot("assets/dev/blueprint-ios-1024.png"),
      dark: fromRepoRoot("assets/dev/blueprint-ios-1024.png"),
      tinted: fromRepoRoot("assets/prod/otter-mail-ios-tinted-1024.png"),
    },
    googleClientId: GOOGLE_IOS_CLIENT_ID.development,
    apnsEnvironment: "development",
    trustLocalMailServers: true,
  },
  preview: {
    appName: "Otter Mail Preview",
    scheme: "ottermail-preview",
    iosBundleIdentifier: "dev.otterware.mail.preview",
    icon: PROD_ICON,
    googleClientId: GOOGLE_IOS_CLIENT_ID.development,
    apnsEnvironment: "production",
    trustLocalMailServers: false,
  },
  production: {
    appName: "Otter Mail",
    scheme: "ottermail",
    iosBundleIdentifier: "dev.otterware.mail",
    icon: PROD_ICON,
    googleClientId: GOOGLE_IOS_CLIENT_ID.production,
    apnsEnvironment: "production",
    trustLocalMailServers: false,
  },
} as const;

function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    case undefined:
      return "production";
    default:
      throw new Error("APP_VARIANT must be development, preview, or production.");
  }
}

const variant = VARIANT_CONFIG[APP_VARIANT];
const appGroup = `group.${variant.iosBundleIdentifier}.notifications`;

const config: ExpoConfig = {
  name: variant.appName,
  slug: "otter-mail",
  platforms: ["ios"],
  // ottermail-notifications: where the relay's notifications consent comes back to (otter-account).
  scheme: [variant.scheme, "ottermail-notifications"],
  // The release sets the version it resolved; package.json has the last one released.
  version: process.env.OTTER_MAIL_MOBILE_VERSION ?? packageJson.version,
  runtimeVersion: { policy: runtimeVersionPolicy as "appVersion" | "fingerprint" },
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    icon: variant.icon,
    supportsTablet: false,
    bundleIdentifier: variant.iosBundleIdentifier,
    appleTeamId: "838JVGY7W4",
    entitlements: {
      "aps-environment": variant.apnsEnvironment,
      "com.apple.security.application-groups": [appGroup],
      "keychain-access-groups": [`$(AppIdentifierPrefix)${variant.iosBundleIdentifier}`],
    },
    infoPlist: {
      GoogleClientID: variant.googleClientId,
      NotificationAppGroup: appGroup,
      APNsEnvironment: variant.apnsEnvironment,
      OtterTrustLocalMailServers: variant.trustLocalMailServers,
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      UIBackgroundModes: ["fetch"],
      BGTaskSchedulerPermittedIdentifiers: ["dev.otterware.mail.refresh"],
      ITSAppUsesNonExemptEncryption: false,
      LSApplicationCategoryType: "public.app-category.productivity",
    },
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: ACCESSED_APIS.map(([type, reasons]) => ({
        NSPrivacyAccessedAPIType: type,
        NSPrivacyAccessedAPITypeReasons: [...reasons],
      })),
    },
  },
  plugins: [
    [
      "expo-build-properties",
      {
        ios: {
          deploymentTarget: "26.0",
          // Expo's prebuilt modules drift from expo-modules-core pinned for React Native 0.88.0
          // (dyld: missing symbols at launch); build them from source.
          usePrecompiledModules: false,
          // otter-sqlite's Nitro autolinking is Swift; the SQLite pod needs a module map for it.
          extraPods: [{ name: "sqlite3", modular_headers: true }],
        },
      },
    ],
    ["expo-notifications", { mode: variant.apnsEnvironment }],
    ["expo-font", { fonts: ["./assets/fonts/InterVariable.ttf"] }],
    [
      "expo-splash-screen",
      { backgroundColor: CANVAS.light, dark: { backgroundColor: CANVAS.dark } },
    ],
    [
      "./plugins/withNotificationServiceExtension.cjs",
      {
        bundleIdentifier: `${variant.iosBundleIdentifier}.notifications`,
        appGroup,
        googleClientId: variant.googleClientId,
        teamId: "838JVGY7W4",
        // The Release iPhone workflow: manual signing with the App Store profiles.
        releaseSigning:
          process.env.OTTER_MAIL_RELEASE_SIGNING === "1"
            ? {
                app: "Otter Mail App Store",
                extension: "Otter Mail Notifications App Store",
              }
            : undefined,
      },
    ],
  ],
  extra: {
    appVariant: APP_VARIANT,
    // `OTTER_MAIL_RELAY_URL=http://localhost:8787` for `pnpm dev`'s relay; production otherwise.
    relayUrl: process.env.OTTER_MAIL_RELAY_URL?.trim() || "https://relay.mail.otterware.app",
    // `OTTER_MAIL_FAKE_MAILBOX=1`: apps/web's made-up mailbox, no account at all.
    fakeMailbox: process.env.OTTER_MAIL_FAKE_MAILBOX === "1",
    // `OTTER_MAIL_AGENT_SERVER_URL=http://localhost:5833/api/agent`: `pnpm dev:fake`'s agent server.
    agentServerUrl: process.env.OTTER_MAIL_AGENT_SERVER_URL?.trim() || undefined,
  },
};

export default config;
