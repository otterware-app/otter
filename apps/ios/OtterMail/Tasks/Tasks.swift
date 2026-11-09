import Foundation

/**
 * A task on this iPhone. New logic, local only: nothing here syncs, and there
 * is no task backend in the other apps. Its shape follows the Todoist
 * extension's (packages/contracts/src/todoist.ts: `content`, `description`, a
 * due date, and the email a task came from), so a later sync, to Todoist or
 * to the Otter account, has somewhere to go.
 */
nonisolated struct MailTask: Identifiable, Hashable, Codable, Sendable {
    var id = UUID()
    /** Todoist's `content`. */
    var content = ""
    /** Todoist's `description`. */
    var notes = ""
    var due: Date? = nil
    /** A due date at a time, rather than a day; only then can it remind. */
    var hasTime = false
    var reminder = false
    var done = false
    var completed: Date? = nil
    var created = Date.now
    /** The conversations it's linked to, the one it came from first (Todoist's `email`, as many as it needs). */
    var emails: [TaskEmail] = []
    /** The calendar events it's linked to: an occurrence, or a whole series. */
    var events: [TaskEvent] = []
    /** The list it's on (Todoist's `projectId`); nil is the Inbox, as every task was before lists. */
    var projectId: String? = nil

    /** The conversation it came from, which is what a file from before several links held. */
    var email: TaskEmail? { emails.first }

    /** When a local notification is due: a time, still to come, on a task that isn't finished. */
    var reminderAt: Date? {
        guard reminder, hasTime, !done, let due else { return nil }
        return due
    }

    /** What its reminder says under the task itself. */
    var reminderBody: String {
        let line = notes.split(separator: "\n").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        if !line.isEmpty { return line }
        if let email { return "From: \(email.subject)" }
        return events.first.map { "For: \($0.title)" } ?? "Task reminder"
    }

    private enum CodingKeys: String, CodingKey {
        case id, content, notes, due, hasTime, reminder, done, completed, created, email, emails, events, projectId
    }

    init(
        id: UUID = UUID(), content: String = "", notes: String = "", due: Date? = nil, hasTime: Bool = false,
        reminder: Bool = false, done: Bool = false, completed: Date? = nil, created: Date = .now, email: TaskEmail? = nil,
        emails: [TaskEmail] = [], events: [TaskEvent] = [], projectId: String? = nil
    ) {
        self.id = id
        self.content = content
        self.notes = notes
        self.due = due
        self.hasTime = hasTime
        self.reminder = reminder
        self.done = done
        self.completed = completed
        self.created = created
        self.emails = TaskLinks.unique((email.map { [$0] } ?? []) + emails)
        self.events = TaskLinks.unique(events)
        self.projectId = projectId
    }

    /** "Add task" in the reader: the subject, linked back to the conversation. */
    init(from thread: MailThread, mailbox: String) {
        let subject = thread.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        content = subject.isEmpty ? "Reply to \(thread.latest.from.label)" : subject
        emails = [TaskEmail(thread, mailbox: mailbox)]
    }

    /** "Add task" on an event: its title, linked to the occurrence or to its whole series, as picked. */
    init(from event: CalendarEvent, scope: TaskEvent.Scope) {
        content = event.title
        events = [TaskEvent(event, scope: scope)]
    }

    /** A file written by an older or newer build keeps what it can. */
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(UUID.self, forKey: .id) ?? UUID()
        content = try container.decodeIfPresent(String.self, forKey: .content) ?? ""
        notes = try container.decodeIfPresent(String.self, forKey: .notes) ?? ""
        due = try container.decodeIfPresent(Date.self, forKey: .due)
        hasTime = try container.decodeIfPresent(Bool.self, forKey: .hasTime) ?? false
        reminder = try container.decodeIfPresent(Bool.self, forKey: .reminder) ?? false
        done = try container.decodeIfPresent(Bool.self, forKey: .done) ?? false
        completed = try container.decodeIfPresent(Date.self, forKey: .completed)
        created = try container.decodeIfPresent(Date.self, forKey: .created) ?? .now
        // A file from before several links has the one `email`; a link this build can't read is left out, not the task.
        let single = (try? container.decodeIfPresent(TaskEmail.self, forKey: .email)) ?? nil
        let many = (try? container.decodeIfPresent([Lossy<TaskEmail>].self, forKey: .emails))?.compactMap(\.value)
        emails = TaskLinks.unique(many ?? single.map { [$0] } ?? [])
        let linked = (try? container.decodeIfPresent([Lossy<TaskEvent>].self, forKey: .events))?.compactMap(\.value)
        events = TaskLinks.unique(linked ?? [])
        projectId = try container.decodeIfPresent(String.self, forKey: .projectId)
    }

    /** `email` is written too, the first link, so a build from before several links still reads where a task came from. */
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(content, forKey: .content)
        try container.encode(notes, forKey: .notes)
        try container.encodeIfPresent(due, forKey: .due)
        try container.encode(hasTime, forKey: .hasTime)
        try container.encode(reminder, forKey: .reminder)
        try container.encode(done, forKey: .done)
        try container.encodeIfPresent(completed, forKey: .completed)
        try container.encode(created, forKey: .created)
        try container.encodeIfPresent(email, forKey: .email)
        try container.encode(emails, forKey: .emails)
        try container.encode(events, forKey: .events)
        try container.encodeIfPresent(projectId, forKey: .projectId)
    }
}

