const { IOSConfig, withInfoPlist } = require("expo/config-plugins");

module.exports = function withMailAuth(config) {
  const bundleId = config.ios?.bundleIdentifier;
  const googleClientId = config.ios?.infoPlist?.GoogleClientID;
  if (!bundleId || !googleClientId) throw new Error("Otter Mail's OAuth clients are missing.");

  const schemes = [googleClientId.split(".").toReversed().join("."), `msauth.${bundleId}`];
  return withInfoPlist(config, (mod) => {
    for (const scheme of schemes) {
      if (!IOSConfig.Scheme.hasScheme(scheme, mod.modResults)) {
        mod.modResults = IOSConfig.Scheme.appendScheme(scheme, mod.modResults);
      }
    }
    return mod;
  });
};
