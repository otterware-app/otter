import ExpoModulesCore

public final class OtterAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    DispatchQueue.global(qos: .utility).async(execute: removeSwiftAppCaches)
    return true
  }
}

/**
 * What the Swift app kept that this one never reads: its mail snapshots
 * (JSON files in Application Support/mail; core's cache is under OtterMail)
 * and its sender photos. Its draft-recovery/ copies stay: they become drafts.
 */
private func removeSwiftAppCaches() {
  let files = FileManager.default
  let mail = URL.applicationSupportDirectory.appending(path: "mail", directoryHint: .isDirectory)
  if let snapshots = try? files.contentsOfDirectory(at: mail, includingPropertiesForKeys: nil) {
    for snapshot in snapshots where snapshot.pathExtension == "json" {
      try? files.removeItem(at: snapshot)
    }
    if (try? files.contentsOfDirectory(atPath: mail.path))?.isEmpty == true {
      try? files.removeItem(at: mail)
    }
  }
  try? files.removeItem(at: URL.cachesDirectory.appending(path: "sender-photos", directoryHint: .isDirectory))
}

public final class OtterAppModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterApp")

    Constants {
      let info = Bundle.main.infoDictionary ?? [:]
      return [
        "version": info["CFBundleShortVersionString"] as? String ?? "0",
        "build": info["CFBundleVersion"] as? String ?? "0",
      ]
    }
  }
}
