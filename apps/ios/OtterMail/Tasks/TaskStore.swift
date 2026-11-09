import Foundation
import Observation
import UserNotifications

/**
 * The tasks the screens render from, and their local reminders. New logic, and
 * local: tasks belong to the signed-in Otter account (or to the demo), stay on
 * this iPhone and sync nowhere. Signing out leaves them on disk and takes their
 * reminders down; signing in again schedules them afresh.
 */
@Observable
final class TaskStore {
    enum Failure: LocalizedError {
        case unreadable

        var errorDescription: String? {
            switch self {
            case .unreadable:
                "This iPhone's task file couldn't be read, so nothing was written over it. Reopen Otter Mail to try again."
            }
        }
    }

    private(set) var tasks: [MailTask] = []
    /** The lists made here, after the Inbox (`TaskProject.inbox`), which is always there. */
    private(set) var projects: [TaskProject] = []
    /** The list shown, nil for All; kept on this iPhone for the scope. */
    private(set) var selected: String?
    private(set) var scope: String?
    /** Notifications are off for Otter Mail, so a reminder can't arrive (the editor says so). */
    private(set) var remindersDenied = false
    /** Reminders iOS has no room for yet: they're asked for as the nearer ones arrive. */
    private(set) var waiting: Set<UUID> = []
    /** A save that didn't land, for the screen to show. */
    var failure: String?

    @ObservationIgnored private let files: TaskFiles
    @ObservationIgnored private let reminders: any TaskReminding
    /** The reminder work in flight, so a newer job queues behind it rather than racing it. */
    @ObservationIgnored private var queued: Task<Void, Never>?
    @ObservationIgnored private var generation = 0
    /** Bumped by every open and close, so a write from the session before can't land in this one. */
    @ObservationIgnored private var session = 0
    /** A change is being written; the ones after it wait their turn here. */
    @ObservationIgnored private var writing = false
    @ObservationIgnored private var waiters: [CheckedContinuation<Void, Never>] = []
    /** The file couldn't be read: it keeps whatever it holds until the next sign-in. */
    @ObservationIgnored private var unreadable = false

    /** What a session showed, for the writes it left queued. */
    private struct Shown {
        var scope: String
        var tasks: [MailTask]
        var projects: [TaskProject]
        var unreadable: Bool
    }

    /** The background writes queued in each session, by session. */
    @ObservationIgnored private var queuedWrites: [Int: Int] = [:]
    /**
     * A session that ended with writes still queued: what it showed, so they write
     * that to its own account's file, not the next account's list or nothing.
     */
    @ObservationIgnored private var ended: [Int: Shown] = [:]

    @ObservationIgnored private let defaults: UserDefaults

    init(files: TaskFiles = .live, reminders: any TaskReminding = LiveReminders(), defaults: UserDefaults = .standard) {
        self.files = files
        self.reminders = reminders
        self.defaults = defaults
    }

    /** The Inbox, then the lists made here. */
    var lists: [TaskProject] { [.inbox] + projects }

    /** The tasks on the list shown. */
    var visible: [MailTask] { TaskProject.filter(tasks, project: selected) }

    func project(_ id: String?) -> TaskProject? { lists.first { $0.id == id } }

