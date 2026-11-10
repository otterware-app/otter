import Foundation

/**
 * The agents' own schedulers, as scheduled tasks: Hermes's cron jobs, OpenClaw's automations,
 * varys's routines (each extension's core/schedules.ts on the Mac and the web). The agent runs them
 * on its own, whether or not any Otter app is open; this lists and changes them.
 */
final class Schedules {
    private let agents: Agents

    init(agents: Agents) { self.agents = agents }

    /** Nil for an agent that isn't connected here, or runs nothing on a schedule. */
    func list(_ kind: AgentKind) async -> AgentTasks? {
        guard kind.schedules, agents.isUsable(kind) else { return nil }
        do {
            switch kind {
            case .hermes: return try await hermesList()
            case .openclaw: return try await openClawList()
            case .varys: return try await varysList()
            case .openrouter: return nil
            }
        } catch {
            return AgentTasks(provider: kind.rawValue, error: error.localizedDescription)
        }
    }

    /** Saves the task; its id. */
    @discardableResult
    func save(_ kind: AgentKind, id: String?, _ input: TaskInput) async throws -> String {
        switch kind {
        case .hermes: try await hermesSave(id, input)
        case .openclaw: try await openClawSave(id, input)
        case .varys: try await varysSave(id, input)
        case .openrouter: throw ScheduleFailure(message: "This agent runs nothing on a schedule.")
        }
    }

    func setEnabled(_ task: ScheduledTask, _ enabled: Bool) async throws {
        switch task.provider {
        case "hermes": _ = try await jobs("/\(Self.segment(task.taskId))/\(enabled ? "resume" : "pause")", method: "POST")
        case "openclaw": try await cron("cron.update", ["id": task.taskId, "patch": ["enabled": enabled]])
        case "varys": try await varys().send("POST", "/routines/\(Self.segment(task.taskId))/pause", ["id": .string(task.taskId), "paused": .bool(!enabled)])
        default: break
        }
    }

    func runNow(_ task: ScheduledTask) async throws {
        switch task.provider {
        case "hermes": _ = try await jobs("/\(Self.segment(task.taskId))/run", method: "POST")
        case "openclaw": try await cron("cron.run", ["id": task.taskId, "mode": "force"])
        case "varys": try await varys().send("POST", "/routines/\(Self.segment(task.taskId))/runs", ["id": .string(task.taskId)])
        default: break
        }
    }

    func remove(_ task: ScheduledTask) async throws {
        switch task.provider {
        case "hermes":
            _ = try await jobs("/\(Self.segment(task.taskId))", method: "DELETE")
            agents.setMuted(.hermes, task.taskId, false)
        case "openclaw":
            let job = try await cron("cron.get", ["id": task.taskId]) as? [String: Any] ?? [:]
            if job["declarationKey"] as? String != nil { throw ScheduleFailure(message: "OpenClaw keeps this one itself: pause it instead of deleting it.") }
            try await cron("cron.remove", ["id": task.taskId])
        case "varys": try await varys().send("DELETE", "/routines/\(Self.segment(task.taskId))", ["id": .string(task.taskId)])
        default: break
        }
    }

    func runs(_ task: ScheduledTask, limit: Int = 20) async throws -> [TaskRun] {
        switch task.provider {
        case "hermes": try await hermesRuns(task.taskId, limit)
        case "openclaw": try await openClawRuns(task.taskId, limit)
        case "varys": try await varysRuns(task.taskId, limit)
        default: []
        }
    }

    /** What a run wrote, for its row in the history. */
    func transcript(_ task: ScheduledTask, run: String) async throws -> [SessionMessage] {
        switch task.provider {
        case "hermes":
            guard let client = agents.hermesClient else { return [] }
            return try await client.messages(of: run).filter { $0.role == "assistant" }.map { message in
                SessionMessage(role: message.role, text: message.text, steps: message.tools.map { (nil, AgentRunner.step(named: $0), "") })
            }
        case "openclaw": return try await openClawTranscript(task.taskId, run)
        case "varys": return try await varysTranscript(task.taskId, run)
        default: return []
        }
    }

    private static func segment(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? id
    }

    private static func ms(_ value: Any?) -> Int? {
        if let number = value as? Double { return Int((number < 1e12 ? number * 1000 : number).rounded()) }
        if let text = value as? String {
            if let date = ScheduleText.date(iso: text) { return Int((date.timeIntervalSince1970 * 1000).rounded()) }
            return Double(text).map { Int(($0 < 1e12 ? $0 * 1000 : $0).rounded()) }
        }
        return nil
    }

    // MARK: Hermes

