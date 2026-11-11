import CryptoKit
import Foundation

// Gateway runs outlive the app. Use the turn id as the idempotency key to recover them after reconnecting.
final class OpenClaw {
    nonisolated struct Failure: LocalizedError {
        var code: String?
        var message: String
        var requestID: String?
        var errorDescription: String? { message }
    }

    struct Secrets {
        var get: (String) -> String?
        var set: (String, String?) -> Void
    }

    nonisolated struct GatewayAgent: Equatable {
        var id: String
        var name: String
        var isDefault: Bool
        var emoji: String?
        /** Its picture: an https address, or the picture itself as a data URL. */
        var avatar: String?
    }

    nonisolated struct Chat: Equatable {
        var id: String
        var title: String?
        var preview: String?
        var lastActive: Date
    }

    nonisolated struct Message: Equatable {
        var role: String
        var text: String
        var steps: [Step] = []
    }

    nonisolated struct Step: Equatable {
        var id: String?
        var name: String
        var output: String?
    }

    nonisolated struct Reply: Equatable {
        var text = ""
        var steps: [Step] = []
    }

    nonisolated struct Approval: Equatable {
        var id: String
        var command: String?
    }

    nonisolated struct Question: Equatable, Identifiable {
        nonisolated struct Item: Equatable, Identifiable {
            nonisolated struct Option: Equatable {
                var label: String
                var description: String?
            }
            var id: String
            var header: String
            var question: String
            var options: [Option]
            var multiSelect: Bool
            var secret: Bool
        }
        var id: String
        var items: [Item]
        var expires: Date
    }

    nonisolated enum Event {
        case reply(Reply)
        /** The run handed off (`sessions_yield`): the turn waits on the subagents it started, each by its label when it has one. */
        case waiting([String?])
        /** The run their completion started is going: the turn goes on. */
        case working
        case approval(Approval)
        case approvalResolved(String)
        case question(Question)
        case questionResolved(String)
        case done
        case failed(String)
        case detached
    }

    static let keyName = "openclaw-device-key"
    static let deviceTokenName = "openclaw-device-token"
    static let tokenName = "openclaw-token"
    static let bootstrapName = "openclaw-bootstrap-token"
    static let scopesName = "openclaw-device-scopes"

    /**
     * What this iPhone asks for: what OpenClaw's own apps hold. The gateway counts
     * a chat's turns as the owner's (its `nodes` tool, its own settings) only from a
     * device with `operator.admin`. An iPhone paired with fewer signs in with the
     * scopes it has and asks for the rest separately (`allowFullAccess`), as the
     * gateway refuses a paired device that just asks for more.
     */
    private static let scopes = [
        "operator.read", "operator.write", "operator.approvals", "operator.questions", "operator.admin", "operator.pairing",
    ]
    private static let connectTimeout: TimeInterval = 8
    /** How long a run may go quiet before asking the gateway whether it's still going. */
    private static let quietSeconds: TimeInterval = 60
    private static let reconnectDelays: [TimeInterval] = [1, 2, 5, 10, 20, 30]

    let url: URL
    private let secrets: Secrets
    private let appVersion: String

    init(url: URL, secrets: Secrets, appVersion: String) {
        self.url = url
        self.secrets = secrets
        self.appVersion = appVersion
    }

    static func normalized(_ raw: String) -> String {
        var trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        let lower = trimmed.lowercased()
        if lower.hasPrefix("ws://") || lower.hasPrefix("wss://") { return trimmed }
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") { return "ws" + trimmed.dropFirst(4) }
        return "wss://\(trimmed)"
    }

    /** A setup code (`openclaw qr --setup-code-only`): base64url JSON of the address and a one-time token. */
    static func setupCode(_ code: String) -> (url: String, bootstrapToken: String, expires: Date?)? {
        var base64 = code.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let url = json["url"] as? String, let token = json["bootstrapToken"] as? String
        else { return nil }
        return (url, token, (json["expiresAtMs"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) })
    }

    private lazy var key: Curve25519.Signing.PrivateKey = {
        if let saved = secrets.get(Self.keyName), let raw = Data(base64Encoded: saved),
           let key = try? Curve25519.Signing.PrivateKey(rawRepresentation: raw) { return key }
        let key = Curve25519.Signing.PrivateKey()
        secrets.set(Self.keyName, key.rawRepresentation.base64EncodedString())
        return key
    }()

