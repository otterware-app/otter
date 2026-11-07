const crypto = require("node:crypto");
const fs = require("node:fs");
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
// Extensions' `./mobile` halves reach the app only through its kit (as the web's alias).
const extensionKit = path.join(__dirname, "src/extensions/kit.tsx");
const appEntry = path.join(__dirname, "index.ts");
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = resolveRequest ?? context.resolveRequest;
  if (moduleName === "@otter-mail/mobile/extension-kit")
    return resolve(context, extensionKit, platform);
  // One React Native, the app's, for every importer (extensions declare it for types only).
  if (moduleName === "react-native" || moduleName.startsWith("react-native/")) {
    return resolve({ ...context, originModulePath: appEntry }, moduleName, platform);
  }
  if (moduleName.endsWith(".js") && (moduleName.startsWith(".") || moduleName.startsWith("/"))) {
    try {
      return resolve(context, moduleName.replace(/\.js$/, ".ts"), platform);
    } catch {
      // Not a TypeScript source: resolve it as written.
    }
  }
  return resolve(context, moduleName, platform);
};

// Bundle Mode's Babel plugin writes each worklet to react-native-worklets/.worklets/<hash>.js
// while Metro transforms, so the file isn't in Metro's file map yet when Metro asks for its
// SHA-1 ("Failed to get the SHA-1"): the first bundle of a fresh checkout, and Fast Refresh
// after editing a worklet. Hash those files from disk until the watcher catches up.
// Expo's CLI runs the Metro of `@expo/metro`, which can differ from the one `metro` resolves to.
const expoCli = path.dirname(
  require.resolve("@expo/cli/package.json", {
    paths: [path.dirname(require.resolve("expo/package.json"))],
  }),
);
const { default: DependencyGraph } = require(
  require.resolve("@expo/metro/metro/node-haste/DependencyGraph", { paths: [expoCli] }),
);
const getOrComputeSha1 = DependencyGraph.prototype.getOrComputeSha1;
DependencyGraph.prototype.getOrComputeSha1 = async function (filePath) {
  try {
    return await getOrComputeSha1.call(this, filePath);
  } catch (error) {
    if (!/[/\\]\.worklets[/\\]/.test(filePath) || !fs.existsSync(filePath)) throw error;
    const content = fs.readFileSync(filePath);
    return { sha1: crypto.createHash("sha1").update(content).digest("hex"), content };
  }
};

module.exports = getBundleModeMetroConfig(config);
