const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");

const profiles = {
  "dev.otterware.agents": "Otter Agents App Store",
  "dev.otterware.agents.notifications": "Otter Agents Notifications App Store",
};

module.exports = (config) =>
  withXcodeProjectBeta(config, (mod) => {
    const signed = new Set();
    for (const target of mod.modResults.rootObject.props.targets) {
      for (const configuration of target.props.buildConfigurationList.props.buildConfigurations) {
        const { name, buildSettings } = configuration.props;
        if (name !== "Release") continue;
        const bundle = buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
        const profile = profiles[bundle];
        if (!profile) continue;
        buildSettings.CODE_SIGN_STYLE = "Manual";
        buildSettings.CODE_SIGN_IDENTITY = "Apple Distribution";
        buildSettings.PROVISIONING_PROFILE_SPECIFIER = profile;
        signed.add(bundle);
      }
    }
    if (signed.size !== Object.keys(profiles).length) {
      throw new Error("Expected release signing for Otter Agents and its notification extension.");
    }
    return mod;
  });