    private func jobs(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> [String: Any] {
        guard let client = agents.hermesClient else { throw ScheduleFailure(message: "Connect Hermes in Settings.") }
        let (data, status) = try await client.call(method, "\(client.origin)/api/jobs\(path)", json: body)
        let object = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        guard (200..<300).contains(status) else {
            if status == 404, path.hasPrefix("/") { throw ScheduleFailure(message: "That task is gone from Hermes.") }
            if status == 404 || status == 501 { throw ScheduleFailure(message: "This Hermes doesn't run scheduled tasks. Update it to manage them here.") }
            let message = object["error"] as? String ?? (object["error"] as? [String: Any])?["message"] as? String
            throw ScheduleFailure(message: message ?? "Hermes answered \(status).")
        }
        return object
    }

    /** The gateway's platforms (Otter's plugin, Telegram…), by name. */
    private func hermesPlatforms() async -> [String] {
        guard let client = agents.hermesClient, let (data, status) = try? await client.call("GET", "\(client.origin)/health/detailed"), status == 200,
              let platforms = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["platforms"] as? [String: [String: Any]] else { return [] }
        return platforms.filter { $0.value["state"] as? String == "connected" }.map(\.key)
    }

    private static func label(_ platform: String) -> String {
        platform.split(separator: "_").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }

    func hermesTask(_ job: [String: Any]) -> ScheduledTask? {
        guard let id = job["id"] as? String else { return nil }
        let s = job["schedule"] as? [String: Any] ?? [:]
        let schedule: ScheduledTask.Schedule
        if s["kind"] as? String == "cron", let expr = s["expr"] as? String { schedule = .cron(expr: expr, tz: job["timezone"] as? String) }
        else if s["kind"] as? String == "interval", let minutes = s["minutes"] as? Int, minutes > 0 { schedule = .every(ms: minutes * 60_000) }
        else if s["kind"] as? String == "once", let at = s["run_at"] as? String { schedule = .at(at) }
        else { schedule = .other(job["schedule_display"] as? String ?? s["display"] as? String ?? "On its own schedule") }
        let enabled = job["enabled"] as? Bool != false && job["state"] as? String != "paused"
        let failed = ["error", "failed"].contains(job["last_status"] as? String ?? "")
        let deliver = job["deliver"] as? String ?? "local"
        let delivery: ScheduledTask.Delivery
        if deliver == "local" { delivery = agents.muted(.hermes).contains(id) ? .none : .otter(newChat: true) }
        else if deliver == "otter" { delivery = .otter(newChat: true) }
        else if deliver.hasPrefix("otter:") { delivery = .otter(newChat: false) }
        else if let colon = deliver.firstIndex(of: ":"), !deliver.contains(",") {
            let platform = String(deliver[..<colon])
            delivery = .channel(id: platform, label: Self.label(platform), to: String(deliver[deliver.index(after: colon)...]), accountId: nil)
        } else {
            delivery = .elsewhere(label: deliver == "origin" ? "where it was set up" : deliver.split(separator: ",").map { Self.label(String($0)) }.joined(separator: ", "))
        }
        var task = ScheduledTask(provider: "hermes", taskId: id, name: (job["name"] as? String).flatMap(\.nilIfEmpty) ?? id, schedule: schedule, enabled: enabled, delivery: delivery)
        if let prompt = job["prompt"] as? String, !prompt.isEmpty, job["no_agent"] as? Bool != true { task.prompt = prompt }
        task.running = job["state"] as? String == "running"
        if enabled { task.nextRunAt = Self.ms(job["next_run_at"]) }
        if let at = Self.ms(job["last_run_at"]), job["last_status"] as? String != nil {
            task.lastRun = .init(at: at, status: failed ? .error : .ok, error: failed ? job["last_error"] as? String : nil)
        }
        return task
    }

    private func hermesList() async throws -> AgentTasks {
        let tasks = (try await jobs("?include_disabled=true")["jobs"] as? [[String: Any]] ?? []).compactMap(hermesTask)
        let channels = await hermesPlatforms().filter { $0 != "api_server" && $0 != "otter" }.map { DeliveryChannel(id: $0, label: Self.label($0)) }
        return AgentTasks(provider: "hermes", tasks: tasks, channels: channels, can: .init(create: true, deliverToOtter: true, webhooks: false, history: true, timeZones: false))
    }

    /** A schedule in words Hermes parses: a cron expression, `every 90m`, an ISO time. */
    static func hermesSchedule(_ schedule: ScheduledTask.Schedule) -> String? {
        switch schedule {
        case .cron(let expr, _): expr
        case .every(let ms): "every \(max(1, Int((Double(ms) / 60_000).rounded())))m"
        case .at(let iso): iso
        case .other: nil
        }
    }

    private func hermesSave(_ id: String?, _ input: TaskInput) async throws -> String {
        guard let schedule = Self.hermesSchedule(input.schedule) else { throw ScheduleFailure(message: "Pick when it runs.") }
        var deliver: String?
        switch input.resultsTo {
        case .newChat: deliver = await hermesPlatforms().contains("otter") ? "otter" : "local"
        case .off: deliver = "local"
        case .channel(let id, let to, _): deliver = "\(id):\(to)"
        case .webhook: throw ScheduleFailure(message: "Hermes can't post results to a webhook.")
        case nil: break
        }
        var body: [String: Any] = ["name": input.name]
        if let prompt = input.prompt { body["prompt"] = prompt }
        if let deliver { body["deliver"] = deliver }
        var saved = id ?? ""
        if let id {
            // Hermes works out the next run again whenever it's sent a schedule: only a new one.
            let current = (try await jobs("/\(Self.segment(id))")["job"] as? [String: Any]).flatMap(hermesTask)
            if current.flatMap({ Self.hermesSchedule($0.schedule) }) != schedule { body["schedule"] = schedule }
            _ = try await jobs("/\(Self.segment(id))", method: "PATCH", body: body)
        } else {
            body["schedule"] = schedule
            body["deliver"] = deliver ?? "local"
            saved = (try await jobs("", method: "POST", body: body)["job"] as? [String: Any])?["id"] as? String ?? ""
        }
        if !saved.isEmpty, let to = input.resultsTo { agents.setMuted(.hermes, saved, to == .off) }
        return saved
    }

    /** Each run is a session of its own (source "cron"), named after its job. */
    private func hermesRuns(_ id: String, _ limit: Int) async throws -> [TaskRun] {
        guard let client = agents.hermesClient else { return [] }
        let job = try await jobs("/\(Self.segment(id))")["job"] as? [String: Any] ?? [:]
        let name = (job["name"] as? String ?? "").split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(60).trimmingCharacters(in: .whitespaces)
        let (data, status) = try await client.call("GET", "\(client.origin)/api/sessions?source=cron&limit=200")
        guard status == 200 else { throw ScheduleFailure(message: "Hermes answered \(status).") }
        let sessions = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return sessions.filter { session in
            guard session["ended_at"] != nil, !(session["ended_at"] is NSNull) else { return false }
            let sessionId = session["id"] as? String ?? ""
            return sessionId.hasPrefix("cron_\(id)_") || (!name.isEmpty && (session["title"] as? String ?? "").hasPrefix("\(name) · "))
        }.prefix(limit).compactMap { session in
            guard let runId = session["id"] as? String, let at = Self.ms(session["started_at"]) else { return nil }
            let ended = Self.ms(session["ended_at"]) ?? 0
            let failed = session["end_reason"] as? String == "cron_incomplete_no_output"
            return TaskRun(id: runId, at: at, status: failed ? .error : .ok, durationMs: ended > at ? ended - at : nil,
                           error: failed ? "It finished without a result." : nil, model: session["model"] as? String)
        }
    }

    // MARK: OpenClaw

    private static let readOnly = "Otter can see these but not change them: allow it full access to the gateway in Settings."
    private static let changed = "It changed on the gateway while you were editing it. Look again and save."

    @discardableResult
    private func cron(_ method: String, _ params: [String: Any]) async throws -> Any? {
        guard let gateway = agents.openClawClient else { throw ScheduleFailure(message: "Connect OpenClaw in Settings.") }
        do { return try await gateway.request(method, params) } catch {
            let message = error.localizedDescription
            let code = (error as? OpenClaw.Failure)?.code
            if message.range(of: "missing scope|operator\\.admin", options: [.regularExpression, .caseInsensitive]) != nil { throw ScheduleFailure(message: Self.readOnly) }
            if code == "CRON_JOB_NOT_FOUND" || message.hasPrefix("Automation not found") { throw ScheduleFailure(message: "That task is gone from the gateway.") }
            if code == "CRON_JOB_CHANGED" { throw ScheduleFailure(message: Self.changed) }
            if message.contains("not a known channel: otter") {
                throw ScheduleFailure(message: "The gateway can't send to Otter yet: set up Messages from your agents in Otter on the Mac.")
            }
            throw ScheduleFailure(message: message.replacingOccurrences(of: "^invalid cron\\.\\w+ params: ", with: "", options: .regularExpression))
        }
    }

    private static func text(_ value: Any?) -> String? {
        if let text = value as? String, !text.isEmpty { return text }
        if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { return number.stringValue }
        return nil
    }

    /** An Otter target as the gateway's plugin reads it: the chat it names, a new one each time, or nothing. */
    private static func otterChat(_ to: Any?) -> (new: Bool, chat: String?)? {
        let target = (to as? String ?? "").trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "^otter:", with: "", options: .regularExpression)
        if target == "chat:new" || target == "owner" { return (true, nil) }
        let session = target.hasPrefix("chat:") ? String(target.dropFirst(5)) : ""
        let parts = session.split(separator: ":")
        return parts.first == "agent" && parts.count > 1 ? (false, session) : nil
    }

