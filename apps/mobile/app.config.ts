import type { ExpoConfig } from "expo/config";

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

/**
 * Each variant is its own app: its bundle ID, Keychain access group and App
 * Group, so a development or preview build never reads production's sign-ins.
 */
const VARIANT_CONFIG = {
  development: {
    appName: "Otter Mail Dev",
    scheme: "ottermail-dev",
    iosBundleIdentifier: "dev.otterware.mail.dev",
    icon: fromRepoRoot("assets/dev/blueprint-ios-1024.png"),
    googleClientId: GOOGLE_IOS_CLIENT_ID.development,
    apnsEnvironment: "development",
    trustLocalMailServers: true,
  },
  preview: {
    appName: "Otter Mail Preview",
    scheme: "ottermail-preview",
    iosBundleIdentifier: "dev.otterware.mail.preview",
    icon: fromRepoRoot("assets/prod/otter-mail-ios-1024.png"),
    googleClientId: GOOGLE_IOS_CLIENT_ID.development,
    apnsEnvironment: "production",
    trustLocalMailServers: false,
  },
  production: {
    appName: "Otter Mail",
    scheme: "ottermail",
    iosBundleIdentifier: "dev.otterware.mail",
    icon: fromRepoRoot("assets/prod/otter-mail-ios-1024.png"),
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
  scheme: variant.scheme,
  version: process.env.OTTER_MAIL_MOBILE_VERSION ?? "0.9.0",
  runtimeVersion: { policy: runtimeVersionPolicy as "appVersion" | "fingerprint" },
  orientation: "portrait",
  icon: variant.icon,
  userInterfaceStyle: "automatic",
  ios: {
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
    [
      "./plugins/withNotificationServiceExtension.cjs",
      {
        bundleIdentifier: `${variant.iosBundleIdentifier}.notifications`,
        appGroup,
        googleClientId: variant.googleClientId,
        teamId: "838JVGY7W4",
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
