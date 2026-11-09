import Foundation

/**
 * The calendar the screens show, as core maps it (contracts' CalendarEvent and
 * packages/core/src/providers/gmail/calendar.ts) in the phone's types: times as
 * Dates, and an all-day event from local midnight to the midnight after its
 * last day, which is how Google writes it.
 */
nonisolated struct CalendarEvent: Identifiable, Hashable {
    enum Status: String {
        case confirmed, tentative, cancelled
    }

    enum Response: String {
        case needsAction, accepted, declined, tentative

        var title: String {
            switch self {
            case .needsAction: "No answer"
            case .accepted: "Going"
            case .declined: "Not going"
            case .tentative: "Maybe"
            }
        }

        var symbol: String {
            switch self {
            case .needsAction: "circle.dotted"
            case .accepted: "checkmark.circle.fill"
            case .declined: "xmark.circle.fill"
            case .tentative: "questionmark.circle.fill"
            }
        }

        /** eventPresentation.ts's RESPONSE_ORDER: yes, maybe, not answered, no. */
        var order: Int {
            switch self {
            case .accepted: 0
            case .tentative: 1
            case .needsAction: 2
            case .declined: 3
            }
        }
    }

    struct Attendee: Identifiable, Hashable {
        var person: Person
        var response: Response = .needsAction
        /** A room rather than a guest (Google's `resource`). */
        var room = false

        var id: String { person.email.lowercased() }
    }

    var eventId: String
    var calendar: EventCalendar
    var title: String
    var start: Date
    var end: Date
    var allDay = false
    /** The zone the event was made in (Google's `start.timeZone`), when it says. */
    var timeZone: String? = nil
    var location: String? = nil
    /** Google's description, often HTML. */
    var details: String? = nil
    var status: Status = .confirmed
    var organizer: Person? = nil
    var attendees: [Attendee] = []
    /** The mailbox's own answer, or nil when it isn't among the attendees. */
    var response: Response? = nil
    var meetingLink: String? = nil
    var htmlLink: String? = nil
    var recurring = false
    /**
     * The series an occurrence is of (Google's `recurringEventId`), or the
     * series itself for its first event (core's `seriesId`): an invitation is
     * answered for all of it.
     */
    var seriesId: String? = nil
    /** Where an occurrence of a series was before it was moved (Google's `originalStartTime`). */
    var originalStart: Date? = nil

    var id: String { "\(calendar.key)/\(eventId)" }

    /**
     * Who's coming, as the Otter mobile calendar sorts them
     * (eventPresentation.ts's sortedGuests): the organizer first, then yes,
     * maybe, not answered, no; by name within. Rooms aren't guests.
     */
    var guests: [Attendee] {
        let organizes = { (who: Attendee) in self.organizer?.isAddress(who.person.email) == true }
        return attendees.filter { !$0.room }.sorted { a, b in
            if organizes(a) != organizes(b) { return organizes(a) }
            if a.response != b.response { return a.response.order < b.response.order }
            return a.person.label.localizedCaseInsensitiveCompare(b.person.label) == .orderedAscending
        }
    }

    var rooms: [Attendee] { attendees.filter(\.room) }

    /** "3 yes, 1 maybe, 2 awaiting": eventPresentation.ts's responseSummary. */
    static func responseSummary(_ guests: [Attendee]) -> String {
        let count = { (response: Response) in guests.count(where: { $0.response == response }) }
        return [(count(.accepted), "yes"), (count(.tentative), "maybe"), (count(.declined), "no"), (count(.needsAction), "awaiting")]
            .filter { $0.0 > 0 }
            .map { "\($0.0) \($0.1)" }
            .joined(separator: ", ")
    }
}

/**
 * How a row states an event's time on the day it's listed under, as the Otter
 * mobile calendar's agendaRows.ts does: its own range, the whole day, or where
 * a longer event starts (`from`) or ends (`until`) on this day.
 */
nonisolated struct EventTiming: Hashable {
    enum Kind: Hashable { case range, allDay, from, until }

    var kind: Kind
    /** For an event over several days: which day this is (1-based) and of how many. */
    var dayOfSpan: Int? = nil
    var spanDays: Int? = nil
}

/** One of the account's calendars (core's CalendarInfo). */
nonisolated struct EventCalendar: Identifiable, Hashable {
    var id: String
    var name: String
    var color: String? = nil
    var primary = false
    /** Turned on in Google Calendar (core's `hiddenByDefault`, the other way round). */
    var shown = true
    /** The mailbox's address it's read from (core's `accountId`). */
    var account = ""
    /** Takes new events and changes: Google's accessRole owner or writer (core's `writable`). */
    var writable = false

    /** api.ts's calendarKey: every account's primary calendar is `primary`, so its identity is the pair. */
    var key: String { EventStyle.key(mailbox: account, calendar: id) }

    func of(_ account: String) -> EventCalendar {
        var calendar = self
        calendar.account = account
        return calendar
    }
}

nonisolated struct EventDay: Identifiable, Hashable {
    let id: Date
    let events: [CalendarEvent]
}

