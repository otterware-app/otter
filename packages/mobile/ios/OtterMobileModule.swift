import CryptoKit
import ExpoModulesCore
import Foundation

/** What the phone apps' JavaScript needs of iOS that Expo's packages don't give it. */
public class OtterMobileModule: Module {
  @MainActor private static let signIn = OAuthSignIn()
  private let mailSockets = MailSockets()

  public func definition() -> ModuleDefinition {
    Name("OtterMobile")

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

    Function("existingMailSettings") { () -> [String: String] in
      guard Bundle.main.bundleIdentifier == "dev.otterware.mail" else { return [:] }
      let defaults = UserDefaults.standard
      let keys = ["otter:user", "otter:mailboxes", "otter:addresses"]
      return Dictionary(uniqueKeysWithValues: keys.compactMap { key in
        guard let data = defaults.data(forKey: key), let value = String(data: data, encoding: .utf8) else { return nil }
        return (key, value)
      })
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
