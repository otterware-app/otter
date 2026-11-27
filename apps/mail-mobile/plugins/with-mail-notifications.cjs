const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");

const releaseProfiles = {
  "dev.otterware.mail": "Otter Mail App Store",
  "dev.otterware.mail.notifications": "Otter Mail Notifications App Store",
};

module.exports = (config) => {
  const ios = config.ios;
  const topic = ios.bundleIdentifier;
  const group = `group.${topic}.notifications`;
  const environment = topic.endsWith(".dev") ? "development" : "production";

  ios.entitlements = {
    ...ios.entitlements,
    "aps-environment": environment,
    "com.apple.developer.usernotifications.communication": true,
    "com.apple.security.application-groups": [
      ...new Set([...(ios.entitlements?.["com.apple.security.application-groups"] ?? []), group]),
    ],
    "keychain-access-groups": ["$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)"],
  };
  ios.infoPlist = {
    ...ios.infoPlist,
    APNsEnvironment: environment,
    NotificationAppGroup: group,
    UIBackgroundModes: [
      ...new Set([...(ios.infoPlist?.UIBackgroundModes ?? []), "remote-notification"]),
    ],
    NSUserActivityTypes: [
      ...new Set([...(ios.infoPlist?.NSUserActivityTypes ?? []), "INSendMessageIntent"]),
    ],
  };

  return withXcodeProjectBeta(config, (mod) => {
    const targets = mod.modResults.rootObject.props.targets;
    const target = targets.find((target) => target.props.name === "OtterMailNotificationService");
    if (!target) throw new Error("The Otter Mail notification service target is missing.");
    for (const configuration of target.props.buildConfigurationList.props.buildConfigurations) {
      const settings = configuration.props.buildSettings;
      settings.OTTER_MAIL_NOTIFICATION_GROUP = group;
      settings.GOOGLE_IOS_CLIENT_ID = ios.infoPlist.GoogleClientID;
    }
    if (process.env.OTTER_MAIL_RELEASE_BUILD) {
      const signed = new Set();
      for (const nativeTarget of targets) {
        for (const configuration of nativeTarget.props.buildConfigurationList.props
          .buildConfigurations) {
          const { name, buildSettings } = configuration.props;
          const bundle = buildSettings.PRODUCT_BUNDLE_IDENTIFIER;
          const profile = releaseProfiles[bundle];
          if (name !== "Release" || !profile) continue;
          buildSettings.CODE_SIGN_STYLE = "Manual";
          buildSettings.CODE_SIGN_IDENTITY = "Apple Distribution";
          buildSettings.PROVISIONING_PROFILE_SPECIFIER = profile;
          signed.add(bundle);
        }
      }
      if (signed.size !== Object.keys(releaseProfiles).length) {
        throw new Error("Expected release signing for Otter Mail and its notification extension.");
      }
    }
    return mod;
  });
};
