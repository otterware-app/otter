module.exports = (config) => ({
  type: "notification-service",
  name: "OtterAgentsNotificationService",
  bundleIdentifier: ".notifications",
  deploymentTarget: config.ios.deploymentTarget,
  frameworks: ["Intents", "UserNotifications"],
  entitlements: {
    "com.apple.security.application-groups":
      config.ios.entitlements["com.apple.security.application-groups"],
  },
});
