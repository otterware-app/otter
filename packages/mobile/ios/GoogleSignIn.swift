import AuthenticationServices
import CryptoKit
import Foundation
import Security
import UIKit

@MainActor
final class OAuthSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: LocalizedError {
        case cancelled
        case message(String)

        var errorDescription: String? {
            switch self {
            case .cancelled: "Sign-in was cancelled."
            case .message(let message): message
            }
        }
    }

    struct Request {
        let provider: String
        let endpoint: URL
        let clientID: String
        let scheme: String
        let redirect: String
        let scopes: [String]
        let options: [String: String]

        static func google(scopes: [String], options: [String: String]) -> Self {
            let clientID = GoogleCredentials.clientID
            let scheme = clientID.split(separator: ".").reversed().joined(separator: ".")
            return Self(provider: "Google", endpoint: URL(string: "https://accounts.google.com/o/oauth2/v2/auth")!,
                        clientID: clientID, scheme: scheme, redirect: "\(scheme):/oauth2redirect",
                        scopes: scopes, options: options)
        }
    }

    private var cancelTask: (() -> Void)?
    private var session: ASWebAuthenticationSession?
    private var browser: (state: String, result: CheckedContinuation<URL, Error>)?
    private var window: UIWindow?

    func perform<T>(
        _ request: Request, exchange: @escaping @MainActor ([String: String]) async throws -> T
    ) async throws -> T {
        guard cancelTask == nil else { throw Failure.message("A sign-in window is already open.") }
        let attempt = Task {
            let form = try await authorize(request)
            try Task.checkCancellation()
            return try await exchange(form)
        }
        cancelTask = { attempt.cancel() }
        defer { cancelTask = nil }
        do { return try await attempt.value }
        catch {
            if attempt.isCancelled { throw Failure.cancelled }
            throw error
        }
    }

    func cancel() {
        cancelTask?()
        session?.cancel()
        if let browser { finishBrowser(browser.state, .failure(Failure.cancelled)) }
    }

    private func authorize(_ request: Request) async throws -> [String: String] {
        try Task.checkCancellation()
        guard !request.clientID.isEmpty else {
            throw Failure.message("\(request.provider) sign-in isn't configured for this build.")
        }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let window = scenes.first(where: { $0.activationState == .foregroundActive })?.keyWindow else {
            throw Failure.message("Open Otter to sign in.")
        }
        self.window = window
        defer { self.window = nil }

        let verifier = try Self.random(32)
        let state = try Self.random(16)
        let fields = [
            "client_id": request.clientID,
            "redirect_uri": request.redirect,
            "response_type": "code",
            "scope": request.scopes.joined(separator: " "),
            "code_challenge": Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8)))),
            "code_challenge_method": "S256",
            "state": state,
        ].merging(request.options) { value, _ in value }
        var components = URLComponents(url: request.endpoint, resolvingAgainstBaseURL: false)!
        components.queryItems = fields.map { .init(name: $0.key, value: $0.value) }
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            browser = (state, continuation)
            let session = ASWebAuthenticationSession(url: components.url!, callback: .customScheme(request.scheme)) { [weak self] url, error in
                let result: Result<URL, Error>
                if let url {
                    result = .success(url)
                } else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                    result = .failure(Failure.cancelled)
                } else {
                    result = .failure(Failure.message("Couldn't open \(request.provider) sign-in."))
                }
                Task { @MainActor in self?.finishBrowser(state, result) }
            }
            self.session = session
            session.presentationContextProvider = self
            if !session.start() {
                finishBrowser(state, .failure(Failure.message("Couldn't open \(request.provider) sign-in.")))
            }
        }
        try Task.checkCancellation()
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in query.first { $0.name == name }?.value }
        guard value("state") == state else { throw Failure.message("\(request.provider) sign-in didn't finish.") }
        if value("error") == "access_denied" { throw Failure.cancelled }
        guard let code = value("code"), !code.isEmpty else {
            throw Failure.message("\(request.provider) didn't authorize this sign-in.")
        }
        return ["grant_type": "authorization_code", "code": code, "code_verifier": verifier,
                "redirect_uri": request.redirect]
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
            throw Failure.message("Couldn't start a secure sign-in.")
        }
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
