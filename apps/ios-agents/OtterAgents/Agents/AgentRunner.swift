import Foundation

/** A message on its way to an agent. */
struct OutgoingTurn {
    var requestId: String
    /** The agent's id. */
    var provider: String
    var input: String
    var sessionId: String?
    var title: String?
    var skill: Skill?
    var attachments: [Attachment] = []
}

/**
 * Runs turns on the agents: one at a time in a chat, any number of chats at once. Each agent
 * speaks its own protocol (the clients shared with Otter Mail); what they say comes out as
 * `ChatEvent`s, as core's providers emit them on the Mac and the web.
 */
final class AgentRunner {
    private struct Run {
        var agent: String
        var sessionId: String?
        /** Hermes's own id for the run, which stopping, steering and approving name. */
        var hermesRun: String?
        var task: Task<Void, Never>?
    }

    private let agents: Agents
    private var runs: [String: Run] = [:]

    init(agents: Agents) { self.agents = agents }

    typealias Emit = (ChatEvent) -> Void

    func send(_ turn: OutgoingTurn, emit: @escaping Emit) {
        runs[turn.requestId] = Run(agent: turn.provider, sessionId: turn.sessionId)
        let task = Task { [self] in
            let agent = agents.agent(turn.provider)
            if agents.demo { await DemoAgent.run(turn, emit: emit) } else {
                switch agent?.kind {
                case .hermes: await sendHermes(agent!, turn, emit)
                case .openclaw: await sendOpenClaw(agent!, turn, emit)
                case .varys: await sendVarys(agent!, turn, emit)
                case nil: emit(.error("not_configured"))
                }
            }
            runs[turn.requestId] = nil
        }
        runs[turn.requestId]?.task = task
    }

    /** Picks up a turn the app left. False when the agent can't, or isn't reachable now. */
    func resume(agent id: String, requestId: String, sessionId: String, emit: @escaping Emit) -> Bool {
        guard runs[requestId] == nil else { return true }
        guard let agent = agents.agent(id), agent.isUsable else { return false }
        let events: AsyncStream<ChatEvent>
        switch agent.kind {
        case .openclaw:
            guard let gateway = agent.openClaw else { return false }
            events = Self.openClaw(gateway.resume(session: sessionId, run: requestId))
        case .varys:
            guard let client = agent.varys else { return false }
            events = Self.varys(client.resume(thread: sessionId, requestId: requestId))
        default:
            return false
        }
        runs[requestId] = Run(agent: id, sessionId: sessionId)
        runs[requestId]?.task = Task { [self] in
            for await event in events { emit(event) }
            runs[requestId] = nil
        }
        return true
    }

    func isRunning(_ requestId: String) -> Bool { runs[requestId] != nil }

    /** Whether one of the agent's runs is the turn's already: its own, or one its steers started. */
    func owns(_ requestId: String, run: String) -> Bool {
        runs[requestId]?.provider == "openclaw" && agents.openClawClient?.owns(requestId, run) == true
    }

    func cancel(_ requestId: String) {
        guard let run = runs[requestId] else { return }
        let agent = agents.agent(run.agent)
        if agents.demo {
            run.task?.cancel()
            return
        }
        switch agent?.kind {
        case .hermes:
            if let id = run.hermesRun, let client = agent?.hermes { Task { await client.stop(run: id) } }
            else { run.task?.cancel() }
        case .openclaw:
            if let session = run.sessionId, let gateway = agent?.openClaw { Task { await gateway.abort(session: session, run: requestId) } }
        case .varys:
            if let session = run.sessionId, let client = agent?.varys { Task { try? await client.stop(thread: session) } }
        case nil:
            run.task?.cancel()
        }
    }

    /** Leaves every turn where it is, without stopping the agents: the app is going to the background. */
    func detachAll(emit: (String, ChatEvent) -> Void) {
        for (requestId, run) in runs where agents.agent(run.agent)?.kind?.resumes == true {
            run.task?.cancel()
            runs[requestId] = nil
            emit(requestId, .error(AgentError.detached))
        }
    }