    /** One scope an account, the same slug the draft recovery uses, and `demo` for the demo. */
    static func scope(user: String?) -> String {
        guard let user else { return "demo" }
        return Data(user.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
    }

    func open(_ scope: String, seed: [MailTask] = [], seedProjects: [TaskProject] = []) {
        leave()
        self.scope = scope
        unreadable = false
        failure = nil
        // The same account again before what it left queued is written: the file is behind what it showed.
        if let left = ended.filter({ $0.value.scope == scope && !$0.value.unreadable }).max(by: { $0.key < $1.key })?.value {
            tasks = left.tasks
            projects = left.projects
        } else {
            load(scope, seed: seed, seedProjects: seedProjects)
        }
        let chosen = defaults.string(forKey: Self.selectedKey(scope))
        selected = lists.contains { $0.id == chosen } ? chosen : nil
        reschedule()
    }

    private func load(_ scope: String, seed: [MailTask], seedProjects: [TaskProject]) {
        do {
            if let known = try files.load(scope) {
                tasks = known
            } else {
                tasks = seed
                persist()
            }
            if let known = try files.loadProjects(scope) {
                projects = known
            } else {
                projects = seedProjects
                if !seedProjects.isEmpty { persistProjects() }
            }
        } catch {
            tasks = []
            projects = []
            unreadable = true
            failure = Failure.unreadable.localizedDescription
            ErrorReports.capture(error, scope: "tasks")
        }
    }

    nonisolated static func selectedKey(_ scope: String) -> String { "tasks:project:\(scope)" }

    /** Shows one list, or every task for nil. */
    func select(_ project: String?) {
        guard let scope, project == nil || self.project(project) != nil else { return }
        selected = project
        defaults.set(project, forKey: Self.selectedKey(scope))
    }

    /** A new list, kept on disk before it's shown, and then the one shown. */
    @discardableResult
    func createProject(_ name: String) async throws -> TaskProject? {
        guard let name = TaskProject.named(name) else { return nil }
        let made = TaskProject(id: UUID().uuidString, name: name)
        // Asked again after the write, the lists may be the file a reopen read back, which already has it.
        guard try await commitProjects({ projects in projects.contains { $0.id == made.id } ? projects : projects + [made] }) else { return nil }
        select(made.id)
        return made
    }

    /** A list made here takes a new name; the Inbox keeps its own. */
    func renameProject(_ id: String, to name: String) async throws {
        guard let name = TaskProject.named(name) else { return }
        try await commitProjects { projects in
            guard let index = projects.firstIndex(where: { $0.id == id }) else { return nil }
            var projects = projects
            projects[index].name = name
            return projects
        }
    }

    /** Signing out: this account's reminders go, its tasks wait on disk for the next sign-in. */
    func close() {
        let closing = scope
        leave()
        tasks = []
        projects = []
        selected = nil
        scope = nil
        waiting = []
        failure = nil
        unreadable = false
        guard let closing else { return }
        // Delivered reminders are their own list, and leaving the demo doesn't clear it otherwise.
        notify { [reminders] _ in
            let mine = await reminders.pending() + reminders.delivered()
            let ours = mine.filter { TaskReminders.scope(of: $0) == closing }
            await reminders.remove(pending: ours, delivered: ours)
        }
    }

    func task(_ id: UUID) -> MailTask? { tasks.first { $0.id == id } }

    func contains(_ id: UUID) -> Bool { task(id) != nil }

    func linked(to event: CalendarEvent) -> [MailTask] { TaskLinks.linked(tasks, to: event) }

    func linked(thread: String, mailboxes: [String]) -> [MailTask] { TaskLinks.linked(tasks, thread: thread, mailboxes: mailboxes) }

    /**
     * A task's links changed from the event or conversation they point at, kept as Save keeps it: on disk first.
     * The change is made to the task as the save before it left it, so two quick links both stay.
     * What's written is what's shown: the change is asked again only if the task changed during the write.
     */
    func update(_ id: UUID, _ change: (MailTask) -> MailTask) async throws {
        var made: (from: MailTask, to: MailTask)?
        var saved: MailTask?
        try await commit { tasks in
            guard let index = tasks.firstIndex(where: { $0.id == id }) else { return nil }
            var tasks = tasks
            let from = tasks[index]
            let to = made.flatMap { $0.from == from ? $0.to : nil } ?? Self.trimmed(change(from))
            made = (from, to)
            tasks[index] = to
            guard !tasks[index].content.isEmpty else { return nil }
            saved = tasks[index]
            return tasks
        }
        if let saved { await remind(saved) }
    }

    /** Keeps a task, and only confirms it once the file is written (the editor waits on this). */
    func save(_ task: MailTask) async throws {
        let task = Self.trimmed(task)
        guard !task.content.isEmpty else { return }
        // Decided when Save is pressed: a task shown then and gone by its turn was deleted meanwhile, and stays gone.
        let adding = !contains(task.id)
        let kept = try await commit { tasks in
            var tasks = tasks
            if let index = tasks.firstIndex(where: { $0.id == task.id }) {
                tasks[index] = task
            } else if adding {
                tasks.append(task)
            } else {
                return nil
            }
            return tasks
        }
        if kept { await remind(task) }
    }

    private static func trimmed(_ task: MailTask) -> MailTask {
        var task = task
        task.content = task.content.trimmingCharacters(in: .whitespacesAndNewlines)
        return task
    }

    /** Nothing is asked of the user for a reminder that has already passed. */
    private func remind(_ task: MailTask) async {
        if let at = task.reminderAt, at > .now {
            await askForReminders()
        } else {
            reschedule()
        }
    }

    func delete(_ task: MailTask) {
        guard let scope else { return }
        tasks.removeAll { $0.id == task.id }
        persist()
        let gone = TaskReminders.identifier(task.id, scope: scope)
        notify { [reminders] _ in await reminders.remove(pending: [gone], delivered: [gone]) }
        reschedule()
    }

    func setDone(_ done: Bool, _ task: MailTask) {
        guard let index = tasks.firstIndex(where: { $0.id == task.id }) else { return }
        tasks[index].done = done
        tasks[index].completed = done ? .now : nil
        persist()
        reschedule()
    }

    /** Asked only when the user sets a reminder, never before. */
    func askForReminders() async {
        if await reminders.status() == .notDetermined { await reminders.ask() }
        await checkReminders()
        reschedule()
    }

    func checkReminders() async {
        remindersDenied = await reminders.status() == .denied
    }

    /** The nearest reminders, as requests; the ones that no longer apply are taken down. */
    func reschedule() {
        guard let scope else { return }
        let due = TaskReminders.scheduled(tasks)
        waiting = Set(TaskReminders.waiting(tasks).map(\.id))
        notify { [weak self] mine in await self?.apply(due, scope: scope, generation: mine) }
    }

    /** Whether this task's reminder is one of the ones waiting, counted with the task as it stands. */
    func isWaiting(_ task: MailTask) -> Bool {
        var counted = tasks.filter { $0.id != task.id }
        counted.append(task)
        return TaskReminders.waiting(counted).contains { $0.id == task.id }
    }

    /** The reminder work queued so far, which the tests wait on. */
    func settled() async {
        await lock()
        unlock()
        await queued?.value
    }

    /**
     * Reminder work, one job at a time: each waits for the one before it, and the
     * token it carries goes stale the moment anything else is asked for, so a job
     * from before a deletion or a sign-out can't put its requests back.
     */
    private func notify(_ work: @escaping (Int) async -> Void) {
        generation += 1
        let mine = generation
        let previous = queued
        queued = Task {
            await previous?.value
            await work(mine)
        }
    }

    private func current(_ generation: Int) -> Bool { generation == self.generation }

    private func apply(_ due: [MailTask], scope: String, generation mine: Int) async {
        let status = await reminders.status()
        let allowed = [.authorized, .provisional, .ephemeral].contains(status)
        guard current(mine) else { return }
        let keep = allowed ? Set(due.map { TaskReminders.identifier($0.id, scope: scope) }) : []
        let stale = await reminders.pending().filter { TaskReminders.scope(of: $0) == scope && !keep.contains($0) }
        guard current(mine) else { return }
        await reminders.remove(pending: stale, delivered: [])
        guard allowed else { return }
        for task in due {
            guard current(mine) else { return }
            await reminders.add(task, scope: scope)
        }
    }

    /**
     * One change to the tasks at a time: each is made to the list the one before
     * it left, written, then published, and only for the session it was asked in:
     * a change from before a sign-out or a switch of account is dropped. One the
     * switch catches while it's being written is shown only if its account is open
     * again, and what that session left queued writes it again (`ended`). The edit runs
     * again on the list as it stands then, so a done or a deletion made during
     * the write isn't undone. Returns whether the change was kept.
     */
    @discardableResult
    private func commit(_ edit: ([MailTask]) -> [MailTask]?) async throws -> Bool {
        let session = self.session
        await lock()
        defer { unlock() }
        guard session == self.session, let scope, let keeping = edit(tasks) else { return false }
        try await write(keeping, scope: scope)
        guard session == self.session else {
            // Written to its account, so the writes queued for that account since keep it too, and so does it if it's open again.
            for (key, shown) in ended where key >= session && shown.scope == scope {
                ended[key]?.tasks = edit(shown.tasks) ?? shown.tasks
            }
            guard self.scope == scope, !unreadable else { return false }
            tasks = edit(tasks) ?? tasks
            return true
        }
        tasks = edit(tasks) ?? tasks
        return true
    }

    /** The same for the lists, on the same turn as the tasks' writes. */
    @discardableResult
    private func commitProjects(_ edit: ([TaskProject]) -> [TaskProject]?) async throws -> Bool {
        let session = self.session
        await lock()
        defer { unlock() }
        guard session == self.session, let scope, let keeping = edit(projects) else { return false }
        try await writeProjects(keeping, scope: scope)
        guard session == self.session else {
            for (key, shown) in ended where key >= session && shown.scope == scope {
                ended[key]?.projects = edit(shown.projects) ?? shown.projects
            }
            guard self.scope == scope, !unreadable else { return false }
            projects = edit(projects) ?? projects
            return true
        }
        projects = edit(projects) ?? projects
        return true
    }

    private func lock() async {
        guard writing else {
            writing = true
            return
        }
        await withCheckedContinuation { waiters.append($0) }
    }

    /** The next change in line takes the turn as it is, so none slips in between. */
    private func unlock() {
        if waiters.isEmpty {
            writing = false
        } else {
            waiters.removeFirst().resume()
        }
    }

    /** Writes in the background, for the changes the list makes; a failure shows there. */
    private func persist() { flush(projects: false) }

    private func persistProjects() { flush(projects: true) }

    /**
     * A change already on screen, written on its turn: what the session shows
     * then, or, once it has ended, what it showed last, to its own account's file.
     */
    private func flush(projects: Bool) {
        let session = self.session
        queuedWrites[session, default: 0] += 1
        Task {
            await lock()
            defer {
                unlock()
                written(session)
            }
            guard let shown = session == self.session ? showing : ended[session] else { return }
            do {
                guard !shown.unreadable else { throw Failure.unreadable }
                if projects {
                    try await files.saveProjects(shown.projects, scope: shown.scope)
                } else {
                    try await files.save(shown.tasks, scope: shown.scope)
                }
            } catch {
                if session == self.session {
                    failure = error.localizedDescription
                } else if !shown.unreadable {
                    ErrorReports.capture(error, scope: "tasks")
                }
            }
        }
    }

    private func written(_ session: Int) {
        let left = (queuedWrites[session] ?? 1) - 1
        queuedWrites[session] = left > 0 ? left : nil
        if left <= 0 { ended[session] = nil }
    }

    /** Ends the session: what it shows is kept for the writes it has queued. */
    private func leave() {
        if queuedWrites[session] != nil { ended[session] = showing }
        session += 1
    }

    private var showing: Shown? { scope.map { Shown(scope: $0, tasks: tasks, projects: projects, unreadable: unreadable) } }

    private func write(_ tasks: [MailTask], scope: String) async throws {
        guard !unreadable else { throw Failure.unreadable }
        try await files.save(tasks, scope: scope)
    }

    private func writeProjects(_ projects: [TaskProject], scope: String) async throws {
        guard !unreadable else { throw Failure.unreadable }
        try await files.saveProjects(projects, scope: scope)
    }
}
