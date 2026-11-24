import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/**
 * Who you are, for the Otter account: Google's ID token, with the app's iOS OAuth client
 * (no secret; PKCE; Google returns to the client ID's reversed form). No mail scope and nothing
 * kept: the relay's session is what stays.
 */
@MainActor
final class GoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: LocalizedError {
        case cancelled
        case google(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: "Sign-in was cancelled."
            case .google(let message): message
            }
        }
    }

    private static let clientID = Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String ?? ""
    private static var scheme: String { clientID.split(separator: ".").reversed().joined(separator: ".") }
    private static var redirectURI: String { "\(scheme):/oauth2redirect" }

    private var task: Task<String, Error>?
    private var session: ASWebAuthenticationSession?
    private var browser: (state: String, result: CheckedContinuation<URL, Error>)?
    private var window: UIWindow?

    func idToken() async throws -> String {
        guard task == nil else { throw Failure.google("Google sign-in is already open.") }
        let attempt = Task { try await authenticate() }
        task = attempt
        defer { task = nil }
        do { return try await attempt.value }
        catch {
            if attempt.isCancelled { throw Failure.cancelled }
            throw error
        }
    }

    func cancel() {
        task?.cancel()
        session?.cancel()
        if let browser { finishBrowser(browser.state, .failure(Failure.cancelled)) }
    }

    private func authenticate() async throws -> String {
        try Task.checkCancellation()
        guard !Self.clientID.isEmpty else { throw Failure.google("Google sign-in isn't configured for this build.") }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = scenes.first(where: { $0.activationState == .foregroundActive })?.keyWindow else {
            throw Failure.google("Open Otter to sign in with Google.")
        }
        self.window = window
        defer { self.window = nil }

        let verifier = try Self.random(32)
        let state = try Self.random(16)
        var components = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        components.queryItems = [
            .init(name: "client_id", value: Self.clientID),
            .init(name: "redirect_uri", value: Self.redirectURI),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: "openid email profile"),
            .init(name: "code_challenge", value: Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "prompt", value: "select_account"),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            browser = (state, continuation)
            let session = ASWebAuthenticationSession(url: components.url!, callback: .customScheme(Self.scheme)) { [weak self] url, error in
                let result: Result<URL, Error>
                if let url {
                    result = .success(url)
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    result = .failure(Failure.cancelled)
                } else {
                    result = .failure(Failure.google(error?.localizedDescription ?? "Sign-in failed."))
                }
                Task { @MainActor in self?.finishBrowser(state, result) }
            }
            self.session = session
            session.presentationContextProvider = self
            if !session.start() {
                finishBrowser(state, .failure(Failure.google("Couldn't open Google sign-in.")))
            }
        }
        try Task.checkCancellation()
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in query.first { $0.name == name }?.value }
        guard value("state") == state else { throw Failure.google("Google sign-in didn't finish.") }
        if value("error") == "access_denied" { throw Failure.cancelled }
        guard let code = value("code") else {
            throw Failure.google(value("error") ?? "Google sign-in didn't finish.")
        }
        var request = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        let form = ["grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                    "redirect_uri": Self.redirectURI, "client_id": Self.clientID]
        request.httpBody = Data(form.map { "\($0)=\($1.addingPercentEncoding(withAllowedCharacters: allowed) ?? $1)" }.joined(separator: "&").utf8)
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let token = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["id_token"] as? String
        else { throw Failure.google("Couldn't reach Google to complete sign-in. Try again.") }
        try Task.checkCancellation()
        return token
    }

    private func finishBrowser(_ state: String, _ result: Result<URL, Error>) {
        guard let browser, browser.state == state else { return }
        self.browser = nil
        session = nil
        browser.result.resume(with: result)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        precondition(window != nil)
        return window!
    }

    private static func random(_ count: Int) throws -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        guard SecRandomCopyBytes(kSecRandomDefault, count, &bytes) == errSecSuccess else {
            throw Failure.google("Couldn't start a secure Google sign-in.")
        }
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
