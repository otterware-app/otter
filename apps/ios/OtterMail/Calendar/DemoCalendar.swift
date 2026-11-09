import Foundation

/**
 * The demo mailbox's calendar, as DemoMail.swift is its mail: pretend events
 * placed around today, so every view has something in it. The week's rhythm
 * repeats through the window; the rest is anchored to today. Nothing here
 * reaches Google. Acme's team calendar is read-only, as a calendar shared
 * with you is; the others take new events and changes (`DemoEventWriter`).
 */
nonisolated enum DemoCalendar {
    static let personal = EventCalendar(id: "demo-personal", name: "Robin Otter", color: "#0ea5e9", primary: true, writable: true)
    static let work = EventCalendar(id: "demo-work", name: "Otterware", color: "#f97316", writable: true)
    static let calendars = [personal, work]
    /** The demo's second Gmail mailbox (Work, Sam at Acme): its own calendars, so there is one mailbox to scope to. */
    static let samPark = EventCalendar(id: "demo-sam", name: "Sam Park", color: "#f97316", primary: true, writable: true)
    static let acme = EventCalendar(id: "demo-acme", name: "Acme team", color: "#8e8cf0")
    static let acmeCalendars = [samPark, acme]

    private static let me = Person(name: "Robin Otter", email: "demo@otter.example")
    private static let maya = Person(name: "Maya Chen", email: "maya.chen@example.com")
    private static let jonas = Person(name: "Jonas Müller", email: "jonas.mueller@example.de")
    private static let sam = Person(name: "Sam Park", email: "sam@acme.example")
    private static let asa = Person(name: "Åsa Lindqvist", email: "asa@bokcirkel.example")
    private static let studio = Person(name: "Studio", email: "studio@otter.example")

    static func events(in window: EventWindow, now: Date = .now, dates: CalendarDates = CalendarDates()) -> [CalendarEvent] {
        let found = weekly(in: window, dates: dates).map(inSeries) + anchored(to: dates.startOfDay(now), dates: dates)
        return EventDays.sorted(found.filter { $0.end > window.from && $0.start < window.to })
    }

    /** Acme's week: planning on Mondays, the all-hands on Thursdays, and a gym slot on Sam's own calendar. */
    static func acmeEvents(in window: EventWindow, dates: CalendarDates = CalendarDates()) -> [CalendarEvent] {
        let calendar = dates.calendar
        let found = dates.days(in: window).flatMap { day -> [CalendarEvent] in
            let weekday = calendar.component(.weekday, from: day)
            var events: [CalendarEvent] = []
            if weekday == 2 {
                events.append(CalendarEvent(
                    eventId: "acme-planning-\(stamp(day))", calendar: acme, title: "Sprint planning",
                    start: at(day, 10, calendar: calendar), end: at(day, 11, calendar: calendar),
                    organizer: sam, response: .accepted, recurring: true
                ))
            }
            if weekday == 5 {
                events.append(CalendarEvent(
                    eventId: "acme-all-hands-\(stamp(day))", calendar: acme, title: "Acme all-hands",
                    start: at(day, 16, calendar: calendar), end: at(day, 17, calendar: calendar),
                    organizer: sam, response: .accepted, recurring: true
                ))
            }
            if (2...6).contains(weekday) {
                events.append(CalendarEvent(
                    eventId: "sam-gym-\(stamp(day))", calendar: samPark, title: "Gym",
                    start: at(day, 7, minutes: 30, calendar: calendar), end: at(day, 8, minutes: 15, calendar: calendar)
                ))
            }
            return events.map(inSeries)
        }
        return EventDays.sorted(found.filter { $0.end > window.from && $0.start < window.to })
    }

    /** A weekly event is an occurrence of its series, as Google's are: `<series>-<day>`, at its original start. */
    private static func inSeries(_ event: CalendarEvent) -> CalendarEvent {
        guard event.recurring, let dash = event.eventId.lastIndex(of: "-") else { return event }
        var occurrence = event
        occurrence.seriesId = String(event.eventId[..<dash])
        occurrence.originalStart = event.start
        return occurrence
    }

    private static func weekly(in window: EventWindow, dates: CalendarDates) -> [CalendarEvent] {
        let calendar = dates.calendar
        return dates.days(in: window).flatMap { day -> [CalendarEvent] in
            let weekday = calendar.component(.weekday, from: day)
            guard (2...6).contains(weekday) else { return [] }
            var events = [standup(on: day, calendar: calendar)]
            if weekday == 3 { events.append(review(on: day, calendar: calendar)) }
            if weekday == 5 { events.append(oneOnOne(on: day, calendar: calendar)) }
            return events
        }
    }

    private static func anchored(to today: Date, dates: CalendarDates) -> [CalendarEvent] {
        let calendar = dates.calendar
        let day = { (ahead: Int) in calendar.date(byAdding: .day, value: ahead, to: today) ?? today }
        let offsiteStart = dates.startOfWeek(day(9))
        return [
            CalendarEvent(
                eventId: "lunch",
                calendar: personal,
                title: "Lunch with Mum",
                start: at(today, 12, minutes: 30, calendar: calendar),
                end: at(today, 13, minutes: 30, calendar: calendar),
                location: "Café Linden, Rosenthaler Str. 12",
                organizer: me
            ),
            // Over lunch's end, so the Day page shows two side by side.
            CalendarEvent(
                eventId: "supplier-call",
                calendar: work,
                title: "Call with the printer",
                start: at(today, 13, calendar: calendar),
                end: at(today, 13, minutes: 45, calendar: calendar),
                organizer: me
            ),
            CalendarEvent(
                eventId: "budget",
                calendar: work,
                title: "Budget review",
                start: at(day(1), 16, calendar: calendar),
                end: at(day(1), 17, calendar: calendar),
                details: "Moved to next month — see the thread.",
                status: .cancelled,
                organizer: sam,
                attendees: [.init(person: sam, response: .accepted), .init(person: me, response: .declined)],
                response: .declined
            ),
            CalendarEvent(
                eventId: "birthday",
                calendar: personal,
                title: "Mum's birthday",
                start: day(3),
                end: day(4),
                allDay: true
            ),
            CalendarEvent(
                eventId: "garden",
                calendar: personal,
                title: "Garden planning",
                start: at(day(4), 17, calendar: calendar),
                end: at(day(4), 18, calendar: calendar),
                location: "Community garden, plot 12",
                details: "Let's decide what goes in the raised beds before the frost. Bring seed catalogues!",
                organizer: jonas,
                attendees: [.init(person: jonas, response: .accepted), .init(person: me)],
                response: .needsAction
            ),
            CalendarEvent(
                eventId: "book-club",
                calendar: personal,
                title: "Book club: The Overstory",
                start: at(day(6), 20, calendar: calendar),
                end: at(day(6), 21, minutes: 30, calendar: calendar),
                details: "Chapters 1 to 7. Join from anywhere: https://bokcirkel.zoom.us/j/8829104425",
                organizer: asa,
                attendees: [.init(person: asa, response: .accepted), .init(person: me, response: .tentative)],
                response: .tentative,
                meetingLink: "https://bokcirkel.zoom.us/j/8829104425"
            ),
            CalendarEvent(
                eventId: "offsite",
                calendar: work,
                title: "Otterware offsite",
                start: offsiteStart,
                end: calendar.date(byAdding: .day, value: 3, to: offsiteStart) ?? offsiteStart,
                allDay: true,
                location: "Wannsee",
                details: "Three days away from the inbox. Bring a swimsuit.",
                organizer: maya,
                attendees: [.init(person: maya, response: .accepted), .init(person: sam, response: .accepted), .init(person: me, response: .accepted)],
                response: .accepted
            ),
            CalendarEvent(
                eventId: "night-train",
                calendar: personal,
                title: "Night train to Lisbon",
                start: at(day(12), 22, minutes: 40, calendar: calendar),
                end: at(day(13), 7, minutes: 15, calendar: calendar),
                timeZone: "Europe/Lisbon",
                location: "Berlin Hbf, platform 9"
            ),
        ]
    }

    private static func standup(on day: Date, calendar: Calendar) -> CalendarEvent {
        CalendarEvent(
            eventId: "standup-\(stamp(day))",
            calendar: work,
            title: "Standup",
            start: at(day, 9, minutes: 30, calendar: calendar),
            end: at(day, 9, minutes: 45, calendar: calendar),
            details: "What shipped, what's next, what's stuck.",
            organizer: maya,
            attendees: [.init(person: maya, response: .accepted), .init(person: sam, response: .accepted), .init(person: me, response: .accepted)],
            response: .accepted,
            meetingLink: "https://meet.google.com/otr-demo-stand",
            recurring: true
        )
    }

    private static func review(on day: Date, calendar: Calendar) -> CalendarEvent {
        CalendarEvent(
            eventId: "review-\(stamp(day))",
            calendar: work,
            title: "Design review",
            start: at(day, 14, calendar: calendar),
            end: at(day, 15, calendar: calendar),
            location: "Studio",
            details: "This week: the calendar on the phone.",
            organizer: maya,
            attendees: [
                .init(person: maya, response: .accepted),
                .init(person: me, response: .accepted),
                .init(person: studio, response: .accepted, room: true),
            ],
            response: .accepted,
            meetingLink: "https://meet.google.com/otr-demo-design",
            recurring: true
        )
    }

    private static func oneOnOne(on day: Date, calendar: Calendar) -> CalendarEvent {
        CalendarEvent(
            eventId: "one-on-one-\(stamp(day))",
            calendar: work,
            title: "Maya and Robin",
            start: at(day, 11, calendar: calendar),
            end: at(day, 11, minutes: 30, calendar: calendar),
            organizer: maya,
            attendees: [.init(person: maya, response: .accepted), .init(person: me, response: .accepted)],
            response: .accepted,
            recurring: true
        )
    }

    private static func at(_ day: Date, _ hour: Int, minutes: Int = 0, calendar: Calendar) -> Date {
        calendar.date(bySettingHour: hour, minute: minutes, second: 0, of: day) ?? day
    }

    private static func stamp(_ day: Date) -> String {
        String(Int(day.timeIntervalSince1970))
    }
}
