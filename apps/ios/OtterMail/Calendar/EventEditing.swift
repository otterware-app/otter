import Foundation

/**
 * What a change to an event says, as the web app's EventInput (apps/web/src/main/calendar/api.ts)
 * says it: only the fields that change, an all-day event's times as local days
 * ("2026-05-04", the end the day after its last), a timed one's as instants.
 */
nonisolated struct EventInput: Equatable {
    enum Time: Equatable {
        case day(String)
        case instant(Date)
    }

    var title: String?
    var start: Time?
    var end: Time?
    var allDay: Bool?
    var location: String?
    var description: String?

    var isEmpty: Bool { self == EventInput() }

    /** The event with these changes in it, as Google hands it back (api.ts's update shows it so at once). */
    func applied(to event: CalendarEvent, dates: CalendarDates = CalendarDates()) -> CalendarEvent {
        var event = event
        let times = EventTimes(calendar: dates.calendar)
        let date = { (time: Time) -> Date? in
            switch time {
            case .day(let day): times.day(day)
            case .instant(let instant): instant
            }
        }
        if let title { event.title = title }
        if let allDay { event.allDay = allDay }
        if let start, let value = date(start) { event.start = value }
        if let end, let value = date(end) { event.end = value }
        if let location { event.location = location.isEmpty ? nil : location }
        if let description { event.details = description.isEmpty ? nil : description }
        return event
    }
}

/**
 * An event being made or changed, as event-panel.tsx's NewEvent and
 * EventDetails hold it: its calendar, title, times (an all-day event's `end`
 * the midnight after its last day, as Google writes it), place and notes.
 */
nonisolated struct EventDraft: Hashable {
    var calendar: EventCalendar
    var title = ""
    var start: Date
    var end: Date
    var allDay = false
    var location = ""
    var notes = ""

    static let hour: TimeInterval = 3600

    /**
     * A new event an hour long: from the next hour when it's for today, else at
     * 9 on that day, as month-grid.tsx's double-click puts one.
     */
    static func new(on calendar: EventCalendar, day: Date, now: Date = .now, dates: CalendarDates = CalendarDates()) -> EventDraft {
        let start: Date
        if dates.sameDay(day, now) {
            start = dates.calendar.dateInterval(of: .hour, for: now)?.end ?? now
        } else {
            start = dates.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: dates.startOfDay(day)) ?? day
        }
        return EventDraft(calendar: calendar, start: start, end: start.addingTimeInterval(hour))
    }

    /** An event as it is, its description read as plain text, as EventDetails edits it. */
    init(editing event: CalendarEvent) {
        calendar = event.calendar
        title = event.title == "(no title)" ? "" : event.title
        start = event.start
        end = event.end
        allDay = event.allDay
        location = event.location ?? ""
        notes = event.details.map(EventDescription.plain) ?? ""
    }

    init(calendar: EventCalendar, title: String = "", start: Date, end: Date, allDay: Bool = false, location: String = "", notes: String = "") {
        self.calendar = calendar
        self.title = title
        self.start = start
        self.end = end
        self.allDay = allDay
        self.location = location
        self.notes = notes
    }

    /** The last day an all-day event covers: the day before its end. */
    func lastDay(dates: CalendarDates = CalendarDates()) -> Date {
        dates.addDays(dates.startOfDay(end), -1)
    }

    /**
     * TimeRows' All-day: on, the days it covers; off, 9 to 10 on its first day.
     */
    mutating func setAllDay(_ on: Bool, dates: CalendarDates = CalendarDates()) {
        guard on != allDay else { return }
        let first = dates.startOfDay(start)
        if on {
            end = dates.addDays(dates.startOfDay(end.addingTimeInterval(-1)), 1)
            start = first
            if end <= start { end = dates.addDays(start, 1) }
        } else {
            start = dates.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: first) ?? first
            end = start.addingTimeInterval(Self.hour)
        }
        allDay = on
    }

    /** A new start keeps the event's length, as TimeRows' start does. */
    mutating func move(to next: Date) {
        let length = end.timeIntervalSince(start)
        start = next
        end = next.addingTimeInterval(max(length, 0))
    }

    /** The last day picked for an all-day event: it ends the midnight after. */
    mutating func setLastDay(_ day: Date, dates: CalendarDates = CalendarDates()) {
        end = dates.addDays(dates.startOfDay(day), 1)
    }

    /** Why it can't be saved yet, or nil. */
    var problem: String? {
        if !calendar.writable { return "This calendar can't be changed from Otter Mail." }
        if end <= start { return allDay ? "The last day can't be before the first." : "The end has to be after the start." }
        return nil
    }

    /** NewEvent's create: a title (or "(no title)"), its times, and the place when there is one. */
    func input(dates: CalendarDates = CalendarDates()) -> EventInput {
        let (start, end) = times(dates: dates)
        let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        return EventInput(
            title: Self.title(title),
            start: start,
            end: end,
            allDay: allDay ? true : nil,
            location: place.isEmpty ? nil : place,
            description: note.isEmpty ? nil : note
        )
    }

    /**
     * EventDetails' commits, made at once: each field that changed from what was
     * there, and both times (with All-day) when any of them did.
     */
    func patch(from original: EventDraft, dates: CalendarDates = CalendarDates()) -> EventInput {
        var patch = EventInput()
        if Self.title(title) != Self.title(original.title) { patch.title = Self.title(title) }
        if start != original.start || end != original.end || allDay != original.allDay {
            let (from, to) = times(dates: dates)
            patch.start = from
            patch.end = to
            patch.allDay = allDay
        }
        let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
        if place != original.location.trimmingCharacters(in: .whitespacesAndNewlines) { patch.location = place }
        let note = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        if note != original.notes.trimmingCharacters(in: .whitespacesAndNewlines) { patch.description = note }
        return patch
    }

    /** api.ts's eventTimes: instants, or local days with the end at least the day after the start. */
    private func times(dates: CalendarDates) -> (EventInput.Time, EventInput.Time) {
        guard allDay else { return (.instant(start), .instant(end)) }
        let first = dates.startOfDay(start)
        let after = max(dates.startOfDay(end), dates.addDays(first, 1))
        return (.day(dates.dayKey(first)), .day(dates.dayKey(after)))
    }

    private static func title(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "(no title)" : trimmed
    }
}

