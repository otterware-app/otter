import Foundation

/**
 * Google Calendar: the account's calendars and the events in a window, mapped
 * as core maps them (packages/core/src/providers/gmail/calendar.ts). A sign-in
 * from before the app asked for calendar access is refused with 403, which is
 * `NoAccess`: the screen then offers signing in again.
 */
nonisolated struct GoogleCalendarAPI {
    let email: String
    let token: @Sendable (_ force: Bool) async throws -> String

    /** The sign-in doesn't cover the calendar (core's NoCalendarAccess). */
    struct NoAccess: Error {}

    struct Failure: LocalizedError {
        var status: Int
        var message: String
        var errorDescription: String? { message }
    }

    @concurrent
    func calendars() async throws -> [EventCalendar] {
        var found: [EventCalendar] = []
        var pageToken: String?
        repeat {
            var query = [URLQueryItem(name: "maxResults", value: "250")]
            if let pageToken { query.append(.init(name: "pageToken", value: pageToken)) }
            let page = try GoogleEvents.calendars(try await request("users/me/calendarList", query: query), account: email)
            found += page.calendars
            pageToken = page.next
        } while pageToken != nil
        return GoogleEvents.sorted(found)
    }

    /** A window's events, every page of them: a long agenda of a busy calendar is more than one. */
    @concurrent
    func events(on calendar: EventCalendar, in window: EventWindow) async throws -> [CalendarEvent] {
        let times = EventTimes()
        var found: [CalendarEvent] = []
        var pageToken: String?
        repeat {
            var query = [
                URLQueryItem(name: "timeMin", value: window.from.formatted(.iso8601)),
                .init(name: "timeMax", value: window.to.formatted(.iso8601)),
                .init(name: "singleEvents", value: "true"),
                .init(name: "orderBy", value: "startTime"),
                .init(name: "maxResults", value: "250"),
            ]
            if let pageToken { query.append(.init(name: "pageToken", value: pageToken)) }
            let page = try GoogleEvents.events(
                try await request("calendars/\(encoded(calendar.id))/events", query: query),
                on: calendar, me: email, times: times
            )
            found += page.events
            pageToken = page.next
        } while pageToken != nil
        return found
    }

    /** As core's calendarFetch reads a refusal: the grant doesn't cover the calendar. */
    static func lacksAccess(_ message: String) -> Bool {
        ["insufficient", "scope", "PERMISSION_DENIED", "accessNotConfigured", "has not been used"]
            .contains { message.localizedCaseInsensitiveContains($0) }
    }

    private func encoded(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? id
    }

    private func request(_ path: String, query: [URLQueryItem], method: String = "GET", body: Data? = nil) async throws -> Data {
        var components = URLComponents(string: "https://www.googleapis.com/calendar/v3/\(path)")!
        if !query.isEmpty { components.queryItems = query }
        var request = URLRequest(url: components.url!)
        request.httpMethod = method
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        for attempt in 0..<3 {
            request.setValue("Bearer \(try await token(attempt > 0))", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if (200..<300).contains(status) { return data }
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { ($0["error"] as? [String: Any])?["message"] as? String }
            if status == 401 || status == 403, Self.lacksAccess(message ?? String(decoding: data, as: UTF8.self)) {
                throw NoAccess()
            }
            let rateLimited = GmailAPI.Failure.rateLimited(status: status, message: message)
            if attempt < 2, status == 401 || rateLimited || status >= 500 {
                // The quota is per minute: give it a few seconds, or what it asks for.
                let retryAfter = ((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Retry-After")).flatMap(Int.init)
                let wait = rateLimited ? min(retryAfter ?? 5 * (attempt + 1), 30) : attempt + 1
                if status != 401 { try await Task.sleep(for: .seconds(wait)) }
                continue
            }
            throw Failure(status: status, message: message ?? "Google Calendar answered \(status).")
        }
        throw Failure(status: 0, message: "Google Calendar didn't answer.")
    }
}

/**
 * Google's times: RFC 3339 for an event at a time ("2026-05-04T09:00:00+02:00"),
 * a plain date for an all-day one, which is a day where the phone is.
 */
nonisolated struct EventTimes {
    let calendar: Calendar
    /** Google writes its dates in the Gregorian calendar, whichever one the phone shows (Apple's QA1480). */
    private let gregorian: Calendar
    private let time = ISO8601DateFormatter()
    private let fractional = ISO8601DateFormatter()

    init(calendar: Calendar = .current) {
        self.calendar = calendar
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = calendar.timeZone
        self.gregorian = gregorian
        time.formatOptions = [.withInternetDateTime]
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func dateTime(_ text: String) -> Date? {
        time.date(from: text) ?? fractional.date(from: text)
    }

    func day(_ text: String) -> Date? {
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return gregorian.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}

/** Google Calendar's JSON, mapped as core's toEvent and listCalendars map it. */
nonisolated enum GoogleEvents {
    static func calendars(_ data: Data, account: String = "") throws -> (calendars: [EventCalendar], next: String?) {
        let page = try JSONDecoder().decode(ApiCalendars.self, from: data)
        let calendars = (page.items ?? [])
            .filter { $0.hidden != true }
            .map { item in
                // Core's listCalendars: the primary one is `primary` (Google takes it in its paths too), keying its color alike on every device.
                EventCalendar(
                    id: item.primary == true ? "primary" : item.id,
                    name: [item.summaryOverride, item.summary].compactMap { $0 }.first { !$0.isEmpty } ?? item.id,
                    color: item.backgroundColor,
                    primary: item.primary == true,
                    shown: item.selected != false,
                    account: account,
                    writable: item.accessRole == "owner" || item.accessRole == "writer"
                )
            }
        return (calendars, page.nextPageToken)
    }

    /** How the account's calendars are listed: the primary one first, then by name. */
    static func sorted(_ calendars: [EventCalendar]) -> [EventCalendar] {
        calendars.sorted { ($0.primary ? 0 : 1, $0.name.lowercased()) < ($1.primary ? 0 : 1, $1.name.lowercased()) }
    }

    static func events(_ data: Data, on calendar: EventCalendar, me: String, times: EventTimes) throws -> (events: [CalendarEvent], next: String?) {
        let page = try JSONDecoder().decode(ApiEvents.self, from: data)
        let events = (page.items ?? []).compactMap { event($0, on: calendar, me: me, times: times) }
        return (events, page.nextPageToken)
    }

    private static func event(_ api: ApiEvent, on calendar: EventCalendar, me: String, times: EventTimes) -> CalendarEvent? {
        guard let start = date(api.start, times: times) else { return nil }
        let allDay = api.start?.date != nil
        let email = me.lowercased()
        let people = (api.attendees ?? []).filter { !($0.email ?? "").isEmpty }
        let mine = people.first { $0.isSelf == true || $0.email?.lowercased() == email }
        let video = api.conferenceData?.entryPoints?.first { $0.entryPointType == "video" }?.uri
        return CalendarEvent(
            eventId: api.id,
            calendar: calendar,
            title: api.summary ?? "(no title)",
            start: start,
            end: date(api.end, times: times) ?? times.calendar.date(byAdding: allDay ? .day : .hour, value: 1, to: start) ?? start,
            allDay: allDay,
            timeZone: api.start?.timeZone,
            location: api.location,
            details: api.description,
            status: status(api.status),
            organizer: person(api.organizer),
            attendees: people.compactMap { who in
                person(who).map {
                    CalendarEvent.Attendee(person: $0, response: response(who.responseStatus), room: who.resource == true)
                }
            },
            response: mine.map { response($0.responseStatus) },
            meetingLink: video ?? api.hangoutLink ?? Meetings.findLink(in: [api.location, api.description]),
            htmlLink: api.htmlLink,
            recurring: api.recurringEventId != nil || api.recurrence?.isEmpty == false,
            // core's calendar.ts: `recurringEventId ?? (recurrence ? id : null)`.
            seriesId: api.recurringEventId ?? (api.recurrence?.isEmpty == false ? api.id : nil),
            originalStart: date(api.originalStartTime, times: times)
        )
    }

    private static func date(_ time: ApiEvent.Time?, times: EventTimes) -> Date? {
        guard let time else { return nil }
        if let dateTime = time.dateTime { return times.dateTime(dateTime) }
        if let date = time.date { return times.day(date) }
        return nil
    }

    private static func person(_ who: ApiEvent.Who?) -> Person? {
        guard let email = who?.email, !email.isEmpty else { return nil }
        return Person(name: who?.displayName ?? "", email: email)
    }

    private static func response(_ status: String?) -> CalendarEvent.Response {
        CalendarEvent.Response(rawValue: status ?? "") ?? .needsAction
    }

    private static func status(_ value: String?) -> CalendarEvent.Status {
        switch value {
        case "tentative": .tentative
        case "cancelled": .cancelled
        default: .confirmed
        }
    }

    private struct ApiCalendars: Decodable {
        var items: [ApiCalendar]?
        var nextPageToken: String?
    }

    private struct ApiCalendar: Decodable {
        var id: String
        var summary: String?
        var summaryOverride: String?
        var backgroundColor: String?
        var primary: Bool?
        var selected: Bool?
        var hidden: Bool?
        var accessRole: String?
    }

    private struct ApiEvents: Decodable {
        var items: [ApiEvent]?
        var nextPageToken: String?
    }

    private struct ApiEvent: Decodable {
        struct Time: Decodable {
            var date: String?
            var dateTime: String?
            var timeZone: String?
        }

        struct Who: Decodable {
            var email: String?
            var displayName: String?
            var isSelf: Bool?
            var responseStatus: String?
            var resource: Bool?

            private enum CodingKeys: String, CodingKey {
                case email, displayName, responseStatus, resource
                case isSelf = "self"
            }
        }

        struct Conference: Decodable {
            struct Entry: Decodable {
                var entryPointType: String?
                var uri: String?
            }

            var entryPoints: [Entry]?
        }

        var id: String
        var status: String?
        var htmlLink: String?
        var summary: String?
        var description: String?
        var location: String?
        var start: Time?
        var end: Time?
        var organizer: Who?
        var attendees: [Who]?
        var hangoutLink: String?
        var conferenceData: Conference?
        var recurringEventId: String?
        var recurrence: [String]?
        var originalStartTime: Time?
    }
}
