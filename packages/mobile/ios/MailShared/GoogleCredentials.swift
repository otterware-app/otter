import Foundation

nonisolated enum GoogleCredentials {
    struct Tokens: Codable, Sendable {
        var accessToken: String
        var idToken: String?
        var expiresAt: Date
    }
    struct Response: Decodable, Sendable {
        var access_token: String?
        var expires_in: Double?
        var refresh_token: String?
        var id_token: String?
        var error: String?
        var scope: String?

        var tokens: Tokens {
            Tokens(accessToken: access_token ?? "", idToken: id_token,
                   expiresAt: .now.addingTimeInterval((expires_in ?? 3600) - 60))
        }
    }
    struct Credential: Codable, Sendable {
        var refreshToken: String
        var clientID: String
    }
    enum Failure: Error { case revoked, unavailable }
    static var clientID: String { Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String ?? "" }
    static func refreshKey(_ email: String) -> String { "google-refresh-token:\(email.lowercased())" }
    private static func accessKey(_ email: String) -> String { "google-access-token:\(email.lowercased())" }

    static func save(_ email: String, credential: Credential, tokens: Tokens) throws {
        try MailCredentialStore.write(accessKey(email), nil)
        try MailCredentialStore.write(refreshKey(email), String(decoding: JSONEncoder().encode(credential), as: UTF8.self))
        try cache(email, tokens: tokens)
    }

    @concurrent
    static func refresh(_ email: String, force: Bool = false, requireID: Bool = false) async throws -> Tokens {
        try await MailCredentialStore.locked("oauth:" + email) {
            let refreshKey = refreshKey(email)
            guard let saved = try MailCredentialStore.read(refreshKey) else { throw Failure.revoked }
            // A sign-in it can't read (from a deleted Google client) is no sign-in: sign in again.
            guard let credential = try? JSONDecoder().decode(Credential.self, from: Data(saved.utf8)) else {
                try forget(email)
                throw Failure.revoked
            }
            if !force, let tokens = cached(email), tokens.expiresAt > .now, !requireID || tokens.idToken != nil { return tokens }
            let response: Response
            do {
                response = try await request([
                    "grant_type": "refresh_token", "refresh_token": credential.refreshToken,
                    "client_id": credential.clientID,
                ])
            } catch Failure.revoked {
                if try MailCredentialStore.read(refreshKey) == saved { try forget(email) }
                throw Failure.revoked
            }
            try Task.checkCancellation()
            // Removal/replacement must never be undone by an in-flight refresh.
            guard try MailCredentialStore.read(refreshKey) == saved else { throw Failure.revoked }
            if let rotated = response.refresh_token, !rotated.isEmpty {
                let updated = Credential(refreshToken: rotated, clientID: credential.clientID)
                try MailCredentialStore.write(refreshKey, String(decoding: JSONEncoder().encode(updated), as: UTF8.self))
            }
            let tokens = response.tokens
            try cache(email, tokens: tokens)
            return tokens
        }
    }

    private static func cache(_ email: String, tokens: Tokens) throws {
        try MailCredentialStore.write(accessKey(email), String(decoding: JSONEncoder().encode(tokens), as: UTF8.self))
    }

    private static func cached(_ email: String) -> Tokens? {
        guard let value = MailCredentialStore.get(accessKey(email)) else { return nil }
        return try? JSONDecoder().decode(Tokens.self, from: Data(value.utf8))
    }

    static func forget(_ email: String) throws {
        try MailCredentialStore.write(refreshKey(email), nil)
        try MailCredentialStore.write(accessKey(email), nil)
    }

    static func request(_ params: [String: String]) async throws -> Response {
        let (data, status) = try await MailCredentialStore.request(
            URL(string: "https://oauth2.googleapis.com/token")!,
            form: params.merging(["client_id": clientID]) { value, _ in value }
        )
        if status == 401 { throw Failure.revoked }
        let response = try JSONDecoder().decode(Response.self, from: data)
        if ["invalid_grant", "invalid_client", "deleted_client", "unauthorized_client"].contains(response.error ?? "") {
            throw Failure.revoked
        }
        guard status == 200, response.access_token?.isEmpty == false, response.error == nil else { throw Failure.unavailable }
        return response
    }
}
