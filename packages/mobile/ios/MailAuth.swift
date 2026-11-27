import Foundation

nonisolated enum MailAuth: String {
    case gmail, outlook

    var provider: String { self == .gmail ? "Google" : "Microsoft" }

    private var lockPrefix: String { self == .gmail ? "oauth:" : "microsoft-oauth:" }

    func signedInAddresses() throws -> [String] {
        let prefix = refreshKey("")
        return try MailCredentialStore.names().compactMap { name in
            guard name.hasPrefix(prefix) else { return nil }
            return String(name.dropFirst(prefix.count))
        }
    }

    func forget(_ email: String) async throws {
        try await MailCredentialStore.locked(lockPrefix + email) {
            switch self {
            case .gmail: try GoogleCredentials.forget(email)
            case .outlook: try MicrosoftCredentials.forget(email)
            }
        }
    }

    func token(_ email: String, id: Bool, force: Bool) async throws -> String? {
        let token: String?
        do {
            switch self {
            case .gmail:
                let tokens = try await GoogleCredentials.refresh(email, force: force, requireID: id)
                token = id ? tokens.idToken : tokens.accessToken
            case .outlook:
                let tokens = try await MicrosoftCredentials.refresh(email, force: force, requireID: id)
                token = id ? tokens.idToken : tokens.accessToken
            }
        } catch GoogleCredentials.Failure.revoked {
            return nil
        } catch MicrosoftCredentials.Failure.revoked {
            return nil
        } catch {
            throw OAuthSignIn.Failure.message("Couldn't refresh the \(provider) sign-in. Try again.")
        }
        guard let token, !token.isEmpty else {
            throw OAuthSignIn.Failure.message("\(provider) didn't return an ID token. Sign in to this mailbox again.")
        }
        return token
    }

    private func refreshKey(_ email: String) -> String {
        switch self {
        case .gmail: GoogleCredentials.refreshKey(email)
        case .outlook: MicrosoftCredentials.refreshKey(email)
        }
    }

    @MainActor
    func signIn(browser: OAuthSignIn, loginHint: String?) async throws -> [String: String] {
        let request: OAuthSignIn.Request
        switch self {
        case .gmail:
            var options = ["prompt": "consent select_account", "access_type": "offline"]
            options["login_hint"] = loginHint
            request = .google(
                scopes: ["openid", "email", "profile", "https://mail.google.com/",
                         "https://www.googleapis.com/auth/gmail.settings.basic"],
                options: options
            )
        case .outlook:
            var options = ["prompt": "select_account", "response_mode": "query"]
            options["login_hint"] = loginHint
            let scheme = "msauth.\(Bundle.main.bundleIdentifier ?? "dev.otterware.mail")"
            request = .init(provider: provider, endpoint: URL(string: "\(MicrosoftCredentials.authority)/authorize")!,
                            clientID: MicrosoftCredentials.clientID, scheme: scheme, redirect: "\(scheme)://auth",
                            scopes: MicrosoftCredentials.scopes, options: options)
        }
        return try await browser.perform(request) { form in
            switch self {
            case .gmail:
                let response = try await exchange { try await GoogleCredentials.request(form) }
                if let scope = response.scope, !scope.split(separator: " ").contains("https://mail.google.com/") {
                    throw OAuthSignIn.Failure.message("Allow access to your mail when you sign in to Gmail.")
                }
                let refresh = try refreshToken(response.refresh_token)
                let profile: GoogleProfile = try await profile(
                    "https://www.googleapis.com/oauth2/v3/userinfo", token: response.tokens.accessToken
                )
                let email = try address(profile.email, hint: loginHint)
                try await MailCredentialStore.locked(lockPrefix + email) {
                    try GoogleCredentials.save(email, credential: .init(refreshToken: refresh, clientID: request.clientID),
                                               tokens: response.tokens)
                }
                var signedIn = ["email": email, "name": profile.name ?? email]
                signedIn["picture"] = profile.picture
                return signedIn
            case .outlook:
                let response = try await exchange { try await MicrosoftCredentials.request(form) }
                let refresh = try refreshToken(response.refresh_token)
                let profile: OutlookProfile = try await profile(
                    "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName",
                    token: response.tokens.accessToken
                )
                let email = try address([profile.mail, profile.userPrincipalName].compactMap { $0 }.first { $0.contains("@") }, hint: loginHint)
                try await MailCredentialStore.locked(lockPrefix + email) {
                    try MicrosoftCredentials.save(email, refreshToken: refresh, tokens: response.tokens)
                }
                let name = profile.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
                return ["email": email, "name": name.flatMap { $0.isEmpty ? nil : $0 } ?? email]
            }
        }
    }

    private struct GoogleProfile: Decodable {
        let email: String?
        let name: String?
        let picture: String?
    }

    private struct OutlookProfile: Decodable {
        let mail: String?
        let userPrincipalName: String?
        let displayName: String?
    }

    private func exchange<T>(_ request: () async throws -> T) async throws -> T {
        do { return try await request() }
        catch {
            throw OAuthSignIn.Failure.message("Couldn't complete \(provider) sign-in. Try again.")
        }
    }

    private func profile<T: Decodable>(_ url: String, token: String) async throws -> T {
        var request = URLRequest(url: URL(string: url)!, timeoutInterval: 10)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let profile = try? JSONDecoder().decode(T.self, from: data)
        else { throw OAuthSignIn.Failure.message("Couldn't read the \(provider) profile.") }
        return profile
    }

    private func refreshToken(_ token: String?) throws -> String {
        guard let token, !token.isEmpty else {
            throw OAuthSignIn.Failure.message("\(provider) didn't return a refresh token. Try again.")
        }
        return token
    }

    private func address(_ value: String?, hint: String?) throws -> String {
        guard let email = value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), email.contains("@") else {
            throw OAuthSignIn.Failure.message("\(provider) didn't return an email address.")
        }
        if let hint, !hint.isEmpty, email != hint.lowercased() {
            throw OAuthSignIn.Failure.message("That's \(email). Sign in as \(hint).")
        }
        return email
    }
}
