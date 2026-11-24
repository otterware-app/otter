import CryptoKit
import ExpoModulesCore
import Foundation

/** What the phone apps' JavaScript needs of iOS that Expo's packages don't give it. */
public class OtterMobileModule: Module {
  @MainActor private static let google = GoogleSignIn()

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
        return try await Self.google.idToken()
      } catch GoogleSignIn.Failure.cancelled {
        return nil
      }
    }
    AsyncFunction("cancelGoogleSignIn") {
      await Self.google.cancel()
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
}