    private static func openClawSchedule(_ schedule: [String: Any]) -> ScheduledTask.Schedule {
        switch schedule["kind"] as? String {
        case "cron": if let expr = schedule["expr"] as? String { return .cron(expr: expr, tz: schedule["tz"] as? String) }
        case "every": if let ms = schedule["everyMs"] as? Int { return .every(ms: ms) }
        case "at": if let at = schedule["at"] as? String { return .at(at) }
        case "on-exit": return .other("When \(schedule["command"] as? String ?? "a command") exits")
        case "stream": return .other("When a command it watches prints")
        case "event": return .other("When an event it waits for comes")
        default: break
        }
        return .other(schedule["kind"] as? String ?? "On its own schedule")
    }

    private static func channelName(_ id: String, _ labels: [String: String]) -> String { labels[id] ?? (id.prefix(1).uppercased() + id.dropFirst()) }

    private static func promptOf(_ job: [String: Any]) -> String? {
        let payload = job["payload"] as? [String: Any] ?? [:]
        let text = payload["kind"] as? String == "agentTurn" ? payload["message"] : payload["kind"] as? String == "systemEvent" ? payload["text"] : nil
        guard let text = text as? String, !text.hasPrefix("__openclaw_") else { return nil }
        return text
    }

    private func openClawTask(_ job: [String: Any], defaultAgent: String, preview: [String: Any]?, labels: [String: String]) -> ScheduledTask? {
        guard let id = job["id"] as? String else { return nil }
        let state = job["state"] as? [String: Any] ?? [:]
        let payload = job["payload"] as? [String: Any] ?? [:]
        let delivery = job["delivery"] as? [String: Any]
        let enabled = job["enabled"] as? Bool ?? false
        var where_: ScheduledTask.Delivery = .none
        var problem: String?
        var chats: [String] = []
        if let session = job["sessionKey"] as? String { chats.append(session) }
        if payload["kind"] as? String != "heartbeat", let delivery, delivery["mode"] as? String != "none" {
            let channel = Self.text(delivery["channel"]) ?? "last"
            if delivery["mode"] as? String == "webhook" {
                where_ = .webhook(url: Self.text(delivery["to"]) ?? "")
            } else if channel == "otter" {
                if let target = Self.otterChat(delivery["to"]) {
                    where_ = .otter(newChat: target.new)
                    if let chat = target.chat, !chats.contains(chat) { chats.append(chat) }
                } else {
                    where_ = .elsewhere(label: "Otter, with no chat named")
                    problem = "It names no Otter chat to send to: choose where its results go."
                }
            } else {
                // Where "last" goes now, as the gateway resolves it.
                let resolved = channel == "last" ? (preview?["label"] as? String).flatMap { label -> String? in
                    guard label.hasPrefix("announce -> "), !label.hasPrefix("announce -> last") else { return nil }
                    return String(label.dropFirst("announce -> ".count))
                } : nil
                where_ = .channel(id: channel, label: channel == "last" ? "The last conversation" : Self.channelName(channel, labels),
                                  to: Self.text(delivery["to"]) ?? resolved, accountId: Self.text(delivery["accountId"]))
            }
        }
        if problem == nil, let detail = preview?["detail"] as? String,
           detail.range(of: "will be blocked|requires review|unavailable|unresolved|Unknown target|Configure a channel and delivery target", options: .regularExpression) != nil {
            if detail.contains("multiple channels are configured") {
                problem = "OpenClaw has more than one channel, so it can't tell where to send these: choose one."
            } else {
                let reason = detail.replacingOccurrences(of: "^.*?will be blocked:\\s*", with: "", options: .regularExpression)
                    .components(separatedBy: "Configure a channel and delivery target")[0].trimmingCharacters(in: .whitespaces)
                let first = reason.split(separator: ".", maxSplits: 1).first.map(String.init) ?? reason
                problem = first.hasSuffix(".") ? first : "\(first)."
            }
        }
        let agent = job["agentId"] as? String ?? (job["sessionKey"] as? String)?.split(separator: ":").dropFirst().first.map(String.init) ?? defaultAgent
        var task = ScheduledTask(provider: "openclaw", taskId: id, agent: agent,
                                 name: (job["displayName"] as? String).flatMap(\.nilIfEmpty) ?? job["name"] as? String ?? id,
                                 schedule: Self.openClawSchedule(job["schedule"] as? [String: Any] ?? [:]), enabled: enabled, delivery: where_)
        task.description = (job["description"] as? String)?.replacingOccurrences(of: "^\\[managed-by=[^\\]]*\\]\\s*", with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces).nilIfEmpty
        task.prompt = Self.promptOf(job)
        if payload["kind"] as? String == "command", let argv = payload["argv"] as? [Any] { task.runs = "Runs \(argv.map { "\($0)" }.joined(separator: " "))" }
        else if payload["kind"] as? String == "script" { task.runs = "Runs a script" }
        task.conditional = job["trigger"] != nil && !(job["trigger"] is NSNull)
        task.running = state["runningAtMs"] as? Double != nil
        if enabled { task.nextRunAt = (state["nextRunAtMs"] as? Double ?? job["nextRunAtMs"] as? Double).map { Int($0) } }
        let status = (state["lastRunStatus"] as? String ?? state["lastStatus"] as? String).flatMap(TaskRun.Status.init)
        if let at = state["lastRunAtMs"] as? Double, let status {
            task.lastRun = .init(at: Int(at), status: status, error: status == .error ? state["lastDiagnosticSummary"] as? String ?? state["lastError"] as? String : nil,
                                 durationMs: (state["lastDurationMs"] as? Double).map { Int($0) })
        }
        task.deliveryProblem = problem
        if let key = job["declarationKey"] as? String, let owner = key.split(separator: ":").first {
            task.managedBy = owner == "heartbeat" ? "OpenClaw's heartbeat" : "OpenClaw (\(owner))"
        }
        if let auto = state["autoDisabled"] as? [String: Any], !enabled {
            task.autoPaused = auto["reason"] as? String == "consecutive-failures"
                ? "Paused by OpenClaw after \(auto["consecutiveErrors"] as? Int ?? 0) failed runs in a row" : "Paused by OpenClaw: its schedule kept failing"
        }
        task.revision = job["configRevision"] as? String
        task.chats = chats
        // Only an agent turn in a session of its own reports to a chat.
        task.undeliverable = job["sessionTarget"] as? String == "main" || payload["kind"] as? String != "agentTurn"
        return task
    }