/**
 * Google Calendar's request body for an EventInput, as core's apiBody builds it
 * (packages/core/src/providers/gmail/calendar.ts): summary, location,
 * description, and `start`/`end` as `{date}` or `{dateTime, timeZone}`. A
 * change between all-day and timed clears the other kind, so Google's merge
 * of a PATCH doesn't leave both on the event.
 */
nonisolated enum EventBody {
    static func json(_ input: EventInput, timeZone: String = TimeZone.current.identifier, wasAllDay: Bool? = nil) -> [String: Any] {
        var body: [String: Any] = [:]
        if let title = input.title { body["summary"] = title }
        if let location = input.location { body["location"] = location }
        if let description = input.description { body["description"] = description }
        let clears = wasAllDay != nil && input.allDay != nil && wasAllDay != input.allDay
        if let start = input.start { body["start"] = time(start, timeZone: timeZone, clears: clears) }
        if let end = input.end { body["end"] = time(end, timeZone: timeZone, clears: clears) }
        return body
    }

    private static func time(_ time: EventInput.Time, timeZone: String, clears: Bool) -> [String: Any] {
        switch time {
        case .day(let day):
            return clears ? ["date": day, "dateTime": NSNull(), "timeZone": NSNull()] : ["date": day]
        case .instant(let date):
            let instant = date.formatted(.iso8601)
            return clears ? ["dateTime": instant, "timeZone": timeZone, "date": NSNull()] : ["dateTime": instant, "timeZone": timeZone]
        }
    }
}

/**
 * Where an event's changes go: Google Calendar (`GoogleCalendarAPI`), or a
 * stand-in in the tests. `notify` is Google's sendUpdates (all, or none).
 */
nonisolated protocol EventWriter: Sendable {
    func create(_ input: EventInput, on calendar: EventCalendar, notify: Bool) async throws -> CalendarEvent
    func update(_ event: CalendarEvent, with patch: EventInput, notify: Bool) async throws -> CalendarEvent
    func delete(_ event: CalendarEvent, notify: Bool) async throws
}

/**
 * calendar-view.tsx's defaultCalendarOf: where new events go, the calendar
 * picked as the default, else the first primary one that takes them, else
 * the first that does. Core lists a primary calendar as `primary`, so the
 * pick may name it so.
 */
nonisolated func defaultCalendar(of calendars: [EventCalendar], chosen: String) -> EventCalendar? {
    let writable = calendars.filter(\.writable)
    let picked = writable.first { calendar in
        calendar.key == chosen || (calendar.primary && EventStyle.key(mailbox: calendar.account, calendar: "primary") == chosen)
    }
    return picked ?? writable.first(where: \.primary) ?? writable.first
}

nonisolated extension CalendarEvent {
    /** event-panel.tsx's mine: no organizer, or this mailbox is it. */
    var isMine: Bool {
        organizer.map { $0.email.lowercased() == calendar.account.lowercased() } ?? true
    }

    /** api.ts's hasGuests: someone besides this mailbox is on it, so changes are sent to them. */
    var hasGuests: Bool {
        attendees.contains { $0.person.email.lowercased() != calendar.account.lowercased() }
    }

    /** Offers Edit: on a calendar that takes changes, and not someone else's invitation. */
    var isEditable: Bool { calendar.writable && isMine && status != .cancelled }
}
