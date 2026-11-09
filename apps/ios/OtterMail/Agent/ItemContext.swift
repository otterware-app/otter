import Foundation

/**
 * An event or a task given to the agent: the text it reads, in the handoff's
 * context block beside the conversations (`MailContext`), which the agent can
 * fetch itself. Its title and `summary` show in the composer; the text is what
 * is sent, and can be read there too before sending.
 */
nonisolated struct ItemContext: Hashable {
    enum Kind: Hashable {
        case event, task

        var name: String {
            switch self {
            case .event: "Event"
            case .task: "Task"
            }
        }

        var symbol: String {
            switch self {
            case .event: "calendar"
            case .task: "checklist"
            }
        }
    }

    var kind: Kind
    var title: String
    /** A few short lines: when, where, its list. */
    var summary: [String]
    var text: String

    /** Long descriptions are cut, as a conversation's body would be fetched rather than pasted. */
    static let detailLimit = 4000

    static func event(_ event: CalendarEvent, dates: CalendarDates) -> ItemContext {
        let location = text(event.location)
        let details = text(event.details.map(EventDescription.plain))
        let guests = event.guests.map { "\($0.person.label) (\($0.response.title.lowercased()))" }
        var lines = [
            "Title: \(event.title)",
            "When: \(dates.when(event))",
            "Calendar: \(event.calendar.name) [\(event.calendar.account)]",
        ]
        if let location { lines.append("Where: \(location)") }
        if let link = event.meetingLink { lines.append("Meeting: \(link)") }
        if let organizer = event.organizer { lines.append("Organizer: \(organizer.label)") }
        if !guests.isEmpty { lines.append("Guests: \(guests.joined(separator: ", "))") }
        if event.recurring { lines.append("Repeats") }
        if let details { lines.append("Description:\n\(String(details.prefix(detailLimit)))") }
        lines.append("(Google Calendar event \(event.eventId) on calendar \(event.calendar.id))")
        return ItemContext(
            kind: .event,
            title: event.title,
            summary: [dates.when(event), location].compactMap { $0 },
            text: lines.joined(separator: "\n")
        )
    }

    static func task(_ task: MailTask, lists: [TaskProject], dates: CalendarDates, now: Date = .now) -> ItemContext {
        let list = lists.first { $0.id == (task.projectId ?? TaskProject.inbox.id) }?.name ?? TaskProject.inbox.name
        let due = TaskList.dueLabel(task, now: now, dates: dates)
        let notes = text(task.notes)
        var lines = ["Task: \(task.content)", "List: \(list)", "Status: \(task.done ? "done" : "open")"]
        if let due { lines.append("Due: \(due)") }
        if let notes { lines.append("Notes:\n\(String(notes.prefix(detailLimit)))") }
        for email in task.emails {
            lines.append("Linked conversation: \"\(email.subject)\" [\(email.mailbox)] (threadId \(email.thread))")
        }
        for event in task.events {
            let what = event.scope == .series ? "every event of the series" : "event"
            lines.append("Linked \(what): \"\(event.title)\" (\(dates.heading(event.start, now: now)))")
        }
        let links = task.emails.count + task.events.count
        return ItemContext(
            kind: .task,
            title: task.content,
            summary: [due.map { "Due \($0)" }, list, links == 0 ? nil : links == 1 ? "1 link" : "\(links) links"].compactMap { $0 },
            text: lines.joined(separator: "\n")
        )
    }

    private static func text(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