    /** A message for the turn in flight. False when the agent can't take it now. */
    func steer(_ requestId: String, _ text: String) async -> Bool {
        guard let run = runs[requestId] else { return false }
        if agents.demo { return true }
        let agent = agents.agent(run.agent)
        switch agent?.kind {
        case .hermes:
            guard let id = run.hermesRun, let client = agent?.hermes else { return false }
            return await client.steer(run: id, text)
        case .openclaw:
            guard let session = run.sessionId, let gateway = agent?.openClaw else { return false }
            return await gateway.steer(session: session, run: requestId, text)
        case .varys:
            guard let session = run.sessionId, let client = agent?.varys else { return false }
            return await client.steer(text, thread: session)
        case nil: return false
        }
    }

    func respond(_ approval: Approval, _ decision: String, requestId: String) async throws {
        guard let run = runs[requestId] else { return }
        if agents.demo { return DemoAgent.answer(approval.id, decision) }
        if agents.agent(run.agent)?.kind == .hermes {
            guard let id = run.hermesRun, let client = agents.agent(run.agent)?.hermes else { return }
            try await client.approve(run: id, request: approval.id, choice: decision)
        } else {
            try await respond(approval, decision, agent: run.agent)
        }
    }

    func answer(_ question: Question, _ answers: [String: [String]]?, requestId: String) async throws {
        guard let run = runs[requestId] else { return }
        if agents.demo { return DemoAgent.answer(question.id, answers?.values.flatMap(\.self).joined(separator: ", ") ?? "") }
        let agent = agents.agent(run.agent)
        switch agent?.kind {
        case .openclaw: try await agent?.openClaw?.answer(question.id, answers)
        case .varys:
            // A varys question is answered in words; skipped, it stays in varys's inbox, to answer there.
            let text = answers?[question.id]?.joined(separator: ", ").trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !text.isEmpty { try await agent?.varys?.answer(question.id, text) }
        default: break
        }
    }

    // MARK: What an agent asks outside a turn followed here

    /** What a chat's session waits on you for, whoever's run asks: a scheduled task's, another device's. */
    func pending(agent id: String, session: String) async -> (approvals: [Approval], questions: [Question]) {
        guard let agent = agents.agent(id), agent.kind == .openclaw, agent.isUsable, let gateway = agent.openClaw else { return ([], []) }
        var approvals: [Approval] = [], questions: [Question] = []
        for event in await gateway.pending(session: session) {
            switch event {
            case .approval(let approval):
                approvals.append(Approval(id: approval.id, kind: approval.command == nil ? "tool" : "command", detail: approval.command, choices: ["once", "always", "deny"]))
            case .question(let question): questions.append(question)
            default: break
            }
        }
        return (approvals, questions)
    }

    func respond(_ approval: Approval, _ decision: String, agent id: String) async throws {
        let agent = agents.agent(id)
        switch agent?.kind {
        case .openclaw: try await agent?.openClaw?.approve(approval.id, choice: decision)
        case .varys: try await agent?.varys?.decide(approval.id, approve: decision != "deny", inThread: decision == "session")
        default: break
        }
    }

    func answer(_ question: Question, _ answers: [String: [String]]?, agent id: String) async throws {
        if let agent = agents.agent(id), agent.kind == .openclaw { try await agent.openClaw?.answer(question.id, answers) }
    }

    // MARK: Each agent

    private static let hermesTextTypes = try! NSRegularExpression(pattern: "^(text/|application/(json|xml)|message/rfc822)")

