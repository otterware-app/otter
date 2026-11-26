const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// @otter/shared reports through @sentry/core, a newer one than the React Native SDK's: Sentry keeps
// its client per version of @sentry/core, so the app takes the SDK's for both, or core's errors
// would go to a client that isn't there.
const sdk = require.resolve("@sentry/react-native");
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Otter Agents' expo-updates is in the workspace, so Sentry finds its JavaScript, whose native
  // module this app doesn't link: a release build would throw at launch.
  if (moduleName === "expo-updates") return { type: "empty" };
  const from =
    moduleName === "@sentry/core" || moduleName.startsWith("@sentry/core/")
      ? { ...context, originModulePath: sdk }
      : context;
  return (resolveRequest ?? context.resolveRequest)(from, moduleName, platform);
};

module.exports = config;
