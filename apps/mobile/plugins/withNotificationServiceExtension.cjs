const fs = require("node:fs");
const path = require("node:path");

const { withDangerousMod, withInfoPlist, withXcodeProject } = require("expo/config-plugins");

const TARGET = "OtterMailNotificationService";
const NATIVE = path.resolve(__dirname, "../native");
const swiftIn = (directory) =>
  fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => path.join(directory, name));
const SOURCES = [
  ...swiftIn(path.join(NATIVE, "NotificationService")),
  ...swiftIn(path.join(NATIVE, "NotificationShared")),
  // The extension checks IMAP mailboxes itself, with its own IMAP client.
  ...swiftIn(path.join(NATIVE, "NotificationService/Imap")),
];
const INFO_PLIST = path.join(NATIVE, "NotificationService/Info.plist");
const ENTITLEMENTS = path.join(NATIVE, "NotificationService/NotificationService.entitlements");

/** A target's build configurations, by name (Debug, Release). */
function configurationsOf(project, targetUuid) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const list = project.pbxXCConfigurationList()[target.buildConfigurationList];
  const section = project.pbxXCBuildConfigurationSection();
  return list.buildConfigurations.map(({ value }) => section[value]);
}

/**
 * The notification service extension (native/NotificationService, with
 * native/NotificationShared): its sources, Info.plist and entitlements are
 * copied in at prebuild and built as their own target, embedded in the app.
 * It enriches verified pushes with what the shared Keychain and App Group hold.
 *
 * Both targets take their versions from the build settings, so the release's
 * MARKETING_VERSION and CURRENT_PROJECT_VERSION (YYYYMMDDhhmm) reach both.
 *
 * `releaseSigning` (the release, `OTTER_MAIL_RELEASE_SIGNING=1`): each
 * target's Release configuration signs manually with its App Store profile,
 * so the Pods keep their own settings.
 */
function withNotificationServiceExtension(
  config,
  { bundleIdentifier, appGroup, googleClientId, teamId, releaseSigning },
) {
  config = withInfoPlist(config, (config) => {
    config.modResults.CFBundleShortVersionString = "$(MARKETING_VERSION)";
    config.modResults.CFBundleVersion = "$(CURRENT_PROJECT_VERSION)";
    return config;
  });

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
    const app = project.getFirstTarget().uuid;
    project.addTargetDependency(app, [target.uuid]);

    const versions = {
      CURRENT_PROJECT_VERSION: config.ios?.buildNumber ?? "1",
      MARKETING_VERSION: config.version ?? "1.0.0",
    };
    for (const configuration of configurationsOf(project, app)) {
      Object.assign(configuration.buildSettings, versions);
    }
    for (const configuration of configurationsOf(project, target.uuid)) {
      Object.assign(configuration.buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: "YES",
        GENERATE_INFOPLIST_FILE: "YES",
        CODE_SIGN_ENTITLEMENTS: `${TARGET}/${path.basename(ENTITLEMENTS)}`,
        CODE_SIGN_STYLE: "Automatic",
        ...versions,
        DEVELOPMENT_TEAM: teamId,
        GOOGLE_IOS_CLIENT_ID: googleClientId,
        INFOPLIST_FILE: `${TARGET}/Info.plist`,
        IPHONEOS_DEPLOYMENT_TARGET: "26.0",
        NOTIFICATION_APP_GROUP: appGroup,
        SWIFT_VERSION: "6.0",
        SWIFT_APPROACHABLE_CONCURRENCY: "YES",
        TARGETED_DEVICE_FAMILY: "1",
      });
    }
    if (releaseSigning) {
      for (const [uuid, profile] of [
        [app, releaseSigning.app],
        [target.uuid, releaseSigning.extension],
      ]) {
        const release = configurationsOf(project, uuid).find(({ name }) => name === "Release");
        Object.assign(release.buildSettings, {
          CODE_SIGN_STYLE: "Manual",
          CODE_SIGN_IDENTITY: `"Apple Distribution"`,
          '"CODE_SIGN_IDENTITY[sdk=iphoneos*]"': `"Apple Distribution"`,
          DEVELOPMENT_TEAM: teamId,
          PROVISIONING_PROFILE_SPECIFIER: `"${profile}"`,
        });
      }
    }
    return config;
  });
}

module.exports = withNotificationServiceExtension;