    private var deviceID: String {
        SHA256.hash(data: key.publicKey.rawRepresentation).map { String(format: "%02x", $0) }.joined()
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    var hasCredentials: Bool {
        [Self.tokenName, Self.bootstrapName, Self.deviceTokenName].contains { secrets.get($0)?.isEmpty == false }
    }

    private(set) var pairingRequest: String?
    private(set) var granted: [String] = []
    var fullAccess: Bool { Self.scopes.allSatisfy(granted.contains) }
    private var steers: [String: Set<String>] = [:]
    /** Turns waiting on a yield, by run: how each ends, as no run of theirs is going to say so. */
    private var waits: [String: (Event) -> Void] = [:]

    private var socket: URLSessionWebSocketTask?
    private var ready: Task<Void, Error>?
    private var challenge: CheckedContinuation<(nonce: String, ts: Int), Error>?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var requestCount = 0
    private var listeners: [UUID: (String, [String: Any]) -> Void] = [:]
    private var closeListeners: [UUID: () -> Void] = [:]

    func connected() async throws {
        if let ready { return try await ready.value }
        let attempt = Task { try await open() }
        ready = attempt
        do { try await attempt.value } catch {
            if ready == attempt { ready = nil }
            throw error
        }
    }

    func disconnect() {
        let socket = socket
        closed(socket)
        socket?.cancel(with: .normalClosure, reason: nil)
    }

    private func open() async throws {
        let socket = URLSession.shared.webSocketTask(with: url)
        self.socket = socket
        socket.resume()
        Task { await receive(socket) }
        let (nonce, ts) = try await within(Self.connectTimeout) {
            try await withCheckedThrowingContinuation { self.challenge = $0 }
        } onTimeout: {
            self.challenge?.resume(throwing: Failure(code: "unreachable", message: "The gateway didn't answer."))
            self.challenge = nil
        }

        let token = secrets.get(Self.tokenName).flatMap { $0.isEmpty ? nil : $0 }
        let bootstrap = secrets.get(Self.bootstrapName).flatMap { $0.isEmpty ? nil : $0 }
        let deviceToken = secrets.get(Self.deviceTokenName).flatMap { $0.isEmpty ? nil : $0 }
        let auth: [String: String]
        let signed: String
        if let bootstrap { auth = ["bootstrapToken": bootstrap]; signed = bootstrap }
        else if let token { auth = ["token": token]; signed = token }
        else if let deviceToken { auth = ["deviceToken": deviceToken]; signed = deviceToken }
        else { throw Failure(code: "not_configured", message: "Paste a setup code to connect.") }

        let client: [String: Any] = [
            "id": "gateway-client", "mode": "ui", "displayName": "Otter Mail (iPhone)",
            "version": appVersion, "platform": "ios",
        ]
        let held = (secrets.get(Self.scopesName) ?? "").split(separator: ",").map(String.init)
        let scopes = held.isEmpty ? Self.scopes : held
        let payload = ["v3", deviceID, "gateway-client", "ui", "operator", scopes.joined(separator: ","),
                       String(ts), signed, nonce, "ios", ""].joined(separator: "|")
        let signature = try key.signature(for: Data(payload.utf8))
        let hello: [String: Any]
        do {
            hello = try await request("connect", [
                "minProtocol": 4, "maxProtocol": 4, "client": client, "role": "operator",
                "scopes": scopes, "caps": ["tool-events", "exec-approvals"], "auth": auth,
                "device": [
                    "id": deviceID, "publicKey": Self.base64url(key.publicKey.rawRepresentation),
                    "signature": Self.base64url(signature), "signedAt": ts, "nonce": nonce,
                ],
            ], timeout: Self.connectTimeout) as? [String: Any] ?? [:]
        } catch let failure as Failure {
            if failure.code == "PAIRING_REQUIRED" { pairingRequest = failure.requestID }
            disconnect()
            throw failure
        } catch {
            disconnect()
            throw error
        }
        pairingRequest = nil
        let accepted = hello["auth"] as? [String: Any] ?? [:]
        granted = accepted["scopes"] as? [String] ?? []
        if let issued = accepted["deviceToken"] as? String, !issued.isEmpty {
            secrets.set(Self.deviceTokenName, issued)
            secrets.set(Self.scopesName, granted.joined(separator: ","))
            if bootstrap != nil { secrets.set(Self.bootstrapName, nil) }
        }
    }

    private func receive(_ socket: URLSessionWebSocketTask) async {
        var partial = ""
        while true {
            let message: URLSessionWebSocketTask.Message
            do { message = try await socket.receive() } catch {
                closed(socket)
                return
            }
            guard self.socket === socket else { return }
            let text: String
            switch message {
            case .string(let string): text = string
            case .data(let data): text = String(decoding: data, as: UTF8.self)
            @unknown default: continue
            }
            partial += text
            guard let frame = try? JSONSerialization.jsonObject(with: Data(partial.utf8)) as? [String: Any] else { continue }
            partial = ""
            handle(frame)
        }
    }

    private func handle(_ frame: [String: Any]) {
        switch frame["type"] as? String {
        case "event":
            let name = frame["event"] as? String ?? ""
            let payload = frame["payload"] as? [String: Any] ?? [:]
            if name == "connect.challenge" {
                guard let nonce = payload["nonce"] as? String, !nonce.isEmpty else { return }
                let ts = (payload["ts"] as? NSNumber)?.intValue ?? Int(Date().timeIntervalSince1970 * 1000)
                challenge?.resume(returning: (nonce, ts))
                challenge = nil
                return
            }
            for listener in listeners.values { listener(name, payload) }
        case "res":
            guard let id = frame["id"] as? String, let waiting = pending.removeValue(forKey: id) else { return }
            if frame["ok"] as? Bool == true {
                let data = (try? JSONSerialization.data(withJSONObject: frame["payload"] ?? NSNull(), options: .fragmentsAllowed)) ?? Data()
                waiting.resume(returning: data)
            } else {
                let error = frame["error"] as? [String: Any] ?? [:]
                let details = error["details"] as? [String: Any] ?? [:]
                var failure = Failure(code: details["code"] as? String ?? error["code"] as? String,
                                      message: error["message"] as? String ?? "The gateway refused.")
                failure.requestID = details["requestId"] as? String
                waiting.resume(throwing: failure)
            }
        default:
            break
        }
    }

    private func closed(_ socket: URLSessionWebSocketTask?) {
        guard let socket, self.socket === socket else { return }
        self.socket = nil
        ready = nil
        challenge?.resume(throwing: Failure(code: "unreachable", message: "Can't reach the gateway."))
        challenge = nil
        let waiting = pending
        pending = [:]
        for continuation in waiting.values {
            continuation.resume(throwing: Failure(code: "unreachable", message: "Lost the gateway."))
        }
        for listener in closeListeners.values { listener() }
    }

    @discardableResult
    func request(_ method: String, _ params: [String: Any], timeout: TimeInterval = 30) async throws -> Any? {
        if method != "connect" { try await connected() }
        guard let socket else { throw Failure(code: "unreachable", message: "Can't reach the gateway.") }
        requestCount += 1
        let id = "otter-mail-ios-\(requestCount)"
        let frame = try JSONSerialization.data(withJSONObject: ["type": "req", "id": id, "method": method, "params": params])
        let data = try await within(timeout) {
            try await withCheckedThrowingContinuation { continuation in
                self.pending[id] = continuation
                socket.send(.string(String(decoding: frame, as: UTF8.self))) { error in
                    guard error != nil else { return }
                    Task { @MainActor in
                        self.pending.removeValue(forKey: id)?
                            .resume(throwing: Failure(code: "unreachable", message: "Lost the gateway."))
                    }
                }
            }
        } onTimeout: {
            self.pending.removeValue(forKey: id)?
                .resume(throwing: Failure(code: "timeout", message: "The gateway didn't answer."))
        }
        return try? JSONSerialization.jsonObject(with: data, options: .fragmentsAllowed)
    }

    private func within<T: Sendable>(_ seconds: TimeInterval, _ work: () async throws -> T,
                                     onTimeout: @escaping () -> Void) async throws -> T {
        let timer = Task {
            try await Task.sleep(for: .seconds(seconds))
            onTimeout()
        }
        defer { timer.cancel() }
        return try await work()
    }

    func agents() async throws -> [GatewayAgent] {
        let result = try await request("agents.list", [:]) as? [String: Any] ?? [:]
        let defaultID = result["defaultId"] as? String ?? "main"
        return (result["agents"] as? [[String: Any]] ?? []).compactMap { agent in
            guard let id = agent["id"] as? String else { return nil }
            let name = (agent["identity"] as? [String: Any])?["name"] as? String ?? agent["name"] as? String ?? id
            let identity = agent["identity"] as? [String: Any]
            let avatar = (identity?["avatarUrl"] as? String).flatMap { url in
                url.count <= 512_000 && (url.lowercased().hasPrefix("https:") || url.lowercased().hasPrefix("data:image/")) ? url : nil
            }
            return GatewayAgent(id: id, name: name, isDefault: id == defaultID, emoji: identity?["emoji"] as? String, avatar: avatar)
        }
    }

    func chats(limit: Int = 50) async throws -> [Chat] {
        let result = try await request("sessions.list", [
            "limit": limit, "includeDerivedTitles": true, "includeLastMessage": true,
            "excludeCron": true, "excludeSubagents": true, "excludeSystem": true,
        ]) as? [String: Any] ?? [:]
        return (result["sessions"] as? [[String: Any]] ?? []).compactMap { row in
            guard let id = row["key"] as? String else { return nil }
            let title = [row["derivedTitle"], row["displayName"], row["label"]].compactMap { $0 as? String }.first { !$0.isEmpty }
            return Chat(id: id, title: title ?? (row["isMain"] as? Bool == true ? "Main chat" : nil),
                        preview: row["lastMessagePreview"] as? String,
                        lastActive: Date(timeIntervalSince1970: ((row["updatedAt"] as? Double) ?? 0) / 1000))
        }
    }

    func messages(of session: String) async throws -> [Message] {
        let result = try await request("chat.history", ["sessionKey": session, "limit": 500]) as? [String: Any] ?? [:]
        return Self.transcript(result["messages"] as? [[String: Any]] ?? [])
    }

    func delete(session: String) async throws {
        try await request("sessions.delete", ["key": session])
    }

    func abort(session: String, run: String) async {
        let all = waits[run] != nil || steers[run]?.isEmpty == false
        _ = try? await request("chat.abort", all ? ["sessionKey": session] : ["sessionKey": session, "runId": run])
        // Waiting on a yield, no run is going to report it stopped, or continue it.
        waits[run]?(.failed("Stopped."))
    }

    /**
     * A message for the running turn: it lands after the current tool calls,
     * or, when the runtime can't take it mid-turn, runs after it under its own
     * id, which the turn follows too.
     */
    func steer(session: String, run: String, _ message: String) async -> Bool {
        // A message sent after a hand-off starts a turn of its own; the continuation, when it comes, is a run the agent started.
        if let end = waits[run] {
            end(.done)
            return false
        }
        // The gateway runs a send under its key: the turn owns it before its message
        // row can arrive, which would otherwise read as one sent from elsewhere.
        let key = UUID().uuidString
        steers[run, default: []].insert(key)
        guard let sent = try? await request("chat.send", [
            "sessionKey": session, "message": message, "idempotencyKey": key, "queueMode": "steer",
        ]) as? [String: Any] else {
            steers[run]?.remove(key)
            return false
        }
        if let id = sent["runId"] as? String { steers[run, default: []].insert(id) }
        return true
    }

    private func owns(_ run: String, _ id: String?) -> Bool {
        guard let id else { return false }
        return id == run || steers[run]?.contains(id) == true
    }

    func answer(_ question: String, _ answers: [String: [String]]?) async throws {
        try await request("question.resolve", answers.map { ["id": question, "answers": ["answers": $0]] } ?? ["id": question, "cancel": true])
    }

    func allowFullAccess(pending: (String) -> Void) async throws -> Bool {
        try await connected()
        if fullAccess { return true }
        let registered = try await request("device.scopes.requestUpgrade", ["scopes": Array(Set(granted + Self.scopes)).sorted()]) as? [String: Any]
        guard let id = registered?["requestId"] as? String else { throw Failure(code: nil, message: "The gateway didn't take the request.") }
        pending(id)
        let result = try await request("device.scopes.waitUpgrade", ["requestId": id], timeout: 3600) as? [String: Any] ?? [:]
        guard result["status"] as? String == "approved", let token = result["deviceToken"] as? String else { return false }
        secrets.set(Self.deviceTokenName, token)
        secrets.set(Self.scopesName, (result["scopes"] as? [String] ?? []).joined(separator: ","))
        disconnect()
        return true
    }

    nonisolated static func question(_ record: [String: Any]) -> Question? {
        guard let id = record["id"] as? String, record["status"] as? String == "pending" else { return nil }
        let items = (record["questions"] as? [[String: Any]] ?? []).map { q in
            Question.Item(
                id: q["questionId"] as? String ?? "",
                header: q["header"] as? String ?? "",
                question: q["question"] as? String ?? "",
                options: (q["options"] as? [[String: Any]] ?? []).map {
                    Question.Item.Option(label: $0["label"] as? String ?? "", description: $0["description"] as? String)
                },
                multiSelect: q["multiSelect"] as? Bool == true,
                secret: q["isSecret"] as? Bool == true
            )
        }
        return Question(id: id, items: items, expires: Date(timeIntervalSince1970: ((record["expiresAtMs"] as? Double) ?? 0) / 1000))
    }

    func approve(_ id: String, choice: String) async throws {
        let decision = ["always": "allow-always", "deny": "deny"][choice] ?? "allow-once"
        try await request("exec.approval.resolve", ["id": id, "decision": decision])
    }

    nonisolated static func transcript(_ rows: [[String: Any]]) -> [Message] {
        // A yield is the turn waiting, not something it did.
        let unshown = Set(rows.flatMap { row -> [String] in
            let meta = (row["__openclaw"] as? [String: Any])?["toolOutput"] as? [String: Any]
            if row["role"] as? String == "toolResult", meta?["source"] as? String == "provider-response" {
                return [row["toolCallId"] as? String].compactMap(\.self)
            }
            guard row["role"] as? String == "assistant" else { return [] }
            return (row["content"] as? [[String: Any]] ?? [])
                .filter { $0["type"] as? String == "toolCall" && $0["name"] as? String == "sessions_yield" }
                .compactMap { $0["id"] as? String }
        })
        var messages: [Message] = []
        for row in rows {
            switch row["role"] as? String {
            case "user":
                messages.append(Message(role: "user", text: text(row["content"])))
            case "assistant":
                let parts = row["content"] as? [[String: Any]] ?? []
                let steps = parts.filter { $0["type"] as? String == "toolCall" }.compactMap { part -> Step? in
                    let id = part["id"] as? String
                    if let id, unshown.contains(id) { return nil }
                    return Step(id: id, name: stepName(part["name"] as? String ?? "tool", part["arguments"]))
                }
                let said = text(row["content"])
                if !said.isEmpty || !steps.isEmpty { messages.append(Message(role: "assistant", text: said, steps: steps)) }
            case "toolResult":
                guard let id = row["toolCallId"] as? String, !unshown.contains(id),
                      let m = messages.lastIndex(where: { $0.steps.contains { $0.id == id } }),
                      let s = messages[m].steps.firstIndex(where: { $0.id == id })
                else { break }
                let output = text(row["content"])
                messages[m].steps[s].output = output.isEmpty ? (row["isError"] as? Bool == true ? "(failed)" : "(done)") : String(output.prefix(400))
            default:
                break
            }
        }
        return messages
    }

    nonisolated static func text(_ content: Any?) -> String {
        if let text = content as? String { return text }
        return (content as? [[String: Any]] ?? [])
            .filter { $0["type"] as? String == "text" }
            .compactMap { $0["text"] as? String }
            .joined()
    }

    nonisolated static func stepName(_ name: String, _ args: Any?) -> String {
        if name == "tool_call", let wrapped = args as? [String: Any], let inner = wrapped["id"] as? String {
            return stepName(inner, wrapped["args"])
        }
        if ["exec", "bash", "shell"].contains(name), let command = (args as? [String: Any])?["command"] as? String {
            return "Ran \(command.components(separatedBy: "\n").first ?? command)"
        }
        if let label = spawned(name, args).first { return label.map { "Started \($0)" } ?? "Started a subagent" }
        let words = name.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    /** The subagent a tool call started (`sessions_spawn`), by its label when it has one; nothing for any other call. */
    nonisolated static func spawned(_ name: String, _ args: Any?) -> [String?] {
        guard name == "sessions_spawn" else { return [] }
        let label = (args as? [String: Any])?["label"] as? String
        return [label?.isEmpty == false ? label : nil]
    }

    private nonisolated static func sendKey(_ row: [String: Any]) -> String? {
        let key = (row["__openclaw"] as? [String: Any])?["idempotencyKey"] as? String ?? row["idempotencyKey"] as? String
        guard let key else { return nil }
        return key.hasSuffix(":user") ? String(key.dropLast(5)) : key
    }

    // MARK: A turn in the session's rows (extensions/openclaw/core/openclaw.ts: change both together)

    /** A row's run; a delivery (a cron job's announce, the message tool), which no run wrote, is a run of its own. */
    private nonisolated static func runOf(_ row: [String: Any]) -> String? {
        let meta = row["__openclaw"] as? [String: Any]
        if let run = meta?["runId"] as? String { return run }
        guard row["role"] as? String == "assistant", ["delivery-mirror", "automation-result"].contains(row["model"] as? String ?? ""),
              let id = meta?["id"] else { return nil }
        return "delivery:\(id)"
    }

    private nonisolated static func isDelivery(_ row: [String: Any]) -> Bool { runOf(row)?.hasPrefix("delivery:") == true }

    /** Whether the rows end with an accepted `sessions_yield`: the run's continuation hasn't come yet. */
    nonisolated static func waitingOnYield(_ rows: [[String: Any]]) -> Bool {
        guard let at = rows.lastIndex(where: {
            $0["role"] as? String == "toolResult" && $0["toolName"] as? String == "sessions_yield" && text($0["content"]).contains("\"yielded\"")
        }) else { return false }
        let run = runOf(rows[at])
        return rows[(at + 1)...].allSatisfy { $0["role"] as? String == "assistant" && runOf($0) == run && text($0["content"]).isEmpty }
    }

    /**
     * Rows grouped by run into what each turn showed: a run that starts after one that yielded is
     * its continuation, one after a message sent mid-turn (a steer) that message's run; any other
     * is a turn of its own. A message sent after a yield starts a turn of its own, as it does in
     * the chat.
     */
    nonisolated static func runChains(_ rows: [[String: Any]]) -> [[[String: Any]]] {
        var chains: [[[String: Any]]] = []
        var run: String?
        var steered = false
        var last: Int?
        for row in rows {
            // A delivery is a turn of its own that leaves the runs around it as they were.
            if isDelivery(row) {
                chains.append([row])
                continue
            }
            let id = runOf(row) ?? run
            let sent = row["role"] as? String == "user"
            if let last, !(sent && waitingOnYield(chains[last])), id == run || steered || waitingOnYield(chains[last]) {
                chains[last].append(row)
            } else {
                chains.append([row])
                last = chains.count - 1
            }
            if sent { steered = true } else if id != run { steered = false }
            run = id
        }
        return chains
    }

    /**
     * A turn's rows: from its message, its chain. It waits while that ends with a yield nothing has
     * come after: a continuation joins the chain, a message sent since ends the wait. Nil when the
     * session doesn't have the message.
     */
    nonisolated static func turn(in rows: [[String: Any]], run: String) -> (rows: [[String: Any]], waiting: Bool)? {
        guard let sent = rows.lastIndex(where: { $0["role"] as? String == "user" && sendKey($0) == run }) else { return nil }
        let after = Array(rows[(sent + 1)...])
        let chain = runChains(after).first ?? []
        return (chain, waitingOnYield(chain) && after.count { !isDelivery($0) } == chain.count)
    }

    /** The subagents the last run in the rows started: what a turn that yielded there waits on. */
    nonisolated static func spawned(in rows: [[String: Any]]) -> [String?] {
        let run = rows.last.flatMap(runOf)
        return rows.filter { $0["role"] as? String == "assistant" && runOf($0) == run }
            .flatMap { $0["content"] as? [[String: Any]] ?? [] }
            .filter { $0["type"] as? String == "toolCall" }
            .flatMap { spawned($0["name"] as? String ?? "", $0["arguments"]) }
    }

    private struct RunState {
        var found: Bool
        var reply: Reply
        /** Runs going in the session: the turn's, or (while it waits on a yield) its continuation. */
        var active: [String]
        var waiting: Bool
        var spawned: [String?]
    }

    private func state(session: String, run: String) async throws -> RunState {
        let result = try await request("chat.history", ["sessionKey": session, "limit": 200]) as? [String: Any] ?? [:]
        let info = result["sessionInfo"] as? [String: Any] ?? [:]
        let turn = Self.turn(in: result["messages"] as? [[String: Any]] ?? [], run: run)
        let rows = turn?.rows ?? []
        var reply = Reply()
        for message in Self.transcript(rows) where message.role == "assistant" {
            if !message.text.isEmpty { reply.text += (reply.text.isEmpty ? "" : "\n\n") + message.text }
            reply.steps += message.steps
        }
        let waiting = turn?.waiting == true
        let chain = Set(rows.compactMap(Self.runOf))
        let going = info["activeRunIds"] as? [String] ?? (info["hasActiveRun"] as? Bool == true ? [run] : [])
        // While it waits on a yield, the run that starts is its continuation.
        return RunState(found: turn != nil, reply: reply, active: going.filter { owns(run, $0) || chain.contains($0) || waiting },
                        waiting: waiting, spawned: Self.spawned(in: rows))
    }

    /** Sends a message and follows its run. `run` is the idempotency key, and so the run's id. */
    func send(_ message: String, session: String, run: String, attachments: [[String: Any]] = []) -> AsyncStream<Event> {
        follow(session: session, run: run) { [self] in
            var send: [String: Any] = ["sessionKey": session, "message": message, "idempotencyKey": run]
            if !attachments.isEmpty { send["attachments"] = attachments }
            try await request("chat.send", send, timeout: attachments.isEmpty ? 30 : 120)
        }
    }

    func resume(session: String, run: String) -> AsyncStream<Event> {
        follow(session: session, run: run, picking: true, start: nil)
    }

    /**
     * Follows a run until it ends, with the runs its steers start. The gateway
     * sends every connection its sessions' events, so when the socket drops
     * the run is picked up on the next one, and what went unseen is read from
     * the transcript. A run that goes quiet (a long command) is asked after,
     * not given up on. One that hands off with `sessions_yield` isn't over:
     * the turn waits for the run its subagents' or background commands'
     * completion starts, which joins it.
     */
    private func follow(session: String, run: String, picking: Bool = false,
                        start: (() async throws -> Void)?) -> AsyncStream<Event> {
        AsyncStream { continuation in
            let work = Task { @MainActor [self] in
                var base = Reply()
                var live: [(id: String, text: String)] = []
                var liveSteps: [Step] = []
                var seen = Set<String>()
                var finals = Set<String>()
                /** Runs of messages sent to the session meanwhile, from any device: none is the turn's continuation. */
                var sent = Set<String>()
                var spawned: [String?] = []
                var lastShown = Reply()
                var activity = Date()
                var ended = false
                var dropped = false
                var resynced = picking
                var watching = false

                func show() {
                    var reply = base
                    for item in live where !item.text.isEmpty {
                        reply.text += (reply.text.isEmpty ? "" : "\n\n") + item.text
                    }
                    reply.steps += liveSteps
                    guard reply != lastShown else { return }
                    lastShown = reply
                    continuation.yield(.reply(reply))
                }
                func catchUp(_ state: RunState) {
                    base = state.reply
                    live = []
                    liveSteps = []
                    spawned = state.spawned
                    show()
                }
                func finish(_ event: Event) {
                    guard !ended else { return }
                    ended = true
                    continuation.yield(event)
                }
                func startStep(_ id: String?, _ name: String, _ args: Any?) {
                    if id?.hasPrefix("tool_call:") == true { return }
                    if let id { guard seen.insert("\(id):start").inserted else { return } }
                    if name == "sessions_yield" { return }
                    spawned += Self.spawned(name, args)
                    liveSteps.append(Step(id: id, name: Self.stepName(name, args)))
                    show()
                }
                func endStep(_ id: String?, failed: Bool) {
                    if id?.hasPrefix("tool_call:") == true { return }
                    if let id { guard seen.insert("\(id):done").inserted else { return } }
                    guard let i = liveSteps.lastIndex(where: { id == nil ? $0.output == nil : $0.id == id }) else { return }
                    liveSteps[i].output = failed ? "(failed)" : "(done)"
                    show()
                }
                @MainActor func wait() {
                    guard waits[run] == nil else { return }
                    waits[run] = { finish($0) }
                    continuation.yield(.waiting(spawned))
                }
                @MainActor func work() {
                    guard waits.removeValue(forKey: run) != nil else { return }
                    continuation.yield(.working)
                }
                /** A run that continues the turn (after a yield) writes after what's there. */
                @MainActor func adopt(_ id: String) {
                    guard !owns(run, id), !sent.contains(id) else { return }
                    // The runs before it yielded: they're over.
                    finals.formUnion([run] + (steers[run] ?? []))
                    steers[run, default: []].insert(id)
                    work()
                    base = lastShown
                    live = []
                    liveSteps = []
                    spawned = []
                }
                /** Takes the turn to where the gateway says it is: waiting on a yield, or going on in a run that continues it. False when it's over. */
                @MainActor func follows(_ state: RunState) -> Bool {
                    if state.waiting { wait() } else { work() }
                    for id in state.active { adopt(id) }
                    return state.waiting || !state.active.isEmpty
                }
                func settle() async {
                    if let state = try? await state(session: session, run: run), !ended { catchUp(state) }
                    finish(.done)
                }
                @MainActor func settleIfOver() async {
                    guard let state = try? await state(session: session, run: run), !ended, !follows(state) else { return }
                    catchUp(state)
                    finish(.done)
                }
                func watchTranscript() {
                    watching = true
                    Task { @MainActor in _ = try? await request("sessions.messages.subscribe", ["key": session]) }
                }

                let listener = UUID()
                listeners[listener] = { name, payload in
                    guard !ended else { return }
                    switch name {
                    case "exec.approval.requested":
                        let request = payload["request"] as? [String: Any] ?? [:]
                        guard request["sessionKey"] as? String == session, let id = payload["id"] as? String else { return }
                        continuation.yield(.approval(Approval(id: id, command: request["command"] as? String ?? request["commandPreview"] as? String)))
                        return
                    case "exec.approval.resolved":
                        if let id = payload["id"] as? String { continuation.yield(.approvalResolved(id)) }
                        return
                    case "question.requested":
                        guard payload["sessionKey"] as? String == session,
                              payload["runId"] == nil || self.owns(run, payload["runId"] as? String),
                              let question = Self.question(payload) else { return }
                        continuation.yield(.question(question))
                        return
                    case "question.resolved":
                        if let id = payload["id"] as? String { continuation.yield(.questionResolved(id)) }
                        return
                    default:
                        break
                    }
                    guard payload["sessionKey"] as? String == session else { return }
                    // A steer's run may end before its id is back from `chat.send`.
                    if name == "chat", payload["state"] as? String == "final", let id = payload["runId"] as? String { finals.insert(id) }
                    if name == "session.message" {
                        let row = payload["message"] as? [String: Any] ?? [:]
                        if row["role"] as? String == "user", let key = Self.sendKey(row), !self.owns(run, key) {
                            sent.insert(key)
                            // A message sent from elsewhere after a yield ends the turn waiting on it, as one sent here does.
                            if self.waits[run] != nil { finish(.done) }
                            return
                        }
                        guard resynced else { return }
                        let meta = row["__openclaw"] as? [String: Any] ?? [:]
                        if let id = meta["runId"] as? String, !self.owns(run, id) { return }
                        if meta["mirrorOrigin"] != nil { return }
                        activity = Date()
                        if row["role"] as? String == "assistant" {
                            for part in row["content"] as? [[String: Any]] ?? [] where part["type"] as? String == "toolCall" {
                                startStep(part["id"] as? String, part["name"] as? String ?? "tool", part["arguments"])
                            }
                        }
                        return
                    }
                    let data = payload["data"] as? [String: Any] ?? [:]
                    if self.waits[run] != nil, name == "agent", payload["stream"] as? String == "lifecycle", data["phase"] as? String == "start",
                       let id = payload["runId"] as? String { adopt(id) }
                    if let id = payload["runId"] as? String, !self.owns(run, id) { return }
                    activity = Date()
                    switch (name, payload["stream"] as? String, payload["state"] as? String) {
                    case ("agent", "assistant", _):
                        let item = data["itemId"] as? String ?? "text"
                        let index = live.firstIndex { $0.id == item } ?? { live.append((item, "")); return live.count - 1 }()
                        if let text = data["text"] as? String { live[index].text = text }
                        else if data["replace"] as? Bool == true { live[index].text = data["delta"] as? String ?? "" }
                        else { live[index].text += data["delta"] as? String ?? "" }
                        show()
                    case ("agent", "tool", _):
                        let id = data["toolCallId"] as? String
                        if data["phase"] as? String == "start" { startStep(id, data["name"] as? String ?? "tool", data["args"]) }
                        else if data["phase"] as? String == "result" { endStep(id, failed: data["isError"] as? Bool == true) }
                    case ("agent", "item", _):
                        if resynced, data["kind"] as? String == "tool", data["phase"] as? String == "end" {
                            endStep(data["toolCallId"] as? String, failed: data["status"] as? String == "failed")
                        }
                    case ("chat", _, "final"):
                        if payload["yielded"] as? Bool == true {
                            wait()
                            // A message sent meanwhile ends the wait: the session's rows tell of it.
                            if !watching { watchTranscript() }
                        } else {
                            let over = ([run] + (self.steers[run] ?? [])).allSatisfy(finals.contains)
                            Task { over ? await settle() : await settleIfOver() }
                        }
                    case ("chat", _, "aborted"):
                        finish(.failed("Stopped."))
                    case ("chat", _, "error"):
                        finish(.failed(payload["errorMessage"] as? String ?? "The run failed."))
                    default:
                        break
                    }
                }
                let closer = UUID()
                closeListeners[closer] = { dropped = true }
                defer {
                    listeners[listener] = nil
                    closeListeners[closer] = nil
                    steers[run] = nil
                    waits[run] = nil
                    if watching { Task { @MainActor in _ = try? await request("sessions.messages.unsubscribe", ["key": session]) } }
                    continuation.finish()
                }

                do {
                    try await connected()
                    if let start {
                        try await start()
                    } else {
                        let state = try await state(session: session, run: run)
                        guard state.found else { return finish(.failed("OpenClaw never got this message; send it again.")) }
                        catchUp(state)
                        guard follows(state) else { return finish(.done) }
                        watchTranscript()
                        await askPending(session: session, run: run) { continuation.yield($0) }
                    }
                } catch let failure as Failure where failure.code == "unreachable" || failure.code == "timeout" {
                    return finish(picking ? .detached : .failed("Can't reach the gateway. Are you on Tailscale?"))
                } catch {
                    return finish(.failed(error.localizedDescription))
                }

                while !ended && !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(1))
                    if ended || Task.isCancelled { break }
                    if dropped {
                        dropped = false
                        var back = false
                        for delay in Self.reconnectDelays where !ended && !Task.isCancelled {
                            try? await Task.sleep(for: .seconds(delay))
                            guard let state = try? await state(session: session, run: run) else { continue }
                            resynced = true
                            catchUp(state)
                            if follows(state) {
                                watchTranscript()
                                await askPending(session: session, run: run) { continuation.yield($0) }
                            } else { finish(.done) }
                            back = true
                            break
                        }
                        if !back { finish(.detached) }
                        activity = Date()
                    } else if Date().timeIntervalSince(activity) > Self.quietSeconds {
                        activity = Date()
                        await settleIfOver()
                    }
                }
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }

    /** What a session waits on you for, whoever started the run that asks (a scheduled task's, another device's). */
    func pending(session: String) async -> [Event] {
        var asks: [Event] = []
        let approvals = (try? await request("exec.approval.list", [:])) as? [[String: Any]] ?? []
        for approval in approvals {
            let request = approval["request"] as? [String: Any] ?? [:]
            guard request["sessionKey"] as? String == session, let id = approval["id"] as? String else { continue }
            asks.append(.approval(Approval(id: id, command: request["command"] as? String ?? request["commandPreview"] as? String)))
        }
        let questions = ((try? await request("question.list", [:])) as? [String: Any])?["questions"] as? [[String: Any]] ?? []
        for record in questions where record["sessionKey"] as? String == session {
            if let question = Self.question(record) { asks.append(.question(question)) }
        }
        return asks
    }

    private func askPending(session: String, run: String, _ ask: (Event) -> Void) async {
        let approvals = (try? await request("exec.approval.list", [:])) as? [[String: Any]] ?? []
        for approval in approvals {
            let request = approval["request"] as? [String: Any] ?? [:]
            guard request["sessionKey"] as? String == session, let id = approval["id"] as? String else { continue }
            ask(.approval(Approval(id: id, command: request["command"] as? String ?? request["commandPreview"] as? String)))
        }
        // Needs `operator.questions`, which an iPhone paired before may not have yet.
        let questions = ((try? await request("question.list", [:])) as? [String: Any])?["questions"] as? [[String: Any]] ?? []
        for record in questions where record["sessionKey"] as? String == session {
            if record["runId"] != nil, !owns(run, record["runId"] as? String) { continue }
            if let question = Self.question(record) { ask(.question(question)) }
        }
    }
}