/**
 * A list of tasks, shaped as the Todoist extension's projects are
 * (packages/contracts/src/todoist.ts's `TodoistProject`: an id and a name), and
 * local to this iPhone like the tasks. The Inbox is every task without one.
 */
nonisolated struct TaskProject: Identifiable, Hashable, Codable, Sendable {
    var id: String
    var name: String

    static let inbox = TaskProject(id: "inbox", name: "Inbox")

    /** The tasks on a list: every one for All (nil), the ones without a list for the Inbox. */
    static func filter(_ tasks: [MailTask], project: String?) -> [MailTask] {
        guard let project else { return tasks }
        return tasks.filter { ($0.projectId ?? inbox.id) == project }
    }

    /** A name as it's kept: trimmed, and nil when that leaves nothing. */
    static func named(_ name: String) -> String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(100))
    }
}

nonisolated enum TaskHeading: String, CaseIterable, Identifiable, Sendable {
    case overdue, today, upcoming, noDate, done

    var id: String { rawValue }

    var title: String {
        switch self {
        case .overdue: "Overdue"
        case .today: "Today"
        case .upcoming: "Upcoming"
        case .noDate: "No date"
        case .done: "Done"
        }
    }
}

nonisolated struct TaskSection: Identifiable, Sendable {
    let id: TaskHeading
    let tasks: [MailTask]
}

/**
 * How the list reads: by when a task is due, in the calendar's days
 * (`CalendarDates`, ported from the Mac and web apps) rather than dates of its
 * own, so "today" means today where the user is.
 */
nonisolated enum TaskList {
    static func group(of task: MailTask, now: Date, dates: CalendarDates) -> TaskHeading {
        if task.done { return .done }
        guard let due = task.due else { return .noDate }
        if dates.sameDay(due, now) { return task.hasTime && due < now ? .overdue : .today }
        return dates.startOfDay(due) < dates.startOfDay(now) ? .overdue : .upcoming
    }

    /** Soonest first, the undated last, then by when it was written. */
    static func sorted(_ tasks: [MailTask]) -> [MailTask] {
        tasks.sorted { a, b in
            if let first = a.due, let second = b.due, first != second { return first < second }
            if (a.due == nil) != (b.due == nil) { return b.due == nil }
            if a.created != b.created { return a.created < b.created }
            return a.id.uuidString < b.id.uuidString
        }
    }

    /** The sections the list shows, in `TaskHeading`'s order; an empty one is left out. */
    static func sections(_ tasks: [MailTask], now: Date, dates: CalendarDates) -> [TaskSection] {
        let grouped = Dictionary(grouping: tasks) { group(of: $0, now: now, dates: dates) }
        return TaskHeading.allCases.compactMap { heading -> TaskSection? in
            guard let found = grouped[heading], !found.isEmpty else { return nil }
            // Finished tasks read newest first; the rest by when they're due.
            let ordered = heading == .done
                ? found.sorted { ($0.completed ?? $0.created) > ($1.completed ?? $1.created) }
                : sorted(found)
            return TaskSection(id: heading, tasks: ordered)
        }
    }

    /** "Today · 18:00", "Tomorrow", "Thu, Nov 12": the calendar's own words. */
    static func dueLabel(_ task: MailTask, now: Date, dates: CalendarDates) -> String? {
        guard let due = task.due else { return nil }
        let day = dates.heading(due, now: now)
        return task.hasTime ? "\(day) · \(dates.timeLabel(due))" : day
    }
}
