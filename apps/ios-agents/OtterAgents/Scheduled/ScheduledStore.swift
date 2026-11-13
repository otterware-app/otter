import Foundation
import Observation

/** Every connected agent's scheduled tasks, kept fresh while the Scheduled tab shows. */
@Observable
final class ScheduledStore {
    private(set) var agents: [AgentTasks] = []
    private(set) var loaded = false
    @ObservationIgnored private let all: Agents
    @ObservationIgnored private var refreshing: Task<Void, Never>?

    init(agents: Agents) { all = agents }

    var tasks: [ScheduledTask] { agents.flatMap(\.tasks) }
    var running: Bool { tasks.contains(where: \.running) }
    /** Enabled tasks that aren't an agent's own: what "Scheduled" counts. */
    var count: Int { tasks.count { $0.enabled && $0.managedBy == nil } }
    var failing: Bool { tasks.contains(where: \.failed) || agents.contains { $0.error != nil } }

    func task(_ id: String) -> ScheduledTask? { tasks.first { $0.id == id } }
    func agent(of task: ScheduledTask) -> AgentTasks? { agents.first { $0.provider == task.provider } }

    /** The agents a new task can go to, by id: each of an OpenClaw gateway's agents on its own. */
    var creators: [(agent: String, gatewayAgent: String?, name: String)] {
        agents.filter { $0.can.create && $0.error == nil }.flatMap { listed -> [(String, String?, String)] in
            guard let agent = all.agent(listed.provider) else { return [] }
            if agent.kind == .openclaw, agent.models.count > 1 { return agent.models.map { (agent.id, $0.slug, $0.name) } }
            return [(agent.id, nil, agent.name)]
        }
    }

    func name(of task: ScheduledTask) -> String {
        let agent = all.agent(task.provider)
        if agent?.kind == .openclaw, let slug = task.agent, let name = agent?.models.first(where: { $0.slug == slug })?.name { return name }
        return name(ofAgent: task.provider)
    }

    func name(ofAgent id: String) -> String { all.agent(id)?.name ?? "Removed agent" }

    private func schedules(_ agent: String) throws -> Schedules {
        guard let agent = all.agent(agent) else { throw ScheduleFailure(message: "This agent isn't on this iPhone any more.") }
        return Schedules(agent: agent, agents: all)
    }

    func refresh() async {
        if let refreshing { return await refreshing.value }
        let task = Task {
            if all.demo {
                if !loaded { agents = Self.demo() }
            } else {
                var listed: [AgentTasks] = []
                for agent in all.runnable { if let tasks = await Schedules(agent: agent, agents: all).list() { listed.append(tasks) } }
                agents = listed
            }
            loaded = true
        }
        refreshing = task
        await task.value
        refreshing = nil
    }

    /** Shows a change at once, makes it, then reads the agent's own word for it. */
    func act(on task: ScheduledTask, shows change: ((inout ScheduledTask) -> Void)? = nil, _ work: @escaping () async throws -> Void) async throws {
        if let change { update(task.id, change) }
        if all.demo { return }
        do { try await work() } catch {
            await refresh()
            throw error
        }
        await refresh()
    }

    func setEnabled(_ task: ScheduledTask, _ enabled: Bool) async throws {
        try await act(on: task, shows: { $0.enabled = enabled; if !enabled { $0.nextRunAt = nil } }) { try await self.schedules(task.provider).setEnabled(task, enabled) }
    }

    func runNow(_ task: ScheduledTask) async throws {
        try await act(on: task, shows: { $0.running = true }) { try await self.schedules(task.provider).runNow(task) }
        if all.demo {
            Task {
                try? await Task.sleep(for: .seconds(4))
                update(task.id) { $0.running = false; $0.lastRun = .init(at: .now, status: .ok, durationMs: 4000) }
            }
        }
    }

    func remove(_ task: ScheduledTask) async throws {
        try await act(on: task) { try await self.schedules(task.provider).remove(task) }
        if all.demo { agents = agents.map { var a = $0; a.tasks.removeAll { $0.id == task.id }; return a } }
    }

    func save(_ agent: String, id: String?, _ input: TaskInput) async throws -> String {
        if all.demo {
            let saved = id ?? UUID().uuidString.lowercased()
            let resultsTo = input.resultsTo
            let fields = { (task: inout ScheduledTask) in
                task.name = input.name
                task.prompt = input.prompt
                task.schedule = input.schedule
                if let resultsTo {
                    task.delivery = switch resultsTo {
                    case .newChat: .otter(newChat: true)
                    case .off: .none
                    case .channel(let id, let to, let account): .channel(id: id, label: id.capitalized, to: to, accountId: account)
                    case .webhook(let url): .webhook(url: url)
                    }
                }
            }
            if id != nil { update("\(agent):\(saved)", fields) } else {
                var task = ScheduledTask(provider: agent, taskId: saved, agent: input.agent, name: input.name, schedule: input.schedule, enabled: true, delivery: .otter(newChat: true))
                fields(&task)
                task.nextRunAt = Int.now + 3_600_000
                agents = agents.map { var a = $0; if a.provider == agent { a.tasks.append(task) }; return a }
            }
            return saved
        }
        let saved = try await schedules(agent).save(id: id, input)
        await refresh()
        return saved
    }

