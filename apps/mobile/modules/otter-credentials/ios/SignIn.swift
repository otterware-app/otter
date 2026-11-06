import AuthenticationServices
import CryptoKit
import Foundation
import NitroModules
import UIKit

/**
 * The Swift app's GoogleAuth and MicrosoftAuth sign-ins: authorization code with
 * PKCE in a browser sheet, public clients (no secret). The refresh token is
 * saved to the Keychain here and never returned; callers get the profile.
 */
enum SignIn {
  static let googleScopes = [
    "https://mail.google.com/",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "openid", "email", "profile",
  ]

  struct Profile { var email: String; var name: String?; var picture: String? }

  enum Failure: LocalizedError {
    case cancelled
    case failed(String)
    var errorDescription: String? {
      switch self {
      case .cancelled: "cancelled"
      case .failed(let message): message
      }
    }
  }

  @MainActor private static let presenter = Presenter()

  @MainActor static func cancel() { presenter.cancel() }

  // MARK: Google

  private static var googleRedirectScheme: String {
    GoogleCredentials.clientID.split(separator: ".").reversed().joined(separator: ".")
  }
  private static var googleRedirectURI: String { "\(googleRedirectScheme):/oauth2redirect" }

  /** `scopes` decides what it's for: a mailbox (kept) or the Otter account (an ID token, nothing kept). */
  private static func googleCode(loginHint: String?, scopes: [String], offline: Bool) async throws -> (code: String, verifier: String) {
    let verifier = randomURLSafe(32)
    let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = randomURLSafe(16)
    var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
    components.queryItems = [
      .init(name: "client_id", value: GoogleCredentials.clientID),
      .init(name: "redirect_uri", value: googleRedirectURI),
      .init(name: "response_type", value: "code"),
      .init(name: "scope", value: scopes.joined(separator: " ")),
      .init(name: "code_challenge", value: challenge),
      .init(name: "code_challenge_method", value: "S256"),
      .init(name: "state", value: state),
    ] + (offline ? [.init(name: "access_type", value: "offline"), .init(name: "prompt", value: "consent select_account")]
                 : [.init(name: "prompt", value: "select_account")])
      + (loginHint.map { [.init(name: "login_hint", value: $0)] } ?? [])
    let callback = try await presenter.authenticate(url: components.url!, scheme: googleRedirectScheme)
    let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let value = { (name: String) in query.first { $0.name == name }?.value }
    if value("error") == "access_denied" { throw Failure.cancelled }
    guard value("state") == state, let code = value("code") else {
      throw Failure.failed(value("error") ?? "Google sign-in didn't finish.")
    }
    return (code, verifier)
  }

  private static func googleTokens(_ code: String, _ verifier: String) async throws -> GoogleCredentials.Response {
    do {
      return try await GoogleCredentials.request([
        "grant_type": "authorization_code", "code": code, "code_verifier": verifier,
        "redirect_uri": googleRedirectURI,
      ])
    } catch {
      throw Failure.failed("Couldn't reach Google to complete sign-in. Try again.")
    }
  }

  static func google(loginHint: String?) async throws -> Profile {
    let (code, verifier) = try await googleCode(loginHint: loginHint, scopes: googleScopes, offline: true)
    let response = try await googleTokens(code, verifier)
    guard let refreshToken = response.refresh_token else {
      throw Failure.failed("Google did not return a refresh token. Try again.")
    }
    let profile = try await googleProfile(accessToken: response.tokens.accessToken)
    try await PushState.locked("oauth:" + profile.email) {
      guard GoogleCredentials.save(profile.email, credential: .init(refreshToken: refreshToken, clientID: GoogleCredentials.clientID)) else {
        throw Failure.failed("Couldn't save the Google sign-in on this iPhone.")
      }
    }
    return profile
  }

  static func googleIdToken() async throws -> String {
    let (code, verifier) = try await googleCode(loginHint: nil, scopes: ["openid", "email", "profile"], offline: false)
    guard let idToken = try await googleTokens(code, verifier).id_token else {
      throw Failure.failed("Google didn't return an ID token.")
    }
    return idToken
  }