    /** Attachments ride as content parts: images inline, text documents as text. Hermes's API refuses other documents. */
    private static func hermesContent(_ input: String, _ attachments: [Attachment]) throws -> Any {
        if attachments.isEmpty { return input }
        let isText = { (mime: String) in hermesTextTypes.firstMatch(in: mime, range: NSRange(mime.startIndex..., in: mime)) != nil }
        let unsupported = attachments.filter { !$0.isImage && !isText($0.mime) }
        if !unsupported.isEmpty {
            throw Hermes.Failure(message: "Hermes can't read \(unsupported.map(\.name).joined(separator: ", ")): its API takes images and text files only.")
        }
        let images = attachments.filter(\.isImage)
        if images.reduce(0, { $0 + $1.size }) > 7 * 1024 * 1024 {
            throw Hermes.Failure(message: "Those images are too large for Hermes together (7 MB max per message).")
        }
        var text = input
        for file in attachments where !file.isImage {
            text += "\n\n--- \(file.name) ---\n\(String(decoding: file.data, as: UTF8.self))"
        }
        if text.utf8.count > 60 * 1024 { throw Hermes.Failure(message: "The attached text is too long for Hermes (about 60 KB per message).") }
        return [["type": "text", "text": text.isEmpty ? "See the attached image." : text] as [String: Any]]
            + images.map { ["type": "image_url", "image_url": ["url": "data:\($0.mime);base64,\($0.data.base64EncodedString())"]] as [String: Any] }
    }

    private func sendHermes(_ agent: Agent, _ turn: OutgoingTurn, _ emit: @escaping Emit) async {
        guard let client = agent.hermes else { return emit(.error("not_configured")) }
        let input = turn.skill.map { skill in
            "[IMPORTANT: The user invoked the \"\(skill.name)\" skill. Load it with skill_view and follow its instructions.]" + (turn.input.isEmpty ? "" : "\n\n\(turn.input)")
        } ?? turn.input
        let message: Any
        do { message = try Self.hermesContent(input, turn.attachments) } catch { return emit(.error("agent_error: \(error.localizedDescription)")) }
        var ended = false
        do {
            let session: String
            if let existing = turn.sessionId { session = existing } else {
                session = try await client.createSession(title: turn.title.map { String($0.prefix(60)) })
                runs[turn.requestId]?.sessionId = session
                emit(.session(session))
            }
            for try await event in client.turn(session: session, message: message, model: agent.hermesModelFields) {
                switch event {
                case .run(let id): runs[turn.requestId]?.hermesRun = id
                case .delta(let text): emit(.delta(text))
                case .tool(let name): emit(.tool(id: nil, Self.step(named: name)))
                case .toolResult(let output): emit(.toolResult(id: nil, output))
                case .approval(let id, let command, let reason, let choices):
                    emit(.approval(Approval(id: id, kind: "command", detail: command, reason: reason, choices: choices)))
                case .completed(let steer):
                    if let steer { emit(.steerReturned(steer)) }
                    if turn.sessionId == nil, let title = await client.title(of: session) { emit(.title(title)) }
                    ended = true
                    emit(.done)
                case .failed(let message):
                    ended = true
                    emit(.error(message == "Stopped." ? "cancelled" : "agent_error: \(message)"))
                }
            }
            if !ended { emit(.error("agent_error: \(agent.name) dropped the connection.")) }
        } catch is CancellationError {
            if !ended { emit(.error("cancelled")) }
        } catch {
            if !ended { emit(.error(Task.isCancelled ? "cancelled" : (error is URLError ? "unreachable" : "agent_error: \(error.localizedDescription)"))) }
        }
    }

    private func sendOpenClaw(_ agent: Agent, _ turn: OutgoingTurn, _ emit: @escaping Emit) async {
        guard let gateway = agent.openClaw else { return emit(.error("not_configured")) }
        let first = turn.sessionId == nil
        let session = turn.sessionId ?? "agent:\(agent.model?.slug ?? "main"):otter-mail:\(UUID().uuidString.lowercased())"
        if first {
            runs[turn.requestId]?.sessionId = session
            emit(.session(session))
            Task {
                guard let agent = session.split(separator: ":").dropFirst().first,
                      let made = try? await gateway.request("sessions.title.prepare", ["agentId": String(agent), "message": String(turn.input.prefix(1000))], timeout: 90) as? [String: Any],
                      let title = made["title"] as? String, !title.isEmpty else { return }
                emit(.title(title))
                _ = try? await gateway.request("sessions.patch", ["key": session, "label": title])
            }
        }
        let attachments = turn.attachments.map {
            ["type": $0.isImage ? "image" : "file", "mimeType": $0.mime, "fileName": $0.name, "content": $0.data.base64EncodedString()] as [String: Any]
        }
        for await event in Self.openClaw(gateway.send(turn.input, session: session, run: turn.requestId, attachments: attachments)) { emit(event) }
    }

