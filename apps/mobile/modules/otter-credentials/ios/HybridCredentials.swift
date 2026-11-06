import Foundation
import NitroModules

/**
 * apps/ios's Keychain, Google and Microsoft credentials and PushState (linked
 * from NotificationShared, the notification extension's own copy), as the
 * app's one credential authority. Refresh tokens stay in the Keychain.
 */
final class HybridCredentials: HybridCredentialsSpec, @unchecked Sendable {
  var appGroup: String { PushState.group }

  func getSecret(name: String) throws -> String? { Keychain.get(name) }

  func setSecret(name: String, value: String) throws {
    guard Keychain.set(name, value) else { throw RuntimeError.error(withMessage: "The Keychain refused \(name).") }
  }

  func deleteSecret(name: String) throws { Keychain.set(name, nil) }

  func hasGoogle(email: String) throws -> Bool { GoogleCredentials.credential(email) != nil }

  func googleAccessToken(email: String, force: Bool) throws -> Promise<AccessToken> {
    Promise.async {
      do {
        let tokens = try await GoogleCredentials.refresh(email, force: force)
        return AccessToken(
          accessToken: tokens.accessToken, idToken: tokens.idToken, expiresAt: tokens.expiresAt.timeIntervalSince1970 * 1000)
      } catch GoogleCredentials.Failure.revoked {
        throw RuntimeError.error(withMessage: "signed-out")
      }
    }
  }

  func forgetGoogle(email: String) throws { GoogleCredentials.forget(email) }

  func hasMicrosoft(email: String) throws -> Bool { Keychain.get(MicrosoftCredentials.refreshKey(email)) != nil }

  func microsoftAccessToken(email: String, force: Bool) throws -> Promise<AccessToken> {
    Promise.async {
      do {
        let tokens = try await MicrosoftCredentials.refresh(email, force: force)
        return AccessToken(
          accessToken: tokens.accessToken, idToken: tokens.idToken, expiresAt: tokens.expiresAt.timeIntervalSince1970 * 1000)
      } catch MicrosoftCredentials.Failure.revoked {
        throw RuntimeError.error(withMessage: "signed-out")
      }
    }
  }

  func forgetMicrosoft(email: String) throws { MicrosoftCredentials.forget(email) }

  func pushConfiguration() throws -> String? {
    guard let configuration = PushState.configuration(), let data = try? JSONEncoder().encode(configuration) else { return nil }
    return String(data: data, encoding: .utf8)
  }

  func configurePush(json: String?) throws {
    guard let json else { return PushState.configure(nil) }
    let configuration = try JSONDecoder().decode(PushState.Configuration.self, from: Data(json.utf8))
    PushState.configure(configuration)
  }
}