    private func openClawChannels() async -> (channels: [DeliveryChannel], labels: [String: String], otter: Bool) {
        let status = (try? await agents.openClawClient?.request("channels.status", [:]) as? [String: Any]) ?? [:]
        var labels = status["channelLabels"] as? [String: String] ?? [:]
        let meta = status["channelMeta"] as? [[String: Any]] ?? []
        for entry in meta { if let id = entry["id"] as? String, let label = entry["label"] as? String { labels[id] = label } }
        let ids = meta.isEmpty ? status["channelOrder"] as? [String] ?? [] : meta.compactMap { $0["id"] as? String }
        let accounts = status["channelAccounts"] as? [String: [[String: Any]]] ?? [:]
        let defaults = status["channelDefaultAccountId"] as? [String: String] ?? [:]
        let channels = ids.filter { $0 != "otter" }.compactMap { id -> DeliveryChannel? in
            let usable = (accounts[id] ?? []).filter { $0["enabled"] as? Bool != false && $0["configured"] as? Bool != false }.compactMap { $0["accountId"] as? String }
            return usable.isEmpty ? nil : DeliveryChannel(id: id, label: Self.channelName(id, labels), accounts: usable, defaultAccount: defaults[id])
        }
        return (channels, labels, ids.contains("otter"))
    }

