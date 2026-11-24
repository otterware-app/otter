const { withXcodeProjectBeta } = require("@bacons/apple-targets/build/with-bacons-xcode");

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
    NSUserActivityTypes: [
      ...new Set([...(ios.infoPlist?.NSUserActivityTypes ?? []), "INSendMessageIntent"]),
    ],
  };

  return withXcodeProjectBeta(config, (mod) => {
    const target = mod.modResults.rootObject.props.targets.find(
      (target) => target.props.name === "OtterMailNotificationService",
    );
    if (!target) throw new Error("The Otter Mail notification service target is missing.");
    for (const configuration of target.props.buildConfigurationList.props.buildConfigurations) {
      const settings = configuration.props.buildSettings;
      settings.OTTER_MAIL_NOTIFICATION_GROUP = group;
      settings.GOOGLE_IOS_CLIENT_ID = ios.infoPlist.GoogleClientID;
    }
    return mod;
  });
};
