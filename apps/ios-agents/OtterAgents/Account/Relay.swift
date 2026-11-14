import Foundation

/**
 * The Otter relay (packages/contracts' relay.ts and agent-sync.ts), as far as the agents need
 * it: the account, its preferences (the look), its agents and chats, and the events that say one
 * of them changed on another device.
 */
@MainActor
final class Relay {
    struct User: Codable, Equatable {
        var id: String
        var email: String
        var name: String?
        var picture: String?
    }

    enum Event {
        case preferences
        /** The account's agents or chats changed on another device. */
        case agentSync
        /** An agent has something for the user, in its own session: the device reads it there. */
        case agent(AgentPointer)
    }

    struct Failure: LocalizedError {
        var status: Int
        var message: String
        var errorDescription: String? { message }
    }

    let baseURL = URL(string: ProcessInfo.processInfo.environment["OTTER_RELAY_URL"] ?? "https://relay.otterware.app")!

    private static let sessionKey = "otter-session"
    private(set) var token: String? = Keychain.get(sessionKey)
    var onSignedOut: () -> Void = {}

    var isSignedIn: Bool { token != nil }

    func signIn(idToken: String) async throws -> User {
        struct Body: Encodable { var provider = "google"; var idToken: [String: String] }
        struct Response: Decodable { var user: User }
        let (data, response) = try await send("POST", "/v1/auth/sign-in/social", data: try JSONEncoder().encode(Body(idToken: ["token": idToken])), authorized: false)
        guard let token = response.value(forHTTPHeaderField: "set-auth-token") else {
            throw Failure(status: 0, message: "The relay didn't return a session.")
        }
        self.token = token
        Keychain.set(Self.sessionKey, token)
        return try JSONDecoder().decode(Response.self, from: data).user
    }

    #if DEBUG
    /** `pnpm dev:demo`'s relay: a session for this address without Google (`pnpm dev:ios:agents --relay local --as`). */
    func devSignIn(email: String) async throws -> User {
        struct Session: Decodable { var token: String }
        struct Me: Decodable { var user: User }
        let (data, _) = try await send("POST", "/v1/dev/session", data: try JSONEncoder().encode(["email": email]), authorized: false)
        token = try JSONDecoder().decode(Session.self, from: data).token
        Keychain.set(Self.sessionKey, token)
        return try JSONDecoder().decode(Me.self, from: try await send("GET", "/v1/me").0).user
    }
    #endif

    func signOut() async {
        guard token != nil else { return }
        _ = try? await send("POST", "/v1/auth/sign-out", data: Data("{}".utf8))
        forget()
    }

    func deleteUser() async throws {
        try await send("POST", "/v1/auth/delete-user", data: Data("{}".utf8))
        forget()
    }

    private func forget() {
        token = nil
        Keychain.set(Self.sessionKey, nil)
        disconnect()
    }

    func preferences() async throws -> [String: Any] {
        let (data, _) = try await send("GET", "/v1/preferences")
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["preferences"] as? [String: Any] ?? [:]
    }

    func putPreferences(_ sections: [String: Any]) async throws {
        try await send("PUT", "/v1/preferences", data: try JSONSerialization.data(withJSONObject: ["preferences": sections]))
    }

    struct AgentSyncResponse {
        var version: Int
        var lastMutationId: Int
        var changes: [(key: String, value: JSON)]
        var more: Bool
    }

    /** Sends this device's mutations (`client` numbers them) and takes the entries written after `since`, a page at a time (`more`). */
    func agentSync(client: String, since: Int, mutations: [(id: Int, mutation: JSON)]) async throws -> AgentSyncResponse {
        let body: JSON = .object([
            "client": .string(client),
            "since": .number(Double(since)),
            "mutations": .array(mutations.map { .object(["id": .number(Double($0.id)), "mutation": $0.mutation]) }),
        ])
        let response = try JSON(parsing: try await send("POST", "/v1/agent-sync", data: body.data).0)
        return AgentSyncResponse(
            version: response["version"]?.count ?? since,
            lastMutationId: response["lastMutationId"]?.count ?? 0,
            changes: (response["changes"]?.array ?? []).compactMap { change in change["key"]?.string.map { ($0, change["value"] ?? .null) } },
            more: response["more"]?.bool ?? false)
    }

