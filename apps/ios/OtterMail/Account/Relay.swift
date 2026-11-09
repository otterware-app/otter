import Foundation

@MainActor
final class Relay {
    struct User: Codable, Equatable {
        var id: String
        var email: String
        var name: String?
        var picture: String?
    }

    struct Account: Codable {
        var email: String
        var provider: MailProviderKind?
        var imap: ImapSettings?
        var name: String?
        var picture: String?
        var displayName: String?
        var color: String?
        var customPicture: String?
        var aliasPictures: [String: String]?
    }

    struct Device: Decodable, Identifiable {
        var id: String
        var token: String
        var userAgent: String?
        var updatedAt: Date
    }

    struct NotificationConnection: Decodable {
        var email: String
        var provider: String
        var status: String
        var updatedAt: Double
    }
    struct NotificationConnections: Decodable {
        var connections: [NotificationConnection]
        var providers: [String: Bool]
    }

    func notificationConnections() async throws -> NotificationConnections {
        let (data, _) = try await send("GET", "/v1/notification-connections")
        return try JSONDecoder().decode(NotificationConnections.self, from: data)
    }
    func authorizeNotifications(_ email: String) async throws -> URL {
        struct Body: Encodable { var email: String; var returnTo = "native" }
        struct Response: Decodable { var url: URL }
        let (data, _) = try await send("POST", "/v1/notification-connections/authorize", body: Body(email: email))
        return try JSONDecoder().decode(Response.self, from: data).url
    }
    func connectImapNotifications(_ email: String, settings: ImapSettings, password: String) async throws {
        struct Body: Encodable { var email: String; var settings: ImapSettings; var password: String }
        _ = try await send("PUT", "/v1/notification-connections/imap", body: Body(email: email, settings: settings, password: password))
    }
    func disconnectNotifications(_ email: String) async throws { _ = try await send("DELETE", "/v1/notification-connections/" + Self.path(email)) }

    enum Event {
        case mail(email: String)
        case accounts
        case preferences
        case chats
        /** An agent has something for the user, in its own session (a varys thread): the device reads it there. */
        case agent(agentId: String, sessionKey: String?)
    }

    struct Failure: LocalizedError {
        var status: Int
        var message: String
        var errorDescription: String? { message }
    }

    let baseURL = URL(string: ProcessInfo.processInfo.environment["OTTER_RELAY_URL"] ?? "https://relay.mail.otterware.app")!

    private static let sessionKey = "otter-session"
    private(set) var token: String? = Keychain.get(sessionKey)
    var onSignedOut: () -> Void = {}

    var isSignedIn: Bool { token != nil }

    private struct PendingSignOut: Codable, Equatable { var token: String; var origin: String }
    private static let pendingSignOutKey = "otter-pending-sign-outs"
    private var retryingSignOuts = false

    init() { Task { await retrySignOuts() } }

    func signIn(idToken: String) async throws -> User {
        struct Body: Encodable { var provider = "google"; var idToken: [String: String] }
        struct Response: Decodable { var user: User }
        let (data, response) = try await send("POST", "/v1/auth/sign-in/social", body: Body(idToken: ["token": idToken]), authorized: false)
        guard let token = response.value(forHTTPHeaderField: "set-auth-token") else {
            throw Failure(status: 0, message: "The relay didn't return a session.")
        }
        self.token = token
        Keychain.set(Self.sessionKey, token)
        return try JSONDecoder().decode(Response.self, from: data).user
    }

    func signOut() async {
        guard let token else { return }
        let entry = PendingSignOut(token: token, origin: baseURL.absoluteString)
        forget()
        // Persist before the request so background suspension can't lose the revocation.
        var pending = Self.pendingSignOuts
        if !pending.contains(entry) { pending.append(entry) }
        Self.savePendingSignOuts(pending)
        await retrySignOuts()
    }

    func retrySignOuts() async {
        guard !retryingSignOuts else { return }
        retryingSignOuts = true
        defer { retryingSignOuts = false }
        for entry in Self.pendingSignOuts {
            guard let origin = URL(string: entry.origin), let url = URL(string: "/v1/auth/sign-out", relativeTo: origin) else { continue }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 8
            request.setValue("Bearer \(entry.token)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
            guard let (_, response) = try? await URLSession.shared.data(for: request),
                  let status = (response as? HTTPURLResponse)?.statusCode,
                  (200..<300).contains(status) || status == 401 else { continue }
            Self.savePendingSignOuts(Self.pendingSignOuts.filter { $0 != entry })
        }
    }

    private static var pendingSignOuts: [PendingSignOut] {
        guard let value = Keychain.get(pendingSignOutKey), let data = value.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([PendingSignOut].self, from: data)) ?? []
    }

