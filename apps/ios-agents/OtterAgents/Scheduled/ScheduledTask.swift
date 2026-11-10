import Foundation

/** A task an agent runs on its own, on a schedule (packages/contracts' scheduled.ts). */
nonisolated struct ScheduledTask: Identifiable, Equatable {
    /** When it runs. `other` is the agent's own wording for one Otter can't edit. */
    enum Schedule: Equatable {
        case cron(expr: String, tz: String?)
        case every(ms: Int)
        /** Once, at an ISO time. */
        case at(String)
        case other(String)
    }

    /** Where its result goes. */
    enum Delivery: Equatable {
        case none
        /** To Otter, as chats: a new one each time, or one chat. */
        case otter(newChat: Bool)
        /** A chat app the agent has set up; channel "last" is wherever it was last talked to. */
        case channel(id: String, label: String, to: String?, accountId: String?)
        case webhook(url: String)
        /** Somewhere Otter can name but not change. */
        case elsewhere(label: String)
    }

    struct LastRun: Equatable {
        var at: Int
        var status: TaskRun.Status
        var error: String?
        var durationMs: Int?
    }

    var provider: String
    var taskId: String
    /** Which of the provider's agents runs it (an OpenClaw agent). */
    var agent: String?
    var name: String
    var description: String?
    /** What it asks the agent; absent when it isn't a message (a heartbeat, a command). */
    var prompt: String?
    /** What it runs when it isn't a message to the agent. */
    var runs: String?
    var schedule: Schedule
    /** It runs only when its own check says so. */
    var conditional = false
    var enabled: Bool
    var running = false
    var nextRunAt: Int?
    var lastRun: LastRun?
    var delivery: Delivery
    /** Why its results may not arrive, as the agent sees it. */
    var deliveryProblem: String?
    var failureAlerts: String?
    /** Kept by the agent itself: it can be paused and run, not changed. */
    var managedBy: String?
    /** Why the agent paused it on its own. */
    var autoPaused: String?
    /** The version of it shown, so a save doesn't overwrite a change made since. */
    var revision: String?
    var undeliverable = false
    /** The chats it belongs to (their sessions). */
    var chats: [String] = []

    var id: String { "\(provider):\(taskId)" }
    var failed: Bool { enabled && (lastRun?.status == .error || deliveryProblem != nil) }
    /** Otter can change it: it's no agent's own, and its schedule is one Otter has fields for. */
    var editable: Bool {
        if managedBy != nil { return false }
        if case .other = schedule { return false }
        return true
    }
}

nonisolated struct TaskRun: Identifiable, Equatable {
    enum Status: String { case ok, error, skipped }

    var id: String
    var at: Int
    var status: Status
    var durationMs: Int?
    var error: String?
    var summary: String?
    var model: String?
    var delivered: Bool?
    /** The agent chose to send nothing this time. */
    var silent = false
    var sentTo: String?
    var deliveryError: String?
}

/** A chat app the agent can send results to, and the accounts it sends from. */
nonisolated struct DeliveryChannel: Identifiable, Equatable {
    var id: String
    var label: String
    var accounts: [String] = []
    var defaultAccount: String?
}

/** One agent's tasks, or why they couldn't be read. */
nonisolated struct AgentTasks: Equatable {
    struct Can: Equatable {
        var create = true
        /** Results can come to Otter as chats. */
        var deliverToOtter = true
        var webhooks = false
        /** Past runs, each with its transcript. */
        var history = true
        var timeZones = false
    }

    var provider: String
    var tasks: [ScheduledTask] = []
    var error: String?
    /** Why tasks can be read but not changed. */
    var readOnly: String?
    var channels: [DeliveryChannel] = []
    var can = Can()
}

/** Where a task's results should go. */
nonisolated enum ResultsTo: Equatable {
    case newChat
    case off
    case channel(id: String, to: String, accountId: String?)
    case webhook(url: String)
}

nonisolated struct TaskInput {
    var name: String
    var prompt: String?
    /** Never `other`: a schedule Otter can't write isn't one it saves. */
    var schedule: ScheduledTask.Schedule
    var agent: String?
    /** Nil leaves them where they go. */
    var resultsTo: ResultsTo?
    var revision: String?
}

nonisolated struct ScheduleFailure: LocalizedError {
    var message: String
    var errorDescription: String? { message }
}
