import Foundation

nonisolated enum MicrosoftCredentials {
    static let clientID = "b0c4e8bf-e651-456e-9bc6-408a741b36f9"
    static let authority = "https://login.microsoftonline.com/common/oauth2/v2.0"
    static let scopes = ["openid", "email", "profile", "offline_access", "https://graph.microsoft.com/User.Read", "https://graph.microsoft.com/Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/MailboxSettings.ReadWrite", "https://graph.microsoft.com/Calendars.ReadWrite"]
    struct Tokens: Codable, Sendable { var accessToken: String; var idToken: String?; var expiresAt: Date }
    struct Response: Decodable {
        var access_token: String?; var expires_in: Double?; var refresh_token: String?; var id_token: String?; var error: String?
        var tokens: Tokens { .init(accessToken: access_token ?? "", idToken: id_token, expiresAt: .now.addingTimeInterval((expires_in ?? 3600) - 60)) }
    }
    enum Failure: Error { case revoked, unavailable }
    static func refreshKey(_ email: String) -> String { "microsoft-refresh-token:\(email.lowercased())" }
    private static func accessKey(_ email: String) -> String { "microsoft-access-token:\(email.lowercased())" }

    static func save(_ email: String, refreshToken: String, tokens: Tokens) throws {
        try MailCredentialStore.write(accessKey(email), nil)
        try MailCredentialStore.write(refreshKey(email), refreshToken)
        try cache(email, tokens: tokens)
    }
    @concurrent
    static func refresh(_ email: String, force: Bool = false, requireID: Bool = false) async throws -> Tokens {
        try await MailCredentialStore.locked("microsoft-oauth:" + email) {
            guard let saved = try MailCredentialStore.read(refreshKey(email)) else { throw Failure.revoked }
            if !force, let tokens = cached(email), tokens.expiresAt > .now, !requireID || tokens.idToken != nil { return tokens }
            let response: Response
            do { response = try await request(["grant_type": "refresh_token", "refresh_token": saved]) }
            catch Failure.revoked {
                if try MailCredentialStore.read(refreshKey(email)) == saved { try forget(email) }
                throw Failure.revoked
            }
            try Task.checkCancellation()
            guard try MailCredentialStore.read(refreshKey(email)) == saved else { throw Failure.revoked }
            if let rotated = response.refresh_token, !rotated.isEmpty { try MailCredentialStore.write(refreshKey(email), rotated) }
            let tokens = response.tokens
            try cache(email, tokens: tokens)
            return tokens
        }
    }
    static func forget(_ email: String) throws {
        try MailCredentialStore.write(refreshKey(email), nil)
        try MailCredentialStore.write(accessKey(email), nil)
    }

    private static func cache(_ email: String, tokens: Tokens) throws {
        try MailCredentialStore.write(accessKey(email), String(decoding: JSONEncoder().encode(tokens), as: UTF8.self))
    }

    private static func cached(_ email: String) -> Tokens? {
        guard let value = MailCredentialStore.get(accessKey(email)) else { return nil }
        return try? JSONDecoder().decode(Tokens.self, from: Data(value.utf8))
    }

    static func request(_ params: [String: String]) async throws -> Response {
        let (data, status) = try await MailCredentialStore.request(
            URL(string: "\(authority)/token")!,
            form: params.merging(["client_id": clientID, "scope": scopes.joined(separator: " ")]) { value, _ in value }
        )
        let response = try JSONDecoder().decode(Response.self, from: data)
        if ["invalid_grant", "interaction_required", "consent_required", "login_required"].contains(response.error ?? "") {
            throw Failure.revoked
        }
        guard status == 200, response.access_token?.isEmpty == false, response.error == nil else { throw Failure.unavailable }
        return response
    }
}