/**
 * The events a day, a week, a month and the agenda list, as the Mac and web
 * apps list them (apps/web/src/main/calendar's month-grid.tsx, time-grid.tsx
 * and agenda.tsx). Every day is a local day, so an event is on the days it
 * covers where the user is.
 */
nonisolated enum EventDays {
    /** All day first, then by time, the longer first: month-grid.tsx's order. */
    static func sorted(_ events: [CalendarEvent]) -> [CalendarEvent] {
        events.sorted { a, b in
            if a.allDay != b.allDay { return a.allDay }
            if a.start != b.start { return a.start < b.start }
            if a.end != b.end { return a.end > b.end }
            return a.id < b.id
        }
    }

    /** On a day when it overlaps it, as the grids test it: `endMs > start && startMs < end`. */
    static func spans(_ event: CalendarEvent, _ day: Date, dates: CalendarDates) -> Bool {
        let start = dates.startOfDay(day)
        return event.end > start && event.start < dates.addDays(start, 1)
    }

    static func events(_ events: [CalendarEvent], on day: Date, dates: CalendarDates) -> [CalendarEvent] {
        sorted(events.filter { spans($0, day, dates: dates) })
    }

    /** Each of those days that has events, with them. */
    static func byDay(_ events: [CalendarEvent], days: [Date], dates: CalendarDates) -> [Date: [CalendarEvent]] {
        let sorted = Self.sorted(events)
        var byDay: [Date: [CalendarEvent]] = [:]
        for day in days {
            let on = sorted.filter { spans($0, day, dates: dates) }
            if !on.isEmpty { byDay[dates.startOfDay(day)] = on }
        }
        return byDay
    }

    static func grouped(_ events: [CalendarEvent], days: [Date], dates: CalendarDates) -> [EventDay] {
        byDay(events, days: days, dates: dates)
            .map { EventDay(id: $0.key, events: $0.value) }
            .sorted { $0.id < $1.id }
    }

    /**
     * The agenda's rows, as agenda.tsx builds them: from the start of today
     * (what's over today stays, for the page to dim), earliest first, each
     * event once under the day it starts, or under `from` when it started
     * before that.
     */
    static func agenda(_ events: [CalendarEvent], from: Date, dates: CalendarDates) -> [EventDay] {
        let coming = events.filter { $0.end > from }.sorted { a, b in
            if a.start != b.start { return a.start < b.start }
            if a.end != b.end { return a.end > b.end }
            return a.id < b.id
        }
        var days: [EventDay] = []
        for event in coming {
            let day = dates.startOfDay(max(event.start, from))
            if let last = days.last, dates.sameDay(last.id, day) {
                days[days.count - 1] = EventDay(id: last.id, events: last.events + [event])
            } else {
                days.append(EventDay(id: day, events: [event]))
            }
        }
        return days
    }

    /**
     * The last day an event covers. An event ending at midnight (an all-day
     * event's end is the midnight after it) stops the day before, which is
     * what `spans` says too.
     */
    static func lastDay(of event: CalendarEvent, dates: CalendarDates) -> Date {
        let start = dates.startOfDay(event.start)
        let end = dates.startOfDay(event.end)
        guard end > start else { return start }
        return event.end == end ? max(start, dates.addDays(end, -1)) : end
    }

    /**
     * The day an event's end is shown under: its last day when it's all day,
     * the end's own day when it's at a time, so a meeting ending at midnight
     * says the day it really ends.
     */
    static func endDay(of event: CalendarEvent, dates: CalendarDates) -> Date {
        event.allDay ? lastDay(of: event, dates: dates) : dates.startOfDay(event.end)
    }

    /**
     * How a row under `day` states an event's time, as agendaRows.ts's spanRow
     * and segmentRow decide it: an all-day event, or a timed one of a day or
     * more, is a span and says which of its days this is — the whole day when
     * it covers only one, as a 25-hour day's midnight-to-midnight event does;
     * a shorter event across midnight is clipped to the day and says only
     * where it starts (`from`) or ends (`until`).
     */
    static func timing(of event: CalendarEvent, on day: Date? = nil, dates: CalendarDates) -> EventTiming {
        let first = dates.startOfDay(event.start)
        let last = lastDay(of: event, dates: dates)
        let shown = day.map(dates.startOfDay) ?? first
        let days = (dates.calendar.dateComponents([.day], from: first, to: last).day ?? 0) + 1
        let span = event.allDay || event.end.timeIntervalSince(event.start) >= 24 * 3600
        let kind: EventTiming.Kind
        if event.allDay {
            kind = .allDay
        } else if days < 2 {
            kind = span ? .allDay : .range
        } else if dates.sameDay(shown, first) {
            kind = .from
        } else if dates.sameDay(shown, last) {
            kind = .until
        } else {
            kind = .allDay
        }
        guard span, days > 1 else { return EventTiming(kind: kind) }
        let reached = (dates.calendar.dateComponents([.day], from: first, to: shown).day ?? 0) + 1
        return EventTiming(kind: kind, dayOfSpan: min(max(reached, 1), days), spanDays: days)
    }
}

