import CryptoKit
import ExpoModulesCore

/** What the phone apps' JavaScript needs of iOS that Expo's packages don't give it. */
public class OtterMobileModule: Module {
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
