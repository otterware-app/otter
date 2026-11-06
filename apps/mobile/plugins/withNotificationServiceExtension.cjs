const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod, withXcodeProject } = require("expo/config-plugins");

const TARGET = "OtterMailNotificationService";
const IOS_APP = path.resolve(__dirname, "../../ios");
const SOURCES = [
  path.join(IOS_APP, "OtterMailNotificationService/NotificationService.swift"),
  ...fs
    .readdirSync(path.join(IOS_APP, "NotificationShared"))
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => path.join(IOS_APP, "NotificationShared", name)),
  // The extension checks IMAP mailboxes itself, with the app's client (as apps/ios's target does).
  ...["MailDecoding", "ImapClient", "ImapParser", "MailSocket"].map((name) =>
    path.join(IOS_APP, "OtterMail/Imap", `${name}.swift`),
  ),
];
const INFO_PLIST = path.join(IOS_APP, "OtterMailNotificationService/Info.plist");
const ENTITLEMENTS = path.join(
  IOS_APP,
  "OtterMailNotificationService/NotificationService.entitlements",
);

/**
 * The iPhone app's notification service extension, from apps/ios unchanged:
 * its sources, Info.plist and entitlements are copied in at prebuild and
 * built as their own target, embedded in the app. It enriches verified
 * pushes with what the shared Keychain and App Group hold.
 */
function withNotificationServiceExtension(
  config,
  { bundleIdentifier, appGroup, googleClientId, teamId },
) {
  config = withDangerousMod(config, [
    "ios",
    (config) => {
      const directory = path.join(config.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(directory, { recursive: true });
      for (const file of [...SOURCES, INFO_PLIST, ENTITLEMENTS]) {
        fs.copyFileSync(file, path.join(directory, path.basename(file)));
      }
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    if (project.pbxTargetByName(TARGET)) return config;

    const objects = project.hash.project.objects;
    objects.PBXTargetDependency ??= {};
    objects.PBXContainerItemProxy ??= {};

    const files = [
      ...SOURCES.map((file) => path.basename(file)),
      "Info.plist",
      path.basename(ENTITLEMENTS),
    ];
    const group = project.addPbxGroup(files, TARGET, TARGET);
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroup);

    const target = project.addTarget(TARGET, "app_extension", TARGET, bundleIdentifier);
    project.addBuildPhase(
      SOURCES.map((file) => path.basename(file)),
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    project.addTargetDependency(project.getFirstTarget().uuid, [target.uuid]);

    const version = config.version ?? "1.0.0";
    for (const configuration of Object.values(project.pbxXCBuildConfigurationSection())) {
      if (
        typeof configuration !== "object" ||
        configuration.buildSettings?.PRODUCT_NAME !== `"${TARGET}"`
      )
        continue;
      Object.assign(configuration.buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: "YES",
        GENERATE_INFOPLIST_FILE: "YES",
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${path.basename(ENTITLEMENTS)}`,
        CODE_SIGN_STYLE: "Automatic",
        CURRENT_PROJECT_VERSION: "1",
        DEVELOPMENT_TEAM: teamId,
        GOOGLE_IOS_CLIENT_ID: googleClientId,
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: "26.0",
        MARKETING_VERSION: version,
        NOTIFICATION_APP_GROUP: appGroup,
        SWIFT_VERSION: "6.0",
        SWIFT_APPROACHABLE_CONCURRENCY: "YES",
        TARGETED_DEVICE_FAMILY: "1",
      });
    }
    return config;
  });
}

module.exports = withNotificationServiceExtension;