  private static func googleProfile(accessToken: String) async throws -> Profile {
    struct Body: Decodable { var email: String; var name: String?; var picture: String? }
    var request = URLRequest(url: URL(string: "https://www.googleapis.com/oauth2/v3/userinfo")!)
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, let body = try? JSONDecoder().decode(Body.self, from: data) else {
      throw Failure.failed("Couldn't read the Google profile.")
    }
    return Profile(email: body.email.lowercased(), name: body.name, picture: body.picture)
  }

  // MARK: Microsoft

  private static var microsoftRedirectScheme: String { "msauth.\(Bundle.main.bundleIdentifier ?? "dev.otterware.mail")" }
  private static var microsoftRedirectURI: String { "\(microsoftRedirectScheme)://auth" }

  static func microsoft(loginHint: String?) async throws -> Profile {
    let verifier = randomURLSafe(32)
    let challenge = base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    let state = randomURLSafe(16)
    var components = URLComponents(string: "\(MicrosoftCredentials.authority)/authorize")!
    components.queryItems = [
      .init(name: "client_id", value: MicrosoftCredentials.clientID),
      .init(name: "redirect_uri", value: microsoftRedirectURI),
      .init(name: "response_type", value: "code"),
      .init(name: "response_mode", value: "query"),
      .init(name: "scope", value: MicrosoftCredentials.scopes.joined(separator: " ")),
      .init(name: "code_challenge", value: challenge),
      .init(name: "code_challenge_method", value: "S256"),
      .init(name: "state", value: state),
      .init(name: "prompt", value: "select_account"),
    ] + (loginHint.map { [.init(name: "login_hint", value: $0)] } ?? [])
    let callback = try await presenter.authenticate(url: components.url!, scheme: microsoftRedirectScheme)
    let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    let value = { (name: String) in query.first { $0.name == name }?.value }
    if value("error") == "access_denied" { throw Failure.cancelled }
    guard value("state") == state, let code = value("code") else {
      throw Failure.failed(value("error_description") ?? "Microsoft sign-in didn't finish.")
    }
    let response: MicrosoftCredentials.Response
    do {
      response = try await MicrosoftCredentials.request([
        "grant_type": "authorization_code", "code": code, "code_verifier": verifier,
        "redirect_uri": microsoftRedirectURI,
      ])
    } catch {
      throw Failure.failed("Couldn't reach Microsoft to complete sign-in. Try again.")
    }
    guard let refreshToken = response.refresh_token else {
      throw Failure.failed("Microsoft did not return a refresh token. Try again.")
    }
    let profile = try await microsoftProfile(accessToken: response.tokens.accessToken)
    do { try await MicrosoftCredentials.save(profile.email, refreshToken: refreshToken) } catch {
      throw Failure.failed("Couldn't save the Microsoft sign-in on this iPhone.")
    }
    return profile
  }

  private static func microsoftProfile(accessToken: String) async throws -> Profile {
    struct Me: Decodable { var mail: String?; var userPrincipalName: String?; var displayName: String? }
    var request = URLRequest(url: URL(string: "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName")!)
    request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200, let me = try? JSONDecoder().decode(Me.self, from: data),
          let email = [me.mail, me.userPrincipalName].compactMap({ $0 }).first(where: { $0.contains("@") }) else {
      throw Failure.failed("Couldn't read the Microsoft account's address.")
    }
    let name = me.displayName?.trimmingCharacters(in: .whitespaces)
    return Profile(email: email.lowercased(), name: name?.isEmpty == false ? name : nil)
  }

  // MARK: Helpers

  private static func randomURLSafe(_ count: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: count)
    _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
    return base64URL(Data(bytes))
  }

  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  @MainActor private final class Presenter: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var session: ASWebAuthenticationSession?

    func authenticate(url: URL, scheme: String) async throws -> URL {
      try await withCheckedThrowingContinuation { continuation in
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme)) { url, error in
          if let url { return continuation.resume(returning: url) }
          let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
          continuation.resume(throwing: cancelled ? Failure.cancelled : Failure.failed(error?.localizedDescription ?? "Sign-in failed."))
        }
        session.presentationContextProvider = self
        self.session = session
        session.start()
      }
    }

    func cancel() { session?.cancel() }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
      let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor(windowScene: scenes[0])
    }
  }
}