    private func update(_ id: String, _ change: (inout ScheduledTask) -> Void) {
        agents = agents.map { listed in
            var listed = listed
            if let index = listed.tasks.firstIndex(where: { $0.id == id }) { change(&listed.tasks[index]) }
            return listed
        }
    }

    func runs(_ task: ScheduledTask) async throws -> [TaskRun] {
        if all.demo {
            let hour = 3_600_000
            return [
                TaskRun(id: "r1", at: .now - 3 * hour, status: .ok, durationMs: 64_000, summary: "Three things need you today.", model: "claude-opus-5.5", delivered: true),
                TaskRun(id: "r2", at: .now - 27 * hour, status: .ok, durationMs: 51_000, model: "claude-opus-5.5", silent: true),
                TaskRun(id: "r3", at: .now - 51 * hour, status: .error, durationMs: 9_000, error: "The mail server didn't answer.", model: "claude-opus-5.5"),
            ]
        }
        return try await schedules(task.provider).runs(task)
    }

    func transcript(_ task: ScheduledTask, run: TaskRun) async throws -> [SessionMessage] {
        if all.demo {
            return [SessionMessage(role: "assistant", text: run.summary ?? (run.silent ? "" : "Good morning. Three things need you today:\n\n1. **10:00** design review\n2. Marc is waiting on the contract redlines\n3. Your flight check-in opens at 16:20"),
                                   steps: [(nil, ChatStep(kind: "search", title: "Searched mail since yesterday"), "{\"unread\": 14}")])]
        }
        return try await schedules(task.provider).transcript(task, run: run.id)
    }

    private static func demo() -> [AgentTasks] {
        let hour = 3_600_000, now = Int.now
        var brief = ScheduledTask(provider: DemoAgent.brokk, taskId: "brief", name: "Morning brief", schedule: .cron(expr: "0 8 * * 1-5", tz: nil), enabled: true, delivery: .otter(newChat: true))
        brief.prompt = "Read my calendar and the mail since yesterday evening. Tell me what needs me today, in at most five points."
        let tomorrow = Calendar.current.date(byAdding: .day, value: 1, to: Calendar.current.startOfDay(for: .now)) ?? .now
        brief.nextRunAt = Int((tomorrow.timeIntervalSince1970 * 1000).rounded()) + 8 * hour
        brief.lastRun = .init(at: now - 3 * hour, status: .ok, durationMs: 64_000)
        var review = ScheduledTask(provider: DemoAgent.openClaw, taskId: "review", agent: "main", name: "Weekly review", schedule: .cron(expr: "0 16 * * 5", tz: "Europe/Berlin"), enabled: true,
                                   delivery: .channel(id: "slack", label: "Slack", to: "#weekly", accountId: nil))
        review.prompt = "Summarize what shipped this week from the merged pull requests, and what slipped."
        review.nextRunAt = now + 70 * hour
        review.lastRun = .init(at: now - 98 * hour, status: .error, error: "Slack refused the message: channel_not_found", durationMs: 31_000)
        var heartbeat = ScheduledTask(provider: DemoAgent.openClaw, taskId: "heartbeat", agent: "main", name: "Heartbeat", schedule: .every(ms: 30 * 60_000), enabled: true, delivery: .none)
        heartbeat.managedBy = "OpenClaw's heartbeat"
        heartbeat.nextRunAt = now + hour / 4
        var triage = ScheduledTask(provider: DemoAgent.varys, taskId: "triage", name: "Inbox triage", schedule: .every(ms: 2 * hour), enabled: false, delivery: .otter(newChat: false))
        triage.prompt = "Sort new mail into reply, read and archive. Draft replies for the first group."
        let can = AgentTasks.Can(create: true, deliverToOtter: true, webhooks: false, history: true, timeZones: false)
        return [
            AgentTasks(provider: DemoAgent.brokk, tasks: [brief], channels: [DeliveryChannel(id: "telegram", label: "Telegram")], can: can),
            AgentTasks(provider: DemoAgent.openClaw, tasks: [review, heartbeat], channels: [DeliveryChannel(id: "slack", label: "Slack", accounts: ["default"])],
                       can: .init(create: true, deliverToOtter: true, webhooks: true, history: true, timeZones: true)),
            AgentTasks(provider: DemoAgent.varys, tasks: [triage], can: .init(create: true, deliverToOtter: true, webhooks: false, history: true, timeZones: true)),
        ]
    }
}
