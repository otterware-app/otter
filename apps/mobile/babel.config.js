module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true, worklets: false }]],
    plugins: [
      [
        "react-native-worklets/plugin",
        {
          // Worker runtimes evaluate this same bundle, so core runs there as ordinary modules;
          // a worklet in apps/mobile/src reaches its imports there instead of capturing them.
          bundleMode: true,
          importForwarding: { relativePaths: ["apps/mobile/src"] },
        },
      ],
    ],
  };
};
