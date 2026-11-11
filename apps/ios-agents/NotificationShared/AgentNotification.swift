import Foundation

enum AgentNotification {
    nonisolated static func pointer(_ metadata: [String: Any], configuration: AgentNotificationState.Configuration?) -> AgentPointer? {
        guard let configuration, metadata["version"] as? Int == 1, metadata["kind"] as? String == "agent",
              metadata["userId"] as? String == configuration.userId,
              let object = metadata["pointer"] as? [String: Any], let pointer = AgentPointer(object),
              let session = pointer.sessionKey, !session.isEmpty else { return nil }
        return pointer
    }

    nonisolated struct Detail: Equatable, Sendable {
        var title: String?
        var text: String?
    }

    nonisolated struct Preview: Equatable, Sendable {
        var title: String
        var subtitle: String
        var body: String
    }

    nonisolated static func preview(_ pointer: AgentPointer, configuration: AgentNotificationState.Configuration, detail: Detail? = nil) -> Preview {
        let name = pointer.sessionKey?.hasPrefix("agent:") == true
            ? configuration.agentNames[pointer.agentId] ?? "OpenClaw"
            : pointer.agentId == configuration.varysAgentId ? "varys" : "Hermes"
        let title = [pointer.sessionKey.flatMap { configuration.titles[$0] }, detail?.title, name]
            .compactMap { $0 }.map { plain($0, limit: 200) }.first { !$0.isEmpty } ?? name
        let status: String
        let fallback: String
        switch pointer.kind {
        case "approval":
            status = "Approval needed"
            fallback = "Open the chat to review the request."
        case "question":
            status = "Question"
            fallback = "Open the chat to answer."
        case "finished":
            status = "Finished"
            fallback = "Open the chat to read the reply."
        default:
            status = "New message"
            fallback = "Open the chat to read the message."
        }
        let body = plain(detail?.text ?? "", limit: 500)
        return Preview(title: title, subtitle: title == name ? status : "\(name) · \(status)", body: body.isEmpty || ["NO_REPLY", "HEARTBEAT_OK"].contains(body) ? fallback : body)
    }

    nonisolated static func plain(_ text: String, limit: Int) -> String {
        let text = text.replacingOccurrences(of: #"(?m)^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+|>\s*)"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?m)^\s*```[^\n]*"#, with: "", options: .regularExpression)
        let parsed = (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            .map { String($0.characters) } ?? text
        let plain = parsed.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard plain.count > limit else { return plain }
        return String(plain.prefix(max(0, limit - 1))) + "…"
    }

    static func read(_ pointer: AgentPointer, configuration: AgentNotificationState.Configuration) async throws -> Detail? {
        guard AgentNotificationState.configuration() == configuration,
              let session = pointer.sessionKey, !session.isEmpty else { return nil }
        if session.hasPrefix("agent:"), let address = configuration.openClawURL, let url = URL(string: address) {
            let client = OpenClaw(url: url, secrets: .init(
                get: { AgentNotificationState.configuration() == configuration ? Keychain.get($0) : nil },
                set: { if AgentNotificationState.configuration() == configuration { Keychain.set($0, $1, thisDeviceOnly: true) } }
            ), appVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0")
            defer { client.disconnect() }
            return try await withTaskCancellationHandler {
                try await openClaw(pointer) { method, params in
                    try await client.request(method, params, timeout: 6)
                }
            } onCancel: {
                Task { @MainActor in client.disconnect() }
            }
        }
        if pointer.agentId == configuration.varysAgentId, let address = configuration.varysAddress, let token = Keychain.get(Varys.tokenName) {
            let client = Varys(address: address, agentId: pointer.agentId, token: token)
            defer { client.disconnect() }
            let view = try await client.read("thread", .object(["id": .string(session)]))
            if pointer.kind == "approval" || pointer.kind == "question" {
                let inbox = try await client.read("inbox", .object([:]))
                return varys(pointer, view: view, inbox: inbox)
            }
            return varys(pointer, view: view)
        }
        if let address = configuration.hermesURL, !session.hasPrefix("agent:"), pointer.agentId != configuration.varysAgentId,
           let key = Keychain.get("hermes-key"), pointer.kind == "message" || pointer.kind == "finished" {
            let client = Hermes(baseURL: Hermes.normalized(address), key: key)
            async let title = client.title(of: session)
            let messages = try await client.messages(of: session.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
            return Detail(title: await title, text: messages.last.flatMap { $0.role == "assistant" ? $0.text : nil })
        }
        return nil
    }

    nonisolated static func varys(_ pointer: AgentPointer, view: Varys.JSON, inbox: Varys.JSON? = nil) -> Detail {
        let title = view["title"]?.string
        if pointer.kind == "approval" || pointer.kind == "question" {
            let id = pointer.approvalId ?? pointer.questionId
            let item = inbox?["items"]?.array?.first { $0["id"]?.string == id && $0["threadId"]?.string == pointer.sessionKey }
            return Detail(title: title, text: item?["text"]?.string ?? item?["presentation"]?["title"]?.string ?? item?["headline"]?.string)
        }
        let messages = Varys.messages(view["conversation"]?["items"]?.array ?? [])
        return Detail(title: title, text: messages.last.flatMap { $0.role == "assistant" ? $0.text : nil })
    }

    static func openClaw(_ pointer: AgentPointer, request: (String, [String: Any]) async throws -> Any?) async throws -> Detail? {
        guard let session = pointer.sessionKey else { return nil }
        switch pointer.kind {
        case "approval":
            guard let id = pointer.approvalId else { return nil }
            if let subscribed = try? await request("sessions.messages.subscribe", ["key": session, "includeApprovals": true]) as? [String: Any] {
                let replay = subscribed["approvalReplay"] as? [String: Any]
                let snapshot = (replay?["approvals"] as? [[String: Any]])?.first { $0["id"] as? String == id && $0["status"] as? String == "pending" }
                let presentation = snapshot?["presentation"] as? [String: Any]
                return Detail(text: presentation?["commandText"] as? String ?? presentation?["description"] as? String ?? presentation?["title"] as? String)
            }
            let approvals = try await request("exec.approval.list", [:]) as? [[String: Any]] ?? []
            let approval = approvals.first { $0["id"] as? String == id && ($0["request"] as? [String: Any])?["sessionKey"] as? String == session }
            let proposed = approval?["request"] as? [String: Any]
            return Detail(text: proposed?["command"] as? String ?? proposed?["commandPreview"] as? String)
        case "question":
            guard let id = pointer.questionId else { return nil }
            let result = try await request("question.list", [:]) as? [String: Any]
            let record = (result?["questions"] as? [[String: Any]])?.first { $0["id"] as? String == id && $0["sessionKey"] as? String == session }
            let question = record.flatMap(OpenClaw.question)
            return Detail(text: question?.items.map(\.question).joined(separator: " "))
        default:
            let result = try await request("chat.history", ["sessionKey": session, "limit": 40]) as? [String: Any] ?? [:]
            let messages = OpenClaw.transcript(result["messages"] as? [[String: Any]] ?? [])
            let info = result["sessionInfo"] as? [String: Any]
            let title = [info?["title"], info?["displayName"], info?["label"]].compactMap { $0 as? String }.first { !$0.isEmpty }
            return Detail(title: title, text: messages.last.flatMap { $0.role == "assistant" ? $0.text : nil })
        }
    }
}