    private func openClawList() async throws -> AgentTasks {
        var jobs: [[String: Any]] = []
        var previews: [String: [String: Any]] = [:]
        var offset = 0
        while true {
            let page = try await cron("cron.list", ["includeDisabled": true, "sortBy": "nextRunAtMs", "sortDir": "asc", "limit": 200, "offset": offset,
                                                    "includeDeliveryPreviews": true]) as? [String: Any] ?? [:]
            jobs += page["jobs"] as? [[String: Any]] ?? []
            previews.merge(page["deliveryPreviews"] as? [String: [String: Any]] ?? [:]) { _, new in new }
            guard page["hasMore"] as? Bool == true, let next = page["nextOffset"] as? Int, next > offset else { break }
            offset = next
        }
        let admin = agents.openClawFullAccess == true
        let (channels, labels, otter) = await openClawChannels()
        let defaultAgent = agents.models(of: .openclaw).first(where: \.isDefault)?.slug ?? "main"
        let tasks = jobs.compactMap { job in openClawTask(job, defaultAgent: defaultAgent, preview: (job["id"] as? String).flatMap { previews[$0] }, labels: labels) }
        return AgentTasks(provider: "openclaw", tasks: tasks, readOnly: admin ? nil : Self.readOnly, channels: channels,
                          can: .init(create: admin, deliverToOtter: otter, webhooks: true, history: true, timeZones: true))
    }

