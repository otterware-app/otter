const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { getBundleModeMetroConfig } = require("react-native-worklets/bundleMode");

/** @type {import("expo/metro-config").MetroConfig} */
const config = getDefaultConfig(__dirname);
const workspaceRoot = path.resolve(__dirname, "../..");
const escapedWorkspaceRoot = workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];
config.resolver = {
  ...config.resolver,
  // Core imports with `.js` suffixes (NodeNext); the files are `.ts`.
  sourceExts: [...new Set([...(config.resolver?.sourceExts ?? []), "ts", "tsx"])],
  unstable_enablePackageExports: true,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList)
      ? config.resolver.blockList
      : config.resolver?.blockList
        ? [config.resolver.blockList]
        : []),
    new RegExp(
      `${escapedWorkspaceRoot}[/\\\\](\\.otter-mail|apps[/\\\\](desktop|ios)|release)[/\\\\].*`,
    ),
  ],
};

const resolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest;
  if (moduleName.endsWith(".js") && (moduleName.startsWith(".") || moduleName.startsWith("/"))) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, ".ts"), platform);
    } catch {
      // Not a TypeScript source: resolve it as written.
    }
  }
  return resolve(context, moduleName, platform);
};

module.exports = getBundleModeMetroConfig(config);
