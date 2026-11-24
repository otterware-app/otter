import CryptoKit
import ExpoModulesCore
import Foundation
import NaturalLanguage
import SwiftUI
@preconcurrency import Translation

/** What the phone apps' JavaScript needs of iOS that Expo's packages don't give it. */
public class OtterMobileModule: Module {
  @MainActor private static let signIn = OAuthSignIn()
  private let mailSockets = MailSockets()

  public func definition() -> ModuleDefinition {
    Name("OtterMobile")

    ExpoSwiftUI.ViewDefinition(MailTranslationView.self, name: "MailTranslationView", elements: [])

    AsyncFunction("keychainGet") { (service: String, name: String) in
      try Keychain.get(service: service, name: name)
    }
    AsyncFunction("keychainSet") { (service: String, name: String, value: String) in
      try Keychain.set(service: service, name: name, value: value)
    }
    AsyncFunction("keychainDelete") { (service: String, name: String) in
      try Keychain.delete(service: service, name: name)
    }

    AsyncFunction("googleIdToken") { () async throws -> String? in
      do {
        return try await Self.signIn.perform(
          .google(scopes: ["openid", "email", "profile"], options: ["prompt": "select_account"])
        ) { form in
          guard let response = try? await GoogleCredentials.request(form), let token = response.id_token else {
            throw OAuthSignIn.Failure.message("Couldn't reach Google to complete sign-in. Try again.")
          }
          return token
        }
      } catch OAuthSignIn.Failure.cancelled {
        return nil
      }
    }
    AsyncFunction("cancelGoogleSignIn") {
      await Self.signIn.cancel()
    }

    AsyncFunction("mailSignedInAddresses") { (provider: String) in
      try Self.mailAuth(provider).signedInAddresses()
    }
    AsyncFunction("mailSignIn") { (provider: String, loginHint: String?) async throws -> [String: String]? in
      do {
        return try await Self.mailAuth(provider).signIn(browser: Self.signIn, loginHint: loginHint)
      } catch OAuthSignIn.Failure.cancelled {
        return nil
      }
    }
    AsyncFunction("mailToken") { (provider: String, email: String, id: Bool, force: Bool) in
      try await Self.mailAuth(provider).token(email, id: id, force: force)
    }
    AsyncFunction("mailForget") { (provider: String, email: String) in
      try await Self.mailAuth(provider).forget(email)
    }

    Function("mailPushConfig") { () -> [String: String]? in
      guard let topic = Bundle.main.bundleIdentifier,
        let environment = Bundle.main.object(forInfoDictionaryKey: "APNsEnvironment") as? String,
        Bundle.main.object(forInfoDictionaryKey: "NotificationAppGroup") is String else { return nil }
      return ["topic": topic, "environment": environment == "development" ? "sandbox" : "production"]
    }

    AsyncFunction("writeMailPushConfiguration") { (configuration: String?) throws in
      guard let group = Bundle.main.object(forInfoDictionaryKey: "NotificationAppGroup") as? String,
        let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
        throw CocoaError(.fileNoSuchFile)
      }
      let directory = container.appending(path: "Notifications", directoryHint: .isDirectory)
      let location = directory.appending(path: "configuration.json")
      guard let configuration else {
        if FileManager.default.fileExists(atPath: location.path) {
          try FileManager.default.removeItem(at: location)
        }
        return
      }
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      try Data(configuration.utf8).write(to: location, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    AsyncFunction("mailSocketOpen") { (host: String, port: Int, tls: Bool) in
      try await self.mailSockets.open(host: host, port: port, tls: tls)
    }
    AsyncFunction("mailSocketRead") { (id: String) in
      try await self.mailSockets.read(id)
    }
    AsyncFunction("mailSocketWrite") { (id: String, base64: String) in
      try await self.mailSockets.write(id, base64: base64)
    }
    AsyncFunction("mailSocketStartTls") { (id: String) in
      try await self.mailSockets.startTLS(id)
    }
    Function("mailSocketClose") { (id: String) in
      self.mailSockets.close(id)
    }
    OnDestroy { [weak self] in
      self?.mailSockets.closeAll()
      Task { @MainActor in Self.signIn.cancel() }
    }

    AsyncFunction("existingMailDrafts") { (userId: String) -> [String] in
      guard !userId.isEmpty else { return [] }
      let key = Data(userId.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
      let directory = URL.applicationSupportDirectory.appending(path: "draft-recovery").appending(path: key)
      let entries = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
      return entries.filter { $0.pathExtension == "json" }.compactMap { try? String(contentsOf: $0, encoding: .utf8) }
    }

    AsyncFunction("existingMailDraftAttachment") { (folder: String, filename: String) throws -> String in
      guard UUID(uuidString: folder) != nil, !filename.isEmpty, filename != ".", filename != "..",
        filename == (filename as NSString).lastPathComponent else { throw CocoaError(.fileReadInvalidFileName) }
      let file = URL.applicationSupportDirectory.appending(path: "draft-files").appending(path: folder).appending(path: filename)
      let properties = try file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
      guard properties.isRegularFile == true, let size = properties.fileSize, size <= 25 * 1024 * 1024 else {
        throw CocoaError(.fileReadTooLarge)
      }
      return try Data(contentsOf: file).base64EncodedString()
    }

    Function("existingMailSettings") { () -> [String: Any] in
      guard Bundle.main.bundleIdentifier == "dev.otterware.mail" else { return [:] }
      let defaults = UserDefaults.standard
      var saved: [String: Any] = [:]
      for key in ["otter:user", "otter:mailboxes", "otter:addresses"] {
        if let data = defaults.data(forKey: key) {
          saved[key] = String(data: data, encoding: .utf8)
        }
      }
      let uiKeys = [
        "otter:theme-source", "otter:group-messages-by-day", "otter:full-width-rows",
        "otter:full-width-messages", "gmail:advance-direction", "mail:mailboxes", "mail:alias-mail-apart",
      ]
      saved["ui"] = Dictionary(uniqueKeysWithValues: uiKeys.compactMap { key in
        defaults.string(forKey: key).map { (key, $0) }
      })
      var sync: [String: Any] = [:]
      if let mode = defaults.string(forKey: "settings.notificationsMode"), ["off", "inbox", "all"].contains(mode) {
        sync["notificationsMode"] = mode
      }
      sync["readLanguages"] = defaults.stringArray(forKey: "settings.readLanguages")
      sync["autoTranslate"] = defaults.object(forKey: "settings.autoTranslate") as? Bool
      saved["sync"] = sync
      return saved
    }

    AsyncFunction("makeAgentPicture") { (uri: String, maxLength: Int) throws -> String in
      guard let file = URL(string: uri), file.isFileURL,
            let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
        throw AgentPicture.Failure(message: "Couldn't read that image. Choose a PNG, JPEG or WebP.")
      }
      return try AgentPicture.make(from: data, maxLength: maxLength)
    }

    // Ed25519 for Web Crypto's `subtle` (polyfills.ts), in base64, as OpenClaw's device key in the
    // Swift app.
    Function("ed25519Generate") { () -> [String: String] in
      let key = Curve25519.Signing.PrivateKey()
      return [
        "privateKey": key.rawRepresentation.base64EncodedString(),
        "publicKey": key.publicKey.rawRepresentation.base64EncodedString(),
      ]
    }
    AsyncFunction("ed25519Sign") { (privateKey: String, data: String) throws -> String in
      guard let raw = Data(base64Encoded: privateKey), let message = Data(base64Encoded: data) else {
        throw Exception(name: "DataError", description: "Not base64.")
      }
      return try Curve25519.Signing.PrivateKey(rawRepresentation: raw).signature(for: message).base64EncodedString()
    }

    Function("ed25519PublicKey") { (privateKey: String) -> String? in
      guard let raw = Data(base64Encoded: privateKey),
            let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) else { return nil }
      return key.publicKey.rawRepresentation.base64EncodedString()
    }
    AsyncFunction("existingAgentOutbox") { (user: String) -> String? in
      guard Bundle.main.bundleIdentifier == "dev.otterware.agents" else { return nil }
      let folder = Data(user.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
      let file = URL.applicationSupportDirectory.appending(path: "AgentSync/\(folder)/state.json")
      return try? String(contentsOf: file, encoding: .utf8)
    }
    Function("existingAgentSettings") { () -> [String: String] in
      guard Bundle.main.bundleIdentifier == "dev.otterware.agents" else { return [:] }
      let defaults = UserDefaults.standard
      var settings: [String: String] = [:]
      settings["deviceId"] = defaults.string(forKey: "agent-sync:device")
      if let user = defaults.data(forKey: "otter:user") {
        settings["user"] = String(data: user, encoding: .utf8)
      }
      if defaults.object(forKey: "otter:notifications") as? Bool == false {
        settings["notifications"] = "off"
      }
      return settings
    }

    // When the process started (ms since the epoch), to time a cold start from.
    Function("formatMailDate") { (timestamp: Double) -> String in
      Date(timeIntervalSince1970: timestamp / 1000).formatted(date: .abbreviated, time: .shortened)
    }

    Function("currentThreadCpuMs") { () -> Double in
      Double(clock_gettime_nsec_np(CLOCK_THREAD_CPUTIME_ID)) / 1_000_000
    }

    Function("launchedAt") { () -> Double in
      var info = kinfo_proc()
      var size = MemoryLayout<kinfo_proc>.stride
      var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
      guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return 0 }
      let start = info.kp_proc.p_un.__p_starttime
      return Double(start.tv_sec) * 1000 + Double(start.tv_usec) / 1000
    }
  }