    private static func cronSchedule(_ schedule: ScheduledTask.Schedule) -> [String: Any] {
        switch schedule {
        case .cron(let expr, let tz):
            var value: [String: Any] = ["kind": "cron", "expr": expr]
            if let tz { value["tz"] = tz }
            return value
        case .every(let ms): return ["kind": "every", "everyMs": ms]
        case .at(let iso): return ["kind": "at", "at": iso]
        case .other: return [:]
        }
    }

    private static func delivery(for to: ResultsTo) -> [String: Any] {
        switch to {
        case .newChat: return ["mode": "announce", "channel": "otter", "to": "chat:new"]
        case .channel(let id, let to, let accountId):
            var value: [String: Any] = ["mode": "announce", "channel": id, "to": to]
            if let accountId { value["accountId"] = accountId }
            return value
        case .webhook(let url): return ["mode": "webhook", "to": url]
        case .off: return ["mode": "none"]
        }
    }

    private func openClawSave(_ id: String?, _ input: TaskInput) async throws -> String {
        let schedule = Self.cronSchedule(input.schedule)
        let once = { if case .at = input.schedule { true } else { false } }()
        guard let id else {
            guard let prompt = input.prompt else { throw ScheduleFailure(message: "Say what the agent should do.") }
            var add: [String: Any] = ["name": input.name, "sessionTarget": "isolated", "wakeMode": "now", "schedule": schedule,
                                      "payload": ["kind": "agentTurn", "message": prompt], "delivery": Self.delivery(for: input.resultsTo ?? .off)]
            if let agent = input.agent { add["agentId"] = agent }
            if once { add["deleteAfterRun"] = true }
            let added = try await cron("cron.add", add) as? [String: Any] ?? [:]
            return added["id"] as? String ?? (added["job"] as? [String: Any])?["id"] as? String ?? ""
        }
        let job = try await cron("cron.get", ["id": id]) as? [String: Any] ?? [:]
        if job["declarationKey"] as? String != nil { throw ScheduleFailure(message: "OpenClaw keeps this one itself: it can be paused or run, not changed.") }
        let revision = job["configRevision"] as? String
        if let editing = input.revision, let revision, editing != revision { throw ScheduleFailure(message: Self.changed) }
        var patch: [String: Any] = [:]
        if input.name != (job["displayName"] as? String).flatMap(\.nilIfEmpty) ?? job["name"] as? String {
            patch["name"] = input.name
            if job["displayName"] as? String != nil { patch["displayName"] = NSNull() }
        }
        let current = job["schedule"] as? [String: Any] ?? [:]
        let same = schedule.allSatisfy { key, value in "\(current[key] ?? "")" == "\(value)" } && (schedule["kind"] as? String != "cron" || current["tz"] as? String == schedule["tz"] as? String)
        if !same {
            var next = schedule
            if schedule["kind"] as? String == "cron", current["kind"] as? String == "cron", let stagger = current["staggerMs"] { next["staggerMs"] = stagger }
            patch["schedule"] = next
            // A one-off goes once it has run; a repeating task stays.
            if once != (current["kind"] as? String == "at") { patch["deleteAfterRun"] = once }
        }
        if let prompt = input.prompt, let had = Self.promptOf(job), prompt != had, var payload = job["payload"] as? [String: Any] {
            payload[payload["kind"] as? String == "agentTurn" ? "message" : "text"] = prompt
            patch["payload"] = payload
        }
        if let agent = input.agent, agent != job["agentId"] as? String, job["sessionKey"] as? String == nil { patch["agentId"] = agent }
        if let to = input.resultsTo {
            // The gateway merges a delivery patch, so what pointed at the old target is cleared.
            let wanted = Self.delivery(for: to)
            let now = job["delivery"] as? [String: Any] ?? ["mode": "none"]
            let equal = { (key: String) in Self.text(now[key]) == Self.text(wanted[key]) }
            let sameChat = equal("mode") && equal("channel") && equal("to")
            let unchanged = equal("mode") && (wanted["mode"] as? String == "none" || (sameChat && (wanted["mode"] as? String != "announce" || equal("accountId"))))
            if !unchanged {
                var delivery: [String: Any] = ["channel": NSNull(), "to": NSNull(), "accountId": NSNull()]
                if !sameChat { delivery["threadId"] = NSNull() }
                if wanted["mode"] as? String != "announce" { delivery["completionDestination"] = NSNull() }
                patch["delivery"] = delivery.merging(wanted) { _, new in new }
            }
        }
        if !patch.isEmpty {
            var update: [String: Any] = ["id": id, "patch": patch]
            if let revision = input.revision ?? revision { update["expectedConfigRevision"] = revision }
            try await cron("cron.update", update)
        }
        return id
    }

