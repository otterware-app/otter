import Foundation

/** A conversation a task is linked to, as the Todoist extension links one (`{ accountId, messageId }`). */
nonisolated struct TaskEmail: Hashable, Codable, Sendable {
    /** The mailbox's address, which is what the app scopes mail by. */
    var mailbox: String
    var thread: String
    var message: String? = nil
    var subject: String

    init(mailbox: String, thread: String, message: String? = nil, subject: String) {
        self.mailbox = mailbox
        self.thread = thread
        self.message = message
        self.subject = subject
    }

    init(_ thread: MailThread, mailbox: String) {
        let subject = thread.subject.trimmingCharacters(in: .whitespacesAndNewlines)
        self.init(mailbox: mailbox, thread: thread.id, message: thread.latest.id, subject: subject.isEmpty ? "(no subject)" : subject)
    }

    /** One link a conversation: the same thread in the same mailbox, whatever its address's case. */
    var key: String { "\(mailbox.lowercased())|\(thread)" }

    func links(_ thread: String, mailbox: String) -> Bool {
        self.thread == thread && self.mailbox.lowercased() == mailbox.lowercased()
    }
}


/**
 * A calendar event a task is linked to: who holds it (the provider, the
 * mailbox's address, the calendar's id) and which event, the occurrence picked
 * or its whole series (`scope`), chosen when it's linked. What it was called
 * and when are kept with it, so the link reads the same offline, outside the
 * windows loaded, and once the event is gone. Google's instance ids are stable
 * for an occurrence (`<series>_<original start>`); `originalStart` with the
 * series finds one all the same, and the series is core's `seriesId`
 * (packages/core/src/providers/gmail/calendar.ts).
 */
nonisolated struct TaskEvent: Hashable, Codable, Sendable {
    enum Scope: String, Codable, Sendable, CaseIterable {
        case occurrence, series

        var title: String {
            switch self {
            case .occurrence: "This event"
            case .series: "Whole series"
            }
        }
    }

    /** The iPhone's calendar is Google's (`CalendarStore`); the field keeps another provider's ids apart. */
    var provider = "google"
    /** The mailbox's address, lowercased (core's `accountId`). */
    var account: String
    var calendarId: String
    /** The occurrence's own id; for a series, the occurrence it was linked from. */
    var eventId: String
    var seriesId: String? = nil
    /** Where the occurrence was before it was moved (Google's `originalStartTime`). */
    var originalStart: Date? = nil
    var scope: Scope = .occurrence
    var title: String
    var start: Date
    var end: Date? = nil
    var allDay = false

    init(
        provider: String = "google", account: String, calendarId: String, eventId: String, seriesId: String? = nil,
        originalStart: Date? = nil, scope: Scope = .occurrence, title: String, start: Date, end: Date? = nil, allDay: Bool = false
    ) {
        self.provider = provider
        self.account = account.lowercased()
        self.calendarId = Self.calendarId(calendarId, account: account, provider: provider)
        self.eventId = eventId
        self.seriesId = seriesId
        self.originalStart = originalStart
        // Only an event of a series can be linked as the series.
        self.scope = seriesId == nil ? .occurrence : scope
        self.title = title
        self.start = start
        self.end = end
        self.allDay = allDay
    }

    init(_ event: CalendarEvent, scope: Scope) {
        self.init(
            account: event.calendar.account, calendarId: event.calendar.id, eventId: event.eventId, seriesId: event.seriesId,
            originalStart: event.originalStart, scope: scope, title: event.title, start: event.start, end: event.end,
            allDay: event.allDay
        )
    }

    private enum CodingKeys: String, CodingKey {
        case provider, account, calendarId, eventId, seriesId, originalStart, scope, title, start, end, allDay
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            provider: try container.decodeIfPresent(String.self, forKey: .provider) ?? "google",
            account: try container.decode(String.self, forKey: .account),
            calendarId: try container.decode(String.self, forKey: .calendarId),
            eventId: try container.decode(String.self, forKey: .eventId),
            seriesId: try container.decodeIfPresent(String.self, forKey: .seriesId),
            originalStart: try container.decodeIfPresent(Date.self, forKey: .originalStart),
            // A scope a newer build wrote reads as the one occurrence, the narrower link.
            scope: (try? container.decodeIfPresent(Scope.self, forKey: .scope)) ?? .occurrence,
            title: try container.decodeIfPresent(String.self, forKey: .title) ?? "(no title)",
            start: try container.decode(Date.self, forKey: .start),
            end: try container.decodeIfPresent(Date.self, forKey: .end),
            allDay: try container.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        )
    }

    /**
     * Google's primary calendar is listed as `primary` (core's listCalendars);
     * links made before that name it by its id, which is the account's address.
     */
    static func calendarId(_ id: String, account: String, provider: String) -> String {
        provider == "google" && id.lowercased() == account.lowercased() ? "primary" : id
    }

    var recurring: Bool { seriesId != nil }

    /** One link an occurrence or a series: `provider|account|calendar|event`, or `…|series:<id>`. */
    var key: String {
        let target = scope == .series ? "series:\(seriesId ?? eventId)" : eventId
        return "\(provider)|\(account)|\(calendarId)|\(target)"
    }

    /** Whether an event the calendar shows is what this links to: the occurrence itself, or any of the series. */
    func matches(_ event: CalendarEvent) -> Bool {
        guard provider == "google", account == event.calendar.account.lowercased(), calendarId == event.calendar.id else {
            return false
        }
        switch scope {
        case .series:
            guard let seriesId else { return false }
            return event.seriesId == seriesId || event.eventId == seriesId
        case .occurrence:
            if event.eventId == eventId { return true }
            guard let seriesId, let originalStart, let other = event.originalStart else { return false }
            return event.seriesId == seriesId && other == originalStart
        }
    }

    /** The same link at the other scope: the series from one of its occurrences, or that occurrence back. */
    func scoped(_ scope: Scope) -> TaskEvent {
        var link = self
        link.scope = recurring ? scope : .occurrence
        return link
    }

    /**
     * The event as the link remembers it, for opening it when the calendar
     * hasn't loaded it (or no longer has it): read-only, on the calendar it was on.
     */
    func snapshot(calendar: EventCalendar?) -> CalendarEvent {
        let on = calendar ?? EventCalendar(id: calendarId, name: calendarId, account: account)
        let length: TimeInterval = allDay ? 86400 : 3600
        return CalendarEvent(
            eventId: eventId, calendar: on, title: title, start: start, end: end ?? start.addingTimeInterval(length),
            allDay: allDay, recurring: recurring, seriesId: seriesId, originalStart: originalStart
        )
    }
}

