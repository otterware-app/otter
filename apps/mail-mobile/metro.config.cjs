const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// @otter/shared reports through @sentry/core, a newer one than the React Native SDK's: Sentry keeps
// its client per version of @sentry/core, so the app takes the SDK's for both, or core's errors
// would go to a client that isn't there.
const sdk = require.resolve("@sentry/react-native");
const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Importing @expo/ui/swift-ui installs every Expo module on Reanimated's UI runtime, for SwiftUI
  // state driven from worklets, which the app doesn't use: about 170 ms of the JavaScript thread
  // while the first screen draws.
  if (
    moduleName === "./index.fx" &&
    /@expo[\\/]ui[\\/]\w+[\\/]State[\\/]/.test(context.originModulePath)
  )
    return { type: "empty" };
  const from =
    moduleName === "@sentry/core" || moduleName.startsWith("@sentry/core/")
      ? { ...context, originModulePath: sdk }
      : context;
  return (resolveRequest ?? context.resolveRequest)(from, moduleName, platform);
};

module.exports = config;