    private func openClawRuns(_ id: String, _ limit: Int) async throws -> [TaskRun] {
        let result = try await cron("cron.runs", ["id": id, "limit": limit, "sortDir": "desc"]) as? [String: Any] ?? [:]
        return (result["entries"] as? [[String: Any]] ?? []).compactMap { entry in
            guard let at = (entry["runAtMs"] as? Double ?? entry["ts"] as? Double).map({ Int($0) }) else { return nil }
            let status = (entry["status"] as? String).flatMap(TaskRun.Status.init) ?? .ok
            let resolved = (entry["delivery"] as? [String: Any])?["resolved"] as? [String: Any]
            var run = TaskRun(id: entry["runId"] as? String ?? "at:\(at)", at: at, status: status, durationMs: (entry["durationMs"] as? Double).map { Int($0) })
            if status == .error { run.error = (entry["diagnostics"] as? [String: Any])?["summary"] as? String ?? entry["error"] as? String ?? "It failed." }
            run.summary = (entry["summary"] as? String)?.nilIfEmpty
            run.model = entry["model"] as? String
            if let channel = resolved?["channel"] as? String { run.sentTo = [channel, resolved?["to"] as? String].compactMap(\.self).joined(separator: " ") }
            if resolved?["ok"] as? Bool == false { run.deliveryError = resolved?["error"] as? String }
            // "silent": the agent chose to send nothing, not a failure.
            if entry["deliverySuppressionReason"] as? String == "silent" { run.silent = true }
            else if let status = entry["deliveryStatus"] as? String, ["delivered", "not-delivered"].contains(status) { run.delivered = status == "delivered" }
            else { run.delivered = resolved?["ok"] as? Bool }
            return run
        }
    }

    private func openClawTranscript(_ id: String, _ run: String) async throws -> [SessionMessage] {
        var params: [String: Any] = ["id": id, "limit": 200]
        if run.hasPrefix("at:"), let at = Int(run.dropFirst(3)) { params["runAtMs"] = at } else { params["runId"] = run }
        guard let gateway = agents.openClawClient else { return [] }
        // A run the gateway kept no transcript for (a heartbeat, a pruned session): its summary stands in for it.
        guard let result = try? await gateway.request("cron.history", params) as? [String: Any] else { return [] }
        return OpenClaw.transcript(result["messages"] as? [[String: Any]] ?? []).filter { $0.role == "assistant" }.map { message in
            SessionMessage(role: message.role, text: message.text, steps: message.steps.map { ($0.id, AgentRunner.step(named: $0.name), $0.output ?? "") })
        }
    }

    // MARK: varys

    private func varys() throws -> Varys {
        guard let client = agents.varysClient else { throw ScheduleFailure(message: "Connect varys in Settings first.") }
        return client
    }

    private static func varysRun(_ run: JSON) -> TaskRun? {
        guard let id = run["id"]?.string, let started = Self.ms(run["startedAt"]?.string) else { return nil }
        let outcome = run["outcome"]?.string
        let status: TaskRun.Status = outcome == "skipped" ? .skipped : ["succeeded", "nothing_new"].contains(outcome ?? "") ? .ok : .error
        let ended = Self.ms(run["endedAt"]?.string)
        return TaskRun(id: id, at: started, status: status, durationMs: ended.map { $0 - started },
                       error: status == .error ? run["missing"]?.string ?? run["detail"]?.string : nil, summary: run["report"]?.string?.nilIfEmpty,
                       silent: outcome == "nothing_new")
    }