/** Linking a task to mail and events, and finding the tasks linked to one: one link a target, in the order made. */
nonisolated enum TaskLinks {
    static func unique(_ emails: [TaskEmail]) -> [TaskEmail] {
        var seen: Set<String> = []
        return emails.filter { seen.insert($0.key).inserted }
    }

    static func unique(_ events: [TaskEvent]) -> [TaskEvent] {
        var seen: Set<String> = []
        return events.filter { seen.insert($0.key).inserted }
    }

    static func linking(_ task: MailTask, email: TaskEmail) -> MailTask {
        var task = task
        task.emails = unique(task.emails + [email])
        return task
    }

    static func linking(_ task: MailTask, event: TaskEvent) -> MailTask {
        var task = task
        task.events = unique(task.events + [event])
        return task
    }

    static func unlinking(_ task: MailTask, email key: String) -> MailTask {
        var task = task
        task.emails.removeAll { $0.key == key }
        return task
    }

    static func unlinking(_ task: MailTask, event key: String) -> MailTask {
        var task = task
        task.events.removeAll { $0.key == key }
        return task
    }

    /** A link's scope changed in place: an occurrence widened to its series, or narrowed back, still one link. */
    static func rescoping(_ task: MailTask, event key: String, to scope: TaskEvent.Scope) -> MailTask {
        var task = task
        task.events = unique(task.events.map { $0.key == key ? $0.scoped(scope) : $0 })
        return task
    }

    /**
     * The events a task can be linked to: today's and later ones, and those still going, soonest first.
     * Google lists every event that overlaps the window, however long ago it began.
     */
    static func upcoming(_ events: [CalendarEvent], now: Date, dates: CalendarDates) -> [CalendarEvent] {
        let today = dates.startOfDay(now)
        return events.filter { $0.start >= today || $0.end > now }.sorted { a, b in
            if a.start != b.start { return a.start < b.start }
            if a.allDay != b.allDay { return a.allDay }
            if a.end != b.end { return a.end > b.end }
            return a.id < b.id
        }
    }

    static func linked(_ tasks: [MailTask], to event: CalendarEvent) -> [MailTask] {
        tasks.filter { $0.events.contains { $0.matches(event) } }
    }

    /** The tasks linked to a conversation, under any of the addresses it's shown in (an alias's, or its mailbox's). */
    static func linked(_ tasks: [MailTask], thread: String, mailboxes: [String]) -> [MailTask] {
        tasks.filter { task in task.emails.contains { email in mailboxes.contains { email.links(thread, mailbox: $0) } } }
    }

    /** The links of a task's that reach this event (an occurrence's and its series' may both). */
    static func links(of task: MailTask, to event: CalendarEvent) -> [TaskEvent] {
        task.events.filter { $0.matches(event) }
    }
}

/** An element of a list on disk that may not decode: the rest of the list still does. */
nonisolated struct Lossy<Value: Decodable>: Decodable {
    let value: Value?

    init(from decoder: Decoder) throws {
        value = try? Value(from: decoder)
    }
}