/**
 * Google's event descriptions are often HTML, read as plain text the way the
 * Otter mobile calendar reads them (eventPresentation.ts's plainDescription):
 * line breaks kept, a link as its text and then its address when they differ,
 * list items as bullets, other tags dropped. The mail reader's HTMLText drops
 * the address a calendar description is usually there for.
 */
nonisolated enum EventDescription {
    private static let entities = [
        "amp": "&", "lt": "<", "gt": ">", "quot": "\"", "apos": "'", "nbsp": " ",
        "rsquo": "’", "mdash": "—",
    ]

    static func plain(_ description: String) -> String {
        guard description.range(of: "<[a-z!/][^>]*>|&[a-z#0-9]+;", options: [.regularExpression, .caseInsensitive]) != nil else {
            return description.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        var text = links(in: description)
        for (pattern, replacement) in [
            // Not in plainDescription: a pasted description can carry these, whose text isn't the event's.
            ("(?is)<(style|script|head)[^>]*>.*?</\\1>", ""),
            ("(?i)<br\\s*/?>", "\n"),
            ("(?i)</(p|div|li|h[1-6])>", "\n"),
            ("(?i)<li\\b[^>]*>", "• "),
            ("<[^>]+>", ""),
        ] {
            text = text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
        }
        return decoded(text)
            .replacingOccurrences(of: "[ \t]+\n", with: "\n", options: .regularExpression)
            .replacingOccurrences(of: "\n{3,}", with: "\n\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func links(in html: String) -> String {
        rewrite(html, #"(?is)<a\b[^>]*href="([^"]*)"[^>]*>(.*?)</a>"#) { groups in
            let href = groups[1] ?? ""
            let label = (groups[2] ?? "")
                .replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return label.isEmpty || label == href ? href : "\(label) (\(href))"
        }
    }

    private static func decoded(_ text: String) -> String {
        rewrite(text, "(?i)&(#x?[0-9a-f]+|[a-z]+);") { groups in
            let whole = groups[0] ?? ""
            guard let entity = groups[1] else { return whole }
            guard entity.hasPrefix("#") else { return entities[entity.lowercased()] ?? whole }
            let hex = entity.lowercased().hasPrefix("#x")
            guard let code = UInt32(entity.dropFirst(hex ? 2 : 1), radix: hex ? 16 : 10),
                  let scalar = UnicodeScalar(code) else { return whole }
            return String(scalar)
        }
    }

    private static func rewrite(_ text: String, _ pattern: String, _ replacement: ([String?]) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return text }
        var result = ""
        var last = text.startIndex
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)) {
            guard let range = Range(match.range, in: text), range.lowerBound >= last else { continue }
            let groups = (0..<match.numberOfRanges).map { index in
                Range(match.range(at: index), in: text).map { String(text[$0]) }
            }
            result.append(contentsOf: text[last..<range.lowerBound])
            result += replacement(groups)
            last = range.upperBound
        }
        result.append(contentsOf: text[last...])
        return result
    }
}

/**
 * Meeting links, as contracts' meetings.ts finds them: the conference link a
 * provider we know hands out, picked out of the location or the description.
 */
nonisolated enum Meetings {
    enum Provider: String {
        case googleMeet, teams, zoom, webex, other

        var title: String {
            switch self {
            case .googleMeet: "Google Meet"
            case .teams: "Microsoft Teams"
            case .zoom: "Zoom"
            case .webex: "Webex"
            case .other: "Meeting"
            }
        }
    }

    static func provider(_ link: String) -> Provider {
        guard let url = URL(string: link), url.scheme?.lowercased() == "https",
              let host = url.host()?.lowercased() else { return .other }
        let path = url.path()
        let on = { (domain: String) in host == domain || host.hasSuffix("." + domain) }
        if host == "meet.google.com" {
            return path.dropFirst().first?.isLetter == true ? .googleMeet : .other
        }
        if host == "teams.microsoft.com" || host == "teams.live.com" {
            return path.hasPrefix("/l/meetup-join/") || path.hasPrefix("/meet/") ? .teams : .other
        }
        if on("zoom.us") || on("zoom.com") {
            return ["/j/", "/my/", "/w/"].contains(where: path.hasPrefix) ? .zoom : .other
        }
        if on("webex.com") {
            return path.hasPrefix("/meet") || path.hasPrefix("/join") || path.contains("/j.php") ? .webex : .other
        }
        return .other
    }

    /** The first link to a meeting in any of these; descriptions may be HTML. */
    static func findLink(in texts: [String?]) -> String? {
        for text in texts.compactMap({ $0 }) {
            for token in text.split(whereSeparator: { $0.isWhitespace || "\"'<>()".contains($0) }) {
                guard let https = token.range(of: "https://") else { continue }
                var link = String(token[https.lowerBound...]).replacingOccurrences(of: "&amp;", with: "&")
                while let last = link.last, ".,;:!?".contains(last) { link.removeLast() }
                if provider(link) != .other { return link }
            }
        }
        return nil
    }
}