    private static func openClaw(_ events: AsyncStream<OpenClaw.Event>) -> AsyncStream<ChatEvent> {
        AsyncStream { continuation in
            let task = Task {
                for await event in events {
                    switch event {
                    case .reply(let reply):
                        continuation.yield(.reply(text: reply.text, steps: reply.steps.map { ($0.id, step(named: $0.name), $0.output) }))
                    case .approval(let approval):
                        continuation.yield(.approval(Approval(id: approval.id, kind: approval.command == nil ? "tool" : "command",
                                                              detail: approval.command, choices: ["once", "always", "deny"])))
                    case .approvalResolved(let id): continuation.yield(.approvalResolved(id))
                    case .question(let question): continuation.yield(.question(question))
                    case .questionResolved(let id): continuation.yield(.questionResolved(id))
                    case .waiting(let subagents): continuation.yield(.waiting(subagents))
                    case .working: continuation.yield(.working)
                    case .done: continuation.yield(.done)
                    case .failed(let message): continuation.yield(.error(message == "Stopped." ? "cancelled" : "agent_error: \(message)"))
                    case .detached: continuation.yield(.error(AgentError.detached))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func sendVarys(_ agent: Agent, _ turn: OutgoingTurn, _ emit: @escaping Emit) async {
        guard let client = agent.varys else { return emit(.error("not_configured")) }
        let first = turn.sessionId == nil
        let thread = turn.sessionId ?? UUID().uuidString.lowercased()
        if first {
            runs[turn.requestId]?.sessionId = thread
            emit(.session(thread))
        }
        // A message picks a skill by naming it; varys's model loads it as it loads any skill it needs.
        let text = turn.skill.map { "Use the skill `\($0.name)`." + (turn.input.isEmpty ? "" : "\n\n\(turn.input)") } ?? turn.input
        for await event in Self.varys(client.send(text, thread: thread, requestId: turn.requestId, first: first)) { emit(event) }
    }

    private static func varys(_ events: AsyncStream<Varys.Event>) -> AsyncStream<ChatEvent> {
        AsyncStream { continuation in
            let task = Task {
                for await event in events {
                    switch event {
                    case .reply(let reply):
                        continuation.yield(.reply(text: reply.text, steps: reply.steps.map { ($0.id, step(named: $0.name), $0.output) }))
                    case .approval(let approval):
                        continuation.yield(.approval(Approval(id: approval.id, kind: "permission", title: approval.title, detail: approval.detail, reason: approval.why,
                                                              choices: approval.inThread ? ["once", "session", "deny"] : ["once", "deny"])))
                    case .question(let question):
                        continuation.yield(.question(Question(
                            id: question.id,
                            items: [.init(id: question.id, header: "", question: question.text, options: [], multiSelect: false, secret: false)],
                            expires: question.deadline ?? .distantFuture)))
                    case .resolved(let id):
                        continuation.yield(.approvalResolved(id))
                        continuation.yield(.questionResolved(id))
                    case .done: continuation.yield(.done)
                    case .stopped: continuation.yield(.error("cancelled"))
                    case .failed(let message): continuation.yield(.error("agent_error: \(message)"))
                    case .detached: continuation.yield(.error(AgentError.detached))
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /** A step from its name alone, as the agents that only name their tools tell it. */
    nonisolated static func step(named name: String) -> ChatStep {
        let lower = name.lowercased()
        let kind = if lower.hasPrefix("ran ") || ["terminal", "bash", "shell", "exec"].contains(where: lower.contains) { "command" }
            else if lower.contains("search") { "search" }
            else if ["browser", "web", "fetch", "http"].contains(where: lower.contains) { "web" }
            else if ["write", "edit", "patch"].contains(where: lower.contains) { "edit" }
            else if lower.contains("read") || lower.contains("view") { "read" }
            else if lower.contains("skill") { "skill" }
            else { "tool" }
        return ChatStep(kind: kind, title: name)
    }

    // MARK: The agents' own sessions

    /** A Hermes server's are Otter's own unless `everywhere` (a team server keeps teammates' Slack DMs too). */
    func sessions(of agent: Agent, everywhere: Bool = false, limit: Int = 40) async throws -> [Hermes.Session] {
        switch agent.kind {
        case .hermes: return try await agent.hermes?.sessions(limit: limit, everywhere: everywhere) ?? []
        case .openclaw:
            return try await agent.openClaw?.chats(limit: limit).map {
                Hermes.Session(id: $0.id, title: $0.title, preview: $0.preview, lastActive: $0.lastActive, messageCount: $0.preview == nil ? 0 : 1)
            } ?? []
        case .varys:
            return try await agent.varys?.threads().map { thread in
                Hermes.Session(id: thread.id, title: thread.title, preview: thread.routine.map { "Scheduled · \($0)" } ?? thread.preview,
                               lastActive: thread.updatedAt, messageCount: thread.preview == nil ? 0 : 1)
            } ?? []
        case nil: return []
        }
    }

    func messages(of agent: Agent, session: String) async throws -> [SessionMessage] {
        let named = { (tools: [String]) in tools.map { (id: String?.none, step: Self.step(named: $0), output: String?.some("")) } }
        switch agent.kind {
        case .hermes:
            return try await agent.hermes?.messages(of: session).map { SessionMessage(role: $0.role, text: $0.text, steps: named($0.tools)) } ?? []
        case .openclaw:
            return try await agent.openClaw?.messages(of: session).map { message in
                SessionMessage(role: message.role, text: message.text, steps: message.steps.map { ($0.id, Self.step(named: $0.name), $0.output ?? "") })
            } ?? []
        case .varys:
            guard let client = agent.varys else { return [] }
            return Varys.messages(try await client.items(of: session)).map { SessionMessage(role: $0.role, text: $0.text, steps: named($0.tools)) }
        case nil: return []
        }
    }

    /** A file the agent linked, read from where it runs: OpenClaw's gateway serves its agents' workspaces. */
    func file(of agent: Agent, session: String, href: String) async throws -> ChatFile {
        if agents.demo { return try DemoAgent.file(href) }
        guard agent.kind == .openclaw, let gateway = agent.openClaw else { throw OpenClaw.Failure(message: "This file is where \(agent.name) runs.") }
        return try await gateway.file(session: session, href: href)
    }

    func deleteSession(of agent: Agent, _ session: String) async {
        switch agent.kind {
        case .hermes: try? await agent.hermes?.delete(session: session)
        case .openclaw: try? await agent.openClaw?.delete(session: session)
        // Deleting a thread is for your own devices in varys: the chat goes, the thread stays.
        case .varys, nil: break
        }
    }

    /** The agent keeps the chat's name too. */
    func rename(_ agent: Agent, session: String, to title: String) async {
        switch agent.kind {
        case .hermes: try? await agent.hermes?.rename(session: session, to: title)
        case .openclaw: _ = try? await agent.openClaw?.request("sessions.patch", ["key": session, "label": title])
        case .varys: try? await agent.varys?.rename(thread: session, to: title)
        case nil: break
        }
    }

    /** The agent's own name for the chat, written again from its first message where the agent writes names. */
    func regenerateTitle(_ agent: Agent, session: String, message: String) async -> String? {
        switch agent.kind {
        case .hermes: return await agent.hermes?.title(of: session)
        case .openclaw:
            guard let gateway = agent.openClaw, let name = session.split(separator: ":").dropFirst().first,
                  let made = try? await gateway.request("sessions.title.prepare", ["agentId": String(name), "message": String(message.prefix(1000))], timeout: 90) as? [String: Any],
                  let title = made["title"] as? String, !title.isEmpty else { return nil }
            _ = try? await gateway.request("sessions.patch", ["key": session, "label": title])
            return title
        case .varys: return try? await agent.varys?.threads().first { $0.id == session }?.title.nilIfEmpty
        case nil: return nil
        }
    }
}