    /** A channel an agent tells the account's devices through (`/channel/v1/pointers`), with its token, shown only now. */
    func makeAgentChannel(_ label: String) async throws -> (id: String, token: String) {
        let (data, _) = try await send("POST", "/v1/agent-channels", data: try JSONSerialization.data(withJSONObject: ["label": label]))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard let id = (object?["channel"] as? [String: Any])?["id"] as? String, let token = object?["token"] as? String else {
            throw Failure(status: 0, message: "The relay didn't make the channel.")
        }
        return (id, token)
    }

    func deleteAgentChannel(_ id: String) async throws { try await send("DELETE", "/v1/agent-channels/" + Self.segment(id)) }

    /** This iPhone's push token, for what agents ask and send while the app is away; `on` false keeps it quiet. */
    func registerPush(token: String, on: Bool) async throws {
        guard let environment = Bundle.main.object(forInfoDictionaryKey: "APNsEnvironment") as? String, let topic = Bundle.main.bundleIdentifier else {
            throw Failure(status: 0, message: "Push isn't configured for this build.")
        }
        let body: [String: Any] = ["token": token, "topic": topic, "environment": environment == "development" ? "sandbox" : "production",
                                   "mode": on ? "all" : "off", "mailboxes": [String]()]
        try await send("PUT", "/v1/push/device", data: try JSONSerialization.data(withJSONObject: body))
    }

    private var socket: URLSessionWebSocketTask?
    private var listening: Task<Void, Never>?

    /**
     * The agent session on screen while the app is in front: the relay doesn't push to the
     * account's iPhones about a chat someone is looking at. Said again with each ping, as the
     * relay forgets a device that stops saying it.
     */
    var watching: String? {
        didSet { if watching != oldValue { sayWatching() } }
    }

    private func sayWatching() {
        let said: [String: Any] = ["type": "watching", "session": watching.map { $0 as Any } ?? NSNull()]
        guard let socket, let data = try? JSONSerialization.data(withJSONObject: said) else { return }
        socket.send(.string(String(decoding: data, as: UTF8.self))) { _ in }
    }

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
                self.sayWatching()
                let pinging = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .seconds(30))
                        try? await socket.send(.string("ping"))
                        if self?.watching != nil { self?.sayWatching() }
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
        guard let data = text.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        switch object["type"] as? String {
        case "preferences": return .preferences
        case "agent-sync": return .agentSync
        case "agent": return (object["pointer"] as? [String: Any]).flatMap(AgentPointer.init).map(Event.agent)
        default: return nil
        }
    }

    private static func segment(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? id
    }

    @discardableResult
    private func send(_ method: String, _ route: String, data: Data? = nil, authorized: Bool = true) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: URL(string: route, relativeTo: baseURL)!)
        let requestToken = token
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("Otter Agents/\(Bundle.main.version) (iPhone)", forHTTPHeaderField: "User-Agent")
        if let data {
            request.httpBody = data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if authorized {
            guard let token else { throw Failure(status: 401, message: "Not signed in to your Otter account.") }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (body, response) = try await URLSession.shared.data(for: request)
        let http = response as! HTTPURLResponse
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: body) as? [String: Any])
                .flatMap { ($0["error"] as? String) ?? ($0["message"] as? String) }
            if http.statusCode == 401, authorized, token != nil, token == requestToken {
                forget()
                onSignedOut()
            }
            throw Failure(status: http.statusCode, message: message ?? "The relay answered \(http.statusCode).")
        }
        return (body, http)
    }
}

extension Bundle {
    var version: String { object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0" }
}
