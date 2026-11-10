import Foundation

nonisolated struct Hermes {
    let baseURL: String
    let key: String

    struct Failure: LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    struct Model: Identifiable, Hashable {
        var slug: String
        var name: String
        var subProvider: String?
        var isDefault: Bool
        var reasoning: Bool
        var canDisableReasoning: Bool
        var fast: Bool
        var id: String { slug.isEmpty ? name : slug }
        var shortName: String { name.split(separator: "/").last.map(String.init) ?? name }
    }

    struct Session: Identifiable, Hashable {
        var id: String
        var title: String?
        var preview: String?
        var lastActive: Date
        var messageCount: Int
    }

    struct Message {
        var role: String
        var text: String
        var tools: [String]
    }

    enum Event {
        case run(String)
        case delta(String)
        case tool(String)
        case toolResult(String)
        case approval(id: String, command: String?, reason: String?, choices: [String])
        case completed(returnedSteer: String?)
        case failed(String)
    }

    static func normalized(_ raw: String) -> String {
        var trimmed = raw.trimmingCharacters(in: .whitespaces)
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        return trimmed.lowercased().hasSuffix("/v1") ? trimmed : "\(trimmed)/v1"
    }

    private var root: String { String(baseURL.dropLast(3)) }

    func check() async throws -> (models: [Model], sessions: Bool) {
        let (data, response) = try await send("GET", "\(baseURL)/models", timeout: 6)
        if response.statusCode == 401 { throw Failure(message: "The API key was rejected.") }
        guard response.statusCode == 200 else {
            throw Failure(message: "The server answered \(response.statusCode). Is that the API server's URL?")
        }
        let agentModels = ((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [[String: Any]] ?? [])
            .compactMap { $0["id"] as? String }
        async let sessions = (try? await send("GET", "\(root)/api/sessions?limit=1", timeout: 6).1.statusCode) == 200
        async let catalog = catalog()
        let models = await catalog
        return (models.isEmpty ? agentModels.map { Model(slug: "", name: $0, isDefault: true, reasoning: false, canDisableReasoning: false, fast: false) } : models, await sessions)
    }

    private func catalog() async -> [Model] {
        guard
            let (data, response) = try? await send("GET", "\(root)/api/model/options", timeout: 6),
            response.statusCode == 200,
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [] }
        let current = (body["provider"] as? String, body["model"] as? String)
        let shared = body["capabilities"] as? [String: [String: Bool]] ?? [:]
        var models: [Model] = []
        for provider in body["providers"] as? [[String: Any]] ?? [] {
            guard let slug = provider["slug"] as? String, provider["authenticated"] as? Bool != false else { continue }
            let name = provider["name"] as? String ?? slug
            let caps = provider["capabilities"] as? [String: [String: Bool]] ?? [:]
            for raw in provider["models"] as? [Any] ?? [] {
                let object = raw as? [String: Any]
                let id = raw as? String ?? object?["id"] as? String ?? object?["slug"] as? String ?? ""
                guard !id.isEmpty else { continue }
                let cap = caps[id] ?? shared[id] ?? [:]
                models.append(Model(
                    slug: "\(slug)::\(id)",
                    name: id == "default" ? name : object?["name"] as? String ?? id,
                    subProvider: name,
                    isDefault: current.0 == slug && current.1 == id,
                    reasoning: cap["reasoning"] ?? false,
                    canDisableReasoning: cap["can_disable_reasoning"] ?? false,
                    fast: cap["fast"] ?? false
                ))
            }
        }
        return models
    }

    func sessions(limit: Int = 50) async throws -> [Session] {
        let (data, response) = try await send("GET", "\(root)/api/sessions?limit=\(limit)")
        guard response.statusCode == 200 else { throw Failure(message: Self.error(data, response)) }
        let rows = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return rows.compactMap(Self.session)
    }

    func messages(of session: String) async throws -> [Message] {
        let (data, response) = try await send("GET", "\(root)/api/sessions/\(session)/messages?order=oldest&limit=500")
        guard response.statusCode == 200 else { throw Failure(message: Self.error(data, response)) }
        let rows = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return rows.map { row in
            let tools = (row["tool_calls"] as? [[String: Any]] ?? []).compactMap {
                ($0["function"] as? [String: Any])?["name"] as? String ?? $0["name"] as? String
            }
            return Message(role: row["role"] as? String ?? "system", text: Self.text(row["content"]), tools: tools)
        }
    }

    func delete(session: String) async throws {
        let (data, response) = try await send("DELETE", "\(root)/api/sessions/\(session)")
        guard response.statusCode == 200 || response.statusCode == 204 || response.statusCode == 404 else {
            throw Failure(message: Self.error(data, response))
        }
    }

    /** A new, empty session the turn then streams into (titles are unique, so a clash drops it). */
    func createSession(title: String?) async throws -> String {
        func attempt(_ title: String?) async throws -> (Data, HTTPURLResponse) {
            var body: [String: Any] = ["source": "api_server"]
            if let title { body["title"] = title }
            return try await send("POST", "\(root)/api/sessions", json: body)
        }
        var (data, response) = try await attempt(title)
        if response.statusCode == 400, title != nil { (data, response) = try await attempt(nil) }
        guard (200..<300).contains(response.statusCode),
              let session = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["session"] as? [String: Any],
              let id = Self.session(session)?.id
        else { throw Failure(message: Self.error(data, response)) }
        return id
    }

    /** `message` is the text, or the content parts it's sent with (an image, as the Responses API takes one). */
    func turn(session: String, message: Any, model: [String: Any]) -> AsyncThrowingStream<Event, Error> {
        var request = URLRequest(url: URL(string: "\(root)/api/sessions/\(session)/chat/stream")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = try? JSONSerialization.data(withJSONObject: model.merging(["message": message]) { a, _ in a })
        return AsyncThrowingStream { [request] continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    guard status == 200 else {
                        throw Failure(message: status == 401 ? "The API key was rejected." : status == 404 ? "This chat is gone from Hermes." : "Hermes answered \(status).")
                    }
                    var event: String?
                    var streamed = false
                    var finished = false
                    for try await line in bytes.lines {
                        if line.hasPrefix("event:") {
                            event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                            continue
                        }
                        guard line.hasPrefix("data:"),
                              let payload = try? JSONSerialization.jsonObject(with: Data(line.dropFirst(5).utf8)) as? [String: Any]
                        else { continue }
                        let name = event ?? payload["type"] as? String ?? payload["event"] as? String ?? ""
                        event = nil
                        if let run = payload["run_id"] as? String { continuation.yield(.run(run)) }
                        switch name {
                        case "assistant.delta":
                            let text = payload["delta"] as? String ?? payload["text"] as? String ?? ""
                            if !text.isEmpty { streamed = true; continuation.yield(.delta(text)) }
                        case "assistant.commentary":
                            guard payload["already_streamed"] as? Bool != true else { break }
                            let text = (payload["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                            if !text.isEmpty { continuation.yield(.delta("\(streamed ? "\n\n" : "")\(text)\n\n")) }
                            streamed = true
                        case "assistant.completed":
                            let text = payload["content"] as? String ?? ""
                            if !streamed, !text.isEmpty { streamed = true; continuation.yield(.delta(text)) }
                        case "tool.started":
                            continuation.yield(.tool(payload["tool_name"] as? String ?? payload["tool"] as? String ?? "tool"))
                        case "tool.completed", "tool.failed":
                            let preview = String((payload["preview"] as? String ?? "").prefix(400))
                            continuation.yield(.toolResult(preview.isEmpty ? (name == "tool.failed" ? "(failed)" : "(done)") : preview))
                        case "approval.request":
                            guard let id = payload["request_id"] as? String else { break }
                            continuation.yield(.approval(
                                id: id,
                                command: payload["command"] as? String,
                                reason: payload["description"] as? String,
                                choices: payload["choices"] as? [String] ?? ["once", "session", "always", "deny"]
                            ))
                        case "run.completed":
                            finished = true
                            let steer = (payload["pending_steer"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                            continuation.yield(.completed(returnedSteer: steer?.isEmpty == false ? steer : nil))
                        case "run.failed", "error":
                            finished = true
                            let reason = payload["turn_exit_reason"] as? String ?? payload["message"] as? String
                            continuation.yield(.failed(reason ?? "The agent ran into an error."))
                        case "run.cancelled":
                            finished = true
                            continuation.yield(.failed("Stopped."))
                        default:
                            break
                        }
                    }
                    if !finished { continuation.yield(.failed("Hermes dropped the connection.")) }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    func stop(run: String) async {
        _ = try? await send("POST", "\(root)/v1/runs/\(run)/stop")
    }

    func steer(run: String, _ message: String) async -> Bool {
        (try? await send("POST", "\(root)/v1/runs/\(run)/steer", json: ["message": message]).1.statusCode) == 200
    }

    func approve(run: String, request: String, choice: String) async throws {
        let (data, response) = try await send("POST", "\(root)/v1/runs/\(run)/approval", json: ["choice": choice, "request_id": request])
        guard (200..<300).contains(response.statusCode) || response.statusCode == 409 else {
            throw Failure(message: Self.error(data, response))
        }
    }

    private func send(_ method: String, _ url: String, json: [String: Any]? = nil, timeout: TimeInterval = 30) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: url) else { throw Failure(message: "That isn't a URL.") }
        var request = URLRequest(url: url, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if let json {
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, response as! HTTPURLResponse)
    }

    private static func error(_ data: Data, _ response: HTTPURLResponse) -> String {
        ((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? [String: Any])?["message"] as? String
            ?? "Hermes answered \(response.statusCode)."
    }

    private static func session(_ raw: [String: Any]) -> Session? {
        guard let id = (raw["id"] as? String) ?? (raw["id"] as? Int).map(String.init) else { return nil }
        let seconds = { (value: Any?) -> Double? in
            if let n = value as? Double { return n > 1e12 ? n / 1000 : n }
            if let s = value as? String { return (try? Date(s, strategy: .iso8601))?.timeIntervalSince1970 ?? Double(s) }
            return nil
        }
        return Session(
            id: id,
            title: raw["title"] as? String,
            preview: raw["preview"] as? String,
            lastActive: Date(timeIntervalSince1970: seconds(raw["last_active"]) ?? seconds(raw["started_at"]) ?? 0),
            messageCount: raw["message_count"] as? Int ?? 0
        )
    }

    private static func text(_ content: Any?) -> String {
        if let text = content as? String { return text }
        if let parts = content as? [Any] {
            return parts.map { part in
                if let text = part as? String { return text }
                guard let part = part as? [String: Any], ["text", "output_text", "input_text"].contains(part["type"] as? String ?? "") else { return "" }
                return part["text"] as? String ?? ""
            }.joined()
        }
        return (content as? [String: Any])?["text"] as? String ?? ""
    }
}