    private func varysTask(_ routine: JSON) -> ScheduledTask? {
        guard let id = routine["id"]?.string else { return nil }
        let trigger = routine["trigger"] ?? .null
        let schedule: ScheduledTask.Schedule
        if trigger["type"]?.string == "new_mail" { schedule = .other("When new mail arrives") }
        else if trigger["schedule"]?["type"]?.string == "cron" { schedule = .cron(expr: trigger["schedule"]?["cron"]?.string ?? "", tz: trigger["schedule"]?["zone"]?.string) }
        else { schedule = .every(ms: trigger["schedule"]?["everyMs"]?.count ?? 3_600_000) }
        let run = routine["lastRun"]
        let intoThread = routine["delivery"]?.string == "into_thread"
        var task = ScheduledTask(provider: "varys", taskId: id, name: routine["title"]?.string ?? id, schedule: schedule, enabled: routine["paused"]?.bool != true,
                                 delivery: agents.muted(.varys).contains(id) ? .none : .otter(newChat: !intoThread))
        task.prompt = routine["instructions"]?.string
        task.running = run.map { !$0.isNull && $0["state"]?.string != "ended" } ?? false
        task.nextRunAt = Self.ms(routine["nextRunAt"]?.string)
        if let run, run["state"]?.string == "ended", let ended = Self.varysRun(run) {
            task.lastRun = .init(at: ended.at, status: ended.status, error: ended.error, durationMs: ended.durationMs)
        }
        // A built-in routine keeps its name, and is paused rather than deleted.
        if routine["builtIn"]?.bool == true { task.managedBy = "varys" }
        if intoThread, let thread = routine["threadId"]?.string ?? run?["threadId"]?.string { task.chats = [thread] }
        return task
    }

    private func varysList() async throws -> AgentTasks {
        let list = try await varys().read("routines", .object([:]))
        return AgentTasks(provider: "varys", tasks: (list["routines"]?.array ?? []).compactMap(varysTask),
                          can: .init(create: true, deliverToOtter: true, webhooks: false, history: true, timeZones: true))
    }

    private func varysSave(_ id: String?, _ input: TaskInput) async throws -> String {
        let client = try varys()
        let current = try await id.asyncMapThrowing { try await client.read("routine", .object(["id": .string($0)]))["routine"] } ?? nil
        let trigger: JSON
        switch input.schedule {
        case .cron(let expr, let tz):
            trigger = .object(["type": "schedule", "schedule": .object(["type": "cron", "cron": .string(expr), "zone": .string(tz ?? ScheduleText.localTimeZone)])])
        case .every(let ms):
            // The same interval keeps the times it runs at.
            let was = current?["trigger"]?["schedule"]
            let anchor = was?["type"]?.string == "interval" && was?["everyMs"]?.count == ms ? was?["anchor"]?.string : nil
            trigger = .object(["type": "schedule", "schedule": .object([
                "type": "interval", "everyMs": .number(Double(ms)),
                "anchor": .string(anchor ?? Date.now.formatted(.iso8601.year().month().day().time(includingFractionalSeconds: true))),
            ])])
        default: throw ScheduleFailure(message: "varys's routines repeat: choose a schedule that does.")
        }
        let instructions = input.prompt?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty ?? input.name
        var fields: [String: JSON] = ["title": .string(input.name), "instructions": .string(instructions), "trigger": trigger]
        let receipt: JSON
        if let current, let routineId = current["id"]?.string {
            fields["id"] = .string(routineId)
            // A new chat each time: a routine that writes into one thread of its own stops doing that.
            if input.resultsTo == .newChat, current["delivery"]?.string == "into_thread" { fields["delivery"] = "each_run" }
            receipt = try await client.send("PATCH", "/routines/\(Self.segment(routineId))", fields)
        } else {
            fields["delivery"] = "each_run"
            receipt = try await client.send("POST", "/routines", fields)
        }
        let saved = receipt["result"]?["routineId"]?.string ?? id ?? ""
        if !saved.isEmpty, let to = input.resultsTo { agents.setMuted(.varys, saved, to == .off) }
        return saved
    }

    private func varysRuns(_ id: String, _ limit: Int) async throws -> [TaskRun] {
        let page = try await varys().get("/routines/\(Self.segment(id))/runs?limit=\(limit)")
        return (page["runs"]?.array ?? []).filter { $0["state"]?.string == "ended" }.compactMap(Self.varysRun)
    }

    private func varysTranscript(_ id: String, _ run: String) async throws -> [SessionMessage] {
        let client = try varys()
        let runs = try await client.get("/routines/\(Self.segment(id))/runs?limit=100")["runs"]?.array ?? []
        guard let thread = runs.first(where: { $0["id"]?.string == run })?["threadId"]?.string else { return [] }
        return Varys.messages(try await client.items(of: thread)).filter { $0.role == "assistant" }.map { message in
            SessionMessage(role: message.role, text: message.text, steps: message.tools.map { (nil, AgentRunner.step(named: $0), "") })
        }
    }
}

extension Optional {
    func asyncMapThrowing<T>(_ transform: (Wrapped) async throws -> T) async throws -> T? {
        if let self { try await transform(self) } else { nil }
    }
}
