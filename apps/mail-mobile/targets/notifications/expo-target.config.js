module.exports = (config) => ({
  type: "notification-service",
  name: "OtterMailNotificationService",
  bundleIdentifier: ".notifications",
  deploymentTarget: config.ios.deploymentTarget,
  frameworks: ["Intents", "UserNotifications"],
  entitlements: {
    "com.apple.security.application-groups": [config.ios.infoPlist.NotificationAppGroup],
    "keychain-access-groups": ["$(AppIdentifierPrefix)$(PRODUCT_BUNDLE_IDENTIFIER)"],
  },
});
