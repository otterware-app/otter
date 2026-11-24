const fs = require("node:fs");
const path = require("node:path");
const { IOSConfig, withDangerousMod } = require("expo/config-plugins");

module.exports = function withAgentNotifications(config) {
  const ios = (config.ios ??= {});
  const topic = ios.bundleIdentifier;
  const environment = topic.endsWith(".dev") ? "development" : "production";
  ios.entitlements = {
    ...ios.entitlements,
    "aps-environment": environment,
    "com.apple.developer.usernotifications.communication": true,
    "com.apple.security.application-groups": [
      ...new Set([
        ...(ios.entitlements?.["com.apple.security.application-groups"] ?? []),
        `group.${topic}`,
      ]),
    ],
  };
  ios.infoPlist = {
    ...ios.infoPlist,
    APNsEnvironment: environment,
    NotificationAppGroup: `group.${topic}`,
    NSUserActivityTypes: [
      ...new Set([...(ios.infoPlist?.NSUserActivityTypes ?? []), "INSendMessageIntent"]),
    ],
    UIBackgroundModes: [
      ...new Set([...(ios.infoPlist?.UIBackgroundModes ?? []), "remote-notification"]),
    ],
  };
  return withDangerousMod(config, [
    "ios",
    (config) => {
      const { projectRoot } = config.modRequest;
      const images = path.join(IOSConfig.Paths.getSourceRoot(projectRoot), "Images.xcassets");
      const assets = path.join(projectRoot, "assets");
      for (const mark of ["AgentOpenClaw", "AgentHermes", "AgentVarys"]) {
        const name = `${mark}.imageset`;
        fs.cpSync(path.join(assets, name), path.join(images, name), { recursive: true });
      }
      return config;
    },
  ]);
};