    private static func savePendingSignOuts(_ entries: [PendingSignOut]) {
        let value = entries.isEmpty ? nil : (try? JSONEncoder().encode(entries)).flatMap { String(data: $0, encoding: .utf8) }
        Keychain.set(pendingSignOutKey, value, thisDeviceOnly: true)
    }

    private func forget() {
        token = nil
        Keychain.set(Self.sessionKey, nil)
        disconnect()
    }

    func me() async throws -> (user: User, pushTopic: String) {
        struct Response: Decodable { var user: User; var pushTopic: String }
        let response: Response = try await get("/v1/me")
        return (response.user, response.pushTopic)
    }

    func devices() async throws -> [Device] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            return (try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
                ?? (try? Date(text, strategy: .iso8601)) ?? .distantPast
        }
        let (data, _) = try await send("GET", "/v1/auth/list-sessions")
        return try decoder.decode([Device].self, from: data)
    }

    func revoke(_ device: Device) async throws {
        _ = try await send("POST", "/v1/auth/revoke-session", body: ["token": device.token])
    }

    func deleteUser() async throws {
        _ = try await send("POST", "/v1/auth/delete-user", body: [String: String]())
        forget()
    }

    func accounts() async throws -> [Account] {
        struct Response: Decodable { var accounts: [Account] }
        let response: Response = try await get("/v1/accounts?providers=gmail,imap,outlook")
        return response.accounts
    }

    /**
     * Links the mailbox or updates its profile. A Gmail link needs a Google ID
     * token proving the sign-in; an Outlook one, `provider: .outlook` and a
     * Microsoft ID token; an IMAP one, its settings (`profile.imap`).
     */
    func putAccount(_ email: String, idToken: String? = nil, profile: Account) async throws {
        struct Body: Encodable {
            var idToken: String?
            var provider: MailProviderKind?
            var imap: ImapSettings?
            var name, picture, displayName, color: String?
        }
        let body = Body(
            idToken: idToken, provider: profile.provider ?? (profile.imap == nil ? nil : .imap), imap: profile.imap,
            name: profile.name, picture: profile.picture, displayName: profile.displayName, color: profile.color
        )
        _ = try await send("PUT", "/v1/accounts/\(Self.path(email))", body: body)
    }

    func unlink(_ email: String) async throws {
        _ = try await send("DELETE", "/v1/accounts/\(Self.path(email))?providers=gmail,imap,outlook")
    }

    struct OutlookWatch: Decodable {
        var notificationUrl: String
        var clientState: String
    }

    func outlookWatch(_ email: String) async throws -> OutlookWatch {
        let (data, _) = try await send("POST", "/v1/outlook/watch", body: ["email": email.lowercased()])
        return try JSONDecoder().decode(OutlookWatch.self, from: data)
    }

    func registerPush(token: String, mode: String, mailboxes: [String]) async throws {
        struct Body: Encodable { var token: String; var topic: String; var environment: String; var mode: String; var mailboxes: [String] }
        let environment = Bundle.main.object(forInfoDictionaryKey: "APNsEnvironment") as? String
        guard let environment, let topic = Bundle.main.bundleIdentifier else { throw Failure(status: 0, message: "Push isn't configured for this build.") }
        _ = try await send("PUT", "/v1/push/device", body: Body(token: token, topic: topic,
            environment: environment == "development" ? "sandbox" : "production", mode: mode, mailboxes: mailboxes))
    }

    func preferences() async throws -> (sections: [String: Any], hermesKey: String?) {
        let (data, _) = try await send("GET", "/v1/preferences")
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return (object?["preferences"] as? [String: Any] ?? [:], object?["hermesKey"] as? String)
    }

    func putPreferences(_ sections: [String: Any], hermesKey: String?? = nil) async throws {
        var body: [String: Any] = ["preferences": sections]
        if let hermesKey { body["hermesKey"] = hermesKey ?? NSNull() }
        _ = try await send("PUT", "/v1/preferences", data: try JSONSerialization.data(withJSONObject: body))
    }

    /** The account's chats, without their turns (deleted ones too, with `deletedAt`). */
    func chats() async throws -> [[String: Any]] {
        let (data, _) = try await send("GET", "/v1/chats")
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return object?["chats"] as? [[String: Any]] ?? []
    }

    func chat(_ id: String) async throws -> [String: Any]? {
        do {
            let (data, _) = try await send("GET", "/v1/chats/" + Self.segment(id))
            return (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["chat"] as? [String: Any]
        } catch let failure as Failure where failure.status == 404 {
            return nil
        }
    }

    func putChat(_ chat: [String: Any]) async throws {
        let id = chat["id"] as? String ?? ""
        _ = try await send("PUT", "/v1/chats/" + Self.segment(id), data: try JSONSerialization.data(withJSONObject: chat))
    }

    func deleteChat(_ id: String) async throws { _ = try await send("DELETE", "/v1/chats/" + Self.segment(id)) }

    /** A channel an agent tells the account's devices through (`/channel/v1/pointers`), with its token, shown only now. */
    func makeAgentChannel(_ label: String) async throws -> (id: String, token: String) {
        let (data, _) = try await send("POST", "/v1/agent-channels", data: try JSONSerialization.data(withJSONObject: ["label": label]))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let id = (object?["channel"] as? [String: Any])?["id"] as? String, let token = object?["token"] as? String else {
            throw Failure(status: 0, message: "The relay didn't make the channel.")
        }
        return (id, token)
    }

    func deleteAgentChannel(_ id: String) async throws { _ = try await send("DELETE", "/v1/agent-channels/" + Self.segment(id)) }

    private var socket: URLSessionWebSocketTask?
    private var listening: Task<Void, Never>?

    func connect(onEvent: @escaping (Event) -> Void) {
        guard listening == nil, token != nil else { return }
        listening = Task { [weak self] in
            var delay: Duration = .seconds(1)
            while !Task.isCancelled, let self, let token = self.token {
                var request = URLRequest(url: self.eventsURL)
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                let socket = URLSession.shared.webSocketTask(with: request)
                self.socket = socket
                socket.resume()
                let pinging = Task {
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(30))
                        try? await socket.send(.string("ping"))
                    }
                }
                do {
                    while true {
                        guard case .string(let text) = try await socket.receive() else { continue }
                        delay = .seconds(1)
                        if let event = Self.event(text) { onEvent(event) }
                    }
                } catch {}
                pinging.cancel()
                let ended = socket.closeCode.rawValue == 4001 || socket.closeReason == Data("Signed out".utf8)
                if ended || (socket.response as? HTTPURLResponse)?.statusCode == 401 {
                    self.forget()
                    self.onSignedOut()
                    return
                }
                try? await Task.sleep(for: delay)
                delay = min(delay * 2, .seconds(60))
            }
        }
    }

    func disconnect() {
        listening?.cancel()
        listening = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    private var eventsURL: URL {
        var components = URLComponents(url: baseURL.appending(path: "/v1/events"), resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        return components.url!
    }

    private static func event(_ text: String) -> Event? {
        guard
            let data = text.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        switch object["type"] as? String {
        case "mail": return (object["email"] as? String).map { .mail(email: $0) }
        case "accounts": return .accounts
        case "preferences": return .preferences
        case "chats": return .chats
        case "agent":
            guard let pointer = object["pointer"] as? [String: Any], let agentId = pointer["agentId"] as? String else { return nil }
            return .agent(agentId: agentId, sessionKey: pointer["sessionKey"] as? String)
        default: return nil
        }
    }

    /** An id as one path segment, as it is (unlike `path`, which lowercases an address). */
    private static func segment(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? id
    }

    private static func path(_ email: String) -> String {
        email.lowercased().addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["@", "/"])) ?? email
    }

    private func get<T: Decodable>(_ route: String) async throws -> T {
        let (data, _) = try await send("GET", route)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func send(
        _ method: String, _ route: String, body: some Encodable, authorized: Bool = true
    ) async throws -> (Data, HTTPURLResponse) {
        try await send(method, route, data: try JSONEncoder().encode(body), authorized: authorized)
    }

    @discardableResult
    private func send(
        _ method: String, _ route: String, data: Data? = nil, authorized: Bool = true
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: route, relativeTo: baseURL)!)
        let requestToken = token
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("Otter Mail/\(Bundle.main.version) (iPhone)", forHTTPHeaderField: "User-Agent")
        if let data {
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authorized {
            guard let token else { throw Failure(status: 401, message: "Not signed in to Otter Mail.") }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let body: Data, response: URLResponse
        do { (body, response) = try await URLSession.shared.data(for: request) } catch {
            ErrorReports.capture(error, scope: "relay", tags: ["route": method + " " + request.url!.path()])
            throw error
        }
        let http = response as! HTTPURLResponse
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])
                .flatMap { ($0["error"] as? String) ?? ($0["message"] as? String) }
            if http.statusCode == 401, authorized, token != nil, token == requestToken {
                forget()
                onSignedOut()
            }
            let failure = Failure(status: http.statusCode, message: message ?? "The relay answered \(http.statusCode).")
            if http.statusCode != 404 { ErrorReports.capture(failure, scope: "relay", tags: ["route": method + " " + request.url!.path()]) }
            throw failure
        }
        return (body, http)
    }
}

extension Bundle {
    var version: String { object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
}