  private static func mailAuth(_ provider: String) throws -> MailAuth {
    guard let auth = MailAuth(rawValue: provider) else {
      throw Exception(name: "MailProvider", description: "Unknown mail provider.")
    }
    return auth
  }
}

private final class MailTranslationProps: ExpoSwiftUI.ViewProps {
  @Field var text = ""
  @Field var presented = false
  @Field var automatic = false
  @Field var languages: [String] = []
  var onDismiss = EventDispatcher()
  var onTranslated = EventDispatcher()
}

private struct MailTranslationView: ExpoSwiftUI.View, ExpoSwiftUI.WithHostingView {
  @ObservedObject var props: MailTranslationProps
  @State private var showing = false
  @State private var translation: TranslationSession.Configuration?

  var body: some View {
    Color.clear
      .translationPresentation(isPresented: $showing, text: props.text)
      .onChange(of: props.presented, initial: true) { _, value in showing = value }
      .onChange(of: showing) { _, value in
        if !value && props.presented { props.onDismiss([:]) }
      }
      .task(id: automaticRequest) {
        translation = nil
        guard let request = automaticRequest, !request.text.isEmpty else { return }
        let recognizer = NLLanguageRecognizer()
        recognizer.processString(String(request.text.prefix(4000)))
        let languages = request.languages.isEmpty
          ? Locale.preferredLanguages.map { Locale.Language(identifier: $0) }
          : request.languages.map { Locale.Language(identifier: $0) }
        guard let detected = recognizer.dominantLanguage?.rawValue,
          !languages.contains(where: { $0.languageCode?.identifier == detected }),
          let target = languages.first else { return }
        translation = .init(source: Locale.Language(identifier: detected), target: target)
      }
      .translationTask(translation) { session in
        guard let request = automaticRequest,
          let translated = try? await session.translate(request.text),
          !Task.isCancelled, request == automaticRequest else { return }
        props.onTranslated(["text": translated.targetText, "source": request.text, "languages": request.languages])
      }
      .accessibilityHidden(true)
  }

  private var automaticRequest: Request? {
    props.automatic ? Request(text: props.text, languages: props.languages) : nil
  }

  private struct Request: Equatable {
    var text: String
    var languages: [String]
  }
}
