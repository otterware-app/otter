import AuthenticationServices
import CryptoKit
import Foundation

/**
 * Who you are, for the Otter account: Google's ID token, with Otter Mail's "iOS" OAuth client
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

    func idToken() async throws -> String {
        let verifier = Self.random(32)
        let state = Self.random(16)
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
            let session = ASWebAuthenticationSession(url: components.url!, callback: .customScheme(Self.scheme)) { url, error in
                if let url { return continuation.resume(returning: url) }
                let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                continuation.resume(throwing: cancelled ? Failure.cancelled : Failure.google(error?.localizedDescription ?? "Sign-in failed."))
            }
            session.presentationContextProvider = self
            session.start()
        }
        let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in query.first { $0.name == name }?.value }
        if value("error") == "access_denied" { throw Failure.cancelled }
        guard value("state") == state, let code = value("code") else {
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
        return token
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor(windowScene: scenes[0])
    }

    private static func random(_ count: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: count)
        _ = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        return base64URL(Data(bytes))
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
