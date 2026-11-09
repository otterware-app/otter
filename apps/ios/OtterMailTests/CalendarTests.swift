import Foundation
import Testing
@testable import Otter_Mail

/**
 * The calendar's pure parts: Google's JSON mapped as core maps it
 * (packages/core/src/providers/gmail/calendar.ts), meeting links as contracts
 * finds them, the dates, preferences and presentation ported from the Mac and
 * web app's apps/web/src/main/calendar, and the rows and event presentation
 * ported from Otterware's own mobile calendar (otter-calendar's
 * apps/mobile/src/features/calendar and packages/client-runtime/src/calendar).
 * The vectors named after a TS file are its own, with the same inputs and the
 * same expected answers.
 */
struct CalendarTests {
    private let mine = EventCalendar(id: "primary", name: "Robin Otter", color: "#0ea5e9", primary: true, account: "robin@otter.example")
    private let me = "robin@otter.example"

    private func zone(_ identifier: String, firstWeekday: Int = 2, locale: String = "en_US") -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: identifier)!
        calendar.firstWeekday = firstWeekday
        calendar.locale = Locale(identifier: locale)
        return calendar
    }

    private func calendarDates(_ calendar: Calendar, _ preferences: CalendarPreferences = CalendarPreferences()) -> CalendarDates {
        CalendarDates(calendar: calendar, preferences: preferences)
    }

    private func day(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0, in calendar: Calendar) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func events(_ json: String, in calendar: Calendar) throws -> [CalendarEvent] {
        try GoogleEvents.events(Data(json.utf8), on: mine, me: me, times: EventTimes(calendar: calendar)).events
    }

    private func timed(_ id: String, _ start: Date, _ end: Date, response: CalendarEvent.Response? = nil) -> CalendarEvent {
        CalendarEvent(eventId: id, calendar: mine, title: id, start: start, end: end, response: response)
    }

    private func allDay(_ id: String, _ from: Date, _ toExclusive: Date) -> CalendarEvent {
        CalendarEvent(eventId: id, calendar: mine, title: id, start: from, end: toExclusive, allDay: true)
    }

    /**
     * The days and their events as agendaRows.test.ts writes them down ("# 1",
     * "  offsite allDay 1/3"), so its vectors can be compared line for line.
     */
    private func described(_ events: [CalendarEvent], from: Date, days: Int, dates: CalendarDates) -> [String] {
        (0..<days).flatMap { index -> [String] in
            let day = dates.addDays(from, index)
            let on = EventDays.events(events, on: day, dates: dates)
            guard !on.isEmpty else { return [] }
            return ["# \(index)"] + on.map { event in
                let timing = EventDays.timing(of: event, on: day, dates: dates)
                let span = timing.spanDays.map { " \(timing.dayOfSpan ?? 0)/\($0)" } ?? ""
                return "\(event.eventId) \(timing.kind)\(span)"
            }
        }
    }

    private let review = """
    {"items": [{
      "id": "evt-1",
      "status": "confirmed",
      "htmlLink": "https://www.google.com/calendar/event?eid=abc",
      "summary": "Design review",
      "description": "Agenda: <a href=\\"https://example.com/doc?a=1&amp;b=2\\">the doc</a>",
      "location": "Studio",
      "start": {"dateTime": "2026-05-04T09:00:00+02:00", "timeZone": "Europe/Berlin"},
      "end": {"dateTime": "2026-05-04T10:30:00+02:00", "timeZone": "Europe/Berlin"},
      "organizer": {"email": "maya@example.com", "displayName": "Maya Chen"},
      "attendees": [
        {"email": "maya@example.com", "displayName": "Maya Chen", "responseStatus": "accepted"},
        {"email": "ROBIN@otter.example", "self": true, "responseStatus": "tentative"},
        {"email": "sam@acme.example"}
      ],
      "hangoutLink": "https://meet.google.com/abc-defg-hij",
      "conferenceData": {"entryPoints": [
        {"entryPointType": "more", "uri": "https://tel.meet/x"},
        {"entryPointType": "video", "uri": "https://meet.google.com/xyz-video"}
      ]},
      "recurringEventId": "evt-series"
    }]}
    """

    @Test func mapsAnEventAtATime() throws {
        let calendar = zone("Europe/Berlin")
        let event = try #require(try events(review, in: calendar).first)
        #expect(event.eventId == "evt-1")
        #expect(event.id == "robin@otter.example|primary/evt-1")
        #expect(event.title == "Design review")
        #expect(event.start == day(2026, 5, 4, 9, 0, in: calendar))
        #expect(event.end == day(2026, 5, 4, 10, 30, in: calendar))
        #expect(!event.allDay)
        #expect(event.timeZone == "Europe/Berlin")
        #expect(event.location == "Studio")
        #expect(event.status == .confirmed)
        #expect(event.organizer == Person(name: "Maya Chen", email: "maya@example.com"))
        #expect(event.attendees.map(\.person.email) == ["maya@example.com", "ROBIN@otter.example", "sam@acme.example"])
        #expect(event.attendees.map(\.response) == [.accepted, .tentative, .needsAction])
        #expect(event.response == .tentative)
        // The conference's video link comes before the Meet link and the text.
        #expect(event.meetingLink == "https://meet.google.com/xyz-video")
        #expect(event.htmlLink == "https://www.google.com/calendar/event?eid=abc")
        #expect(event.recurring)
        #expect(event.calendar == mine)
    }

    @Test func readsTheMailboxesOwnAnswer() throws {
        let calendar = zone("Europe/Berlin")
        // Google doesn't always mark the attendee: the address decides, as core's isSelf does.
        let unmarked = """
        {"items": [{"id": "a", "summary": "Lunch",
          "start": {"dateTime": "2026-05-04T12:00:00Z"}, "end": {"dateTime": "2026-05-04T13:00:00Z"},
          "attendees": [{"email": "Robin@Otter.Example", "responseStatus": "declined"}]}]}
        """
        #expect(try events(unmarked, in: calendar).first?.response == .declined)

        let theirs = """
        {"items": [{"id": "b", "summary": "Their meeting",
          "start": {"dateTime": "2026-05-04T12:00:00Z"}, "end": {"dateTime": "2026-05-04T13:00:00Z"},
          "attendees": [{"email": "maya@example.com", "responseStatus": "accepted"}]}]}
        """
        let event = try #require(try events(theirs, in: calendar).first)
        #expect(event.response == nil)
        #expect(event.attendees.count == 1)
    }

    @Test func mapsAnAllDayEventAtLocalMidnight() throws {
        let json = """
        {"items": [{"id": "c", "summary": "Mum's birthday",
          "start": {"date": "2026-05-04"}, "end": {"date": "2026-05-05"}}]}
        """
        let berlin = zone("Europe/Berlin")
        let event = try #require(try events(json, in: berlin).first)
        #expect(event.allDay)
        #expect(event.start == day(2026, 5, 4, in: berlin))
        #expect(event.end == day(2026, 5, 5, in: berlin))
        // Its end is the midnight after it, so it covers one day.
        #expect(EventDays.lastDay(of: event, dates: calendarDates(berlin)) == day(2026, 5, 4, in: berlin))

        let newYork = zone("America/New_York")
        let there = try #require(try events(json, in: newYork).first)
        #expect(there.start == day(2026, 5, 4, in: newYork))
        #expect(there.start != event.start)

        // Google's date is Gregorian whichever calendar the phone shows.
        var buddhist = Calendar(identifier: .buddhist)
        buddhist.timeZone = berlin.timeZone
        let elsewhere = try #require(try events(json, in: buddhist).first)
        #expect(elsewhere.start == day(2026, 5, 4, in: berlin))
        #expect(elsewhere.end == day(2026, 5, 5, in: berlin))
    }

    @Test func spreadsALongerEventOverEveryDayItCovers() throws {
        let calendar = zone("Europe/Berlin")
        let dates = calendarDates(calendar)
        let json = """
        {"items": [
          {"id": "offsite", "summary": "Offsite", "start": {"date": "2026-05-04"}, "end": {"date": "2026-05-07"}},
          {"id": "train", "summary": "Night train",
           "start": {"dateTime": "2026-05-04T22:40:00+02:00"}, "end": {"dateTime": "2026-05-05T07:15:00+02:00"}},
          {"id": "late", "summary": "Last orders",
           "start": {"dateTime": "2026-05-04T23:00:00+02:00"}, "end": {"dateTime": "2026-05-05T00:00:00+02:00"}}
        ]}
        """
        let found = try events(json, in: calendar)
        let week = (0..<7).map { dates.addDays(day(2026, 5, 4, in: calendar), $0) }
        let byDay = EventDays.byDay(found, days: week, dates: dates)
        #expect(byDay[day(2026, 5, 4, in: calendar)]?.map(\.eventId) == ["offsite", "train", "late"])
        #expect(byDay[day(2026, 5, 5, in: calendar)]?.map(\.eventId) == ["offsite", "train"])
        #expect(byDay[day(2026, 5, 6, in: calendar)]?.map(\.eventId) == ["offsite"])
        #expect(byDay[day(2026, 5, 7, in: calendar)] == nil)
        // An event ending at midnight stops the day before, though it still ends on the 5th.
        #expect(EventDays.lastDay(of: found[2], dates: dates) == day(2026, 5, 4, in: calendar))
        #expect(EventDays.endDay(of: found[2], dates: dates) == day(2026, 5, 5, in: calendar))
        #expect(EventDays.endDay(of: found[1], dates: dates) == day(2026, 5, 5, in: calendar))
        // An all-day event ends on its last day.
        #expect(EventDays.endDay(of: found[0], dates: dates) == day(2026, 5, 6, in: calendar))
    }

    @Test func keepsWhatGoogleLeavesOut() throws {
        let calendar = zone("Europe/Berlin")
        let json = """
        {"items": [
          {"id": "d", "status": "cancelled", "start": {"dateTime": "2026-05-04T09:00:00Z"}, "end": {"dateTime": "2026-05-04T10:00:00Z"}},
          {"id": "e", "status": "tentative", "summary": "Maybe", "start": {"dateTime": "2026-05-04T11:00:00Z"}, "end": {"dateTime": "2026-05-04T12:00:00Z"}},
          {"id": "f", "summary": "No end", "start": {"dateTime": "2026-05-04T14:00:00Z"}},
          {"id": "g", "summary": "No times at all"}
        ]}
        """
        let found = try events(json, in: calendar)
        #expect(found.map(\.eventId) == ["d", "e", "f"])
        #expect(found[0].title == "(no title)")
        #expect(found[0].status == .cancelled)
        #expect(found[0].response == nil)
        #expect(found[1].status == .tentative)
        // Without an end it lasts an hour, as a new event does on the Mac.
        #expect(found[2].end == found[2].start.addingTimeInterval(3600))
    }

    @Test func findsMeetingLinksLikeTheDesktop() throws {
        let calendar = zone("Europe/Berlin")
        let json = """
        {"items": [
          {"id": "zoom", "summary": "Book club", "location": "https://bokcirkel.zoom.us/j/8829104425.",
           "start": {"dateTime": "2026-05-04T19:00:00Z"}, "end": {"dateTime": "2026-05-04T20:00:00Z"}},
          {"id": "html", "summary": "Sync",
           "description": "Read <a href=\\"https://example.com/notes\\">this</a> then join https://teams.microsoft.com/l/meetup-join/19%3ameeting?a=1&amp;b=2",
           "start": {"dateTime": "2026-05-05T19:00:00Z"}, "end": {"dateTime": "2026-05-05T20:00:00Z"}},
          {"id": "none", "summary": "Coffee", "location": "Café Linden", "description": "See https://example.com/map",
           "start": {"dateTime": "2026-05-06T19:00:00Z"}, "end": {"dateTime": "2026-05-06T20:00:00Z"}},
          {"id": "hangout", "summary": "Standup", "hangoutLink": "https://meet.google.com/abc-defg-hij",
           "start": {"dateTime": "2026-05-07T19:00:00Z"}, "end": {"dateTime": "2026-05-07T20:00:00Z"}}
        ]}
        """
        let found = try events(json, in: calendar)
        #expect(found[0].meetingLink == "https://bokcirkel.zoom.us/j/8829104425")
        #expect(found[1].meetingLink == "https://teams.microsoft.com/l/meetup-join/19%3ameeting?a=1&b=2")
        #expect(found[2].meetingLink == nil)
        #expect(found[3].meetingLink == "https://meet.google.com/abc-defg-hij")
    }

    @Test func knowsWhichLinksAreMeetings() {
        #expect(Meetings.provider("https://meet.google.com/abc-defg-hij") == .googleMeet)
        #expect(Meetings.provider("https://meet.google.com/") == .other)
        #expect(Meetings.provider("https://teams.live.com/meet/9321") == .teams)
        #expect(Meetings.provider("https://teams.microsoft.com/l/channel/19") == .other)
        #expect(Meetings.provider("https://zoom.us/j/123") == .zoom)
        #expect(Meetings.provider("https://acme.zoom.us/my/robin") == .zoom)
        #expect(Meetings.provider("https://acme.zoom.us/account") == .other)
        #expect(Meetings.provider("https://acme.webex.com/acme/j.php?MTID=m1") == .webex)
        #expect(Meetings.provider("http://meet.google.com/abc-defg-hij") == .other)
        #expect(Meetings.provider("https://example.com/call") == .other)
        #expect(Meetings.findLink(in: [nil, "no link here"]) == nil)
    }

    @Test func bucketsEventsWhereThePhoneIs() throws {
        let json = """
        {"items": [{"id": "h", "summary": "Late call",
          "start": {"dateTime": "2026-11-04T23:30:00Z"}, "end": {"dateTime": "2026-11-05T00:15:00Z"}}]}
        """
        let berlin = zone("Europe/Berlin")
        let found = try events(json, in: berlin)
        // The same instant is the 5th in Berlin (+01:00) and still the 4th in New York.
        let newYork = zone("America/New_York")
        let week = { (calendar: Calendar) in
            (0..<7).map { self.calendarDates(calendar).addDays(self.day(2026, 11, 2, in: calendar), $0) }
        }
        #expect(EventDays.byDay(found, days: week(berlin), dates: calendarDates(berlin)).keys.sorted()
            == [day(2026, 11, 5, in: berlin)])
        #expect(EventDays.byDay(found, days: week(newYork), dates: calendarDates(newYork)).keys.sorted()
            == [day(2026, 11, 4, in: newYork)])
    }

    // MARK: - dates.ts

    /** dates.ts's weekStart(): `calendar:week-start` wins over the region's own first day. */
    @Test func startsTheWeekWhereTheAccountSays() {
        // 1 November 2026 is a Sunday.
        let region = zone("Europe/Berlin", firstWeekday: 2)
        let wednesday = day(2026, 11, 4, 12, 0, in: region)
        #expect(calendarDates(region).weekStart == 1)
        #expect(calendarDates(region).startOfWeek(wednesday) == day(2026, 11, 2, in: region))

        let sunday = calendarDates(region, CalendarPreferences(ui: ["calendar:week-start": "sunday"]))
        #expect(sunday.weekStart == 0)
        #expect(sunday.startOfWeek(wednesday) == day(2026, 11, 1, in: region))

        let saturday = calendarDates(region, CalendarPreferences(ui: ["calendar:week-start": "saturday"]))
        #expect(saturday.weekStart == 6)
        #expect(saturday.startOfWeek(wednesday) == day(2026, 10, 31, in: region))

        // `auto` is the region's, so a Sunday-first phone starts the week on Sunday.
        #expect(calendarDates(zone("Europe/Berlin", firstWeekday: 1)).startOfWeek(wednesday) == day(2026, 11, 1, in: region))
    }

    /** dates.test.ts "steps over weekends both ways". */
    @Test func stepsOverWeekendsBothWays() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let monday = day(2026, 11, 2, in: dates.calendar)
        #expect(dates.dayKey(dates.stepDays(day(2026, 11, 6, in: dates.calendar), 1, weekends: false)) == "2026-11-09")
        #expect(dates.dayKey(dates.stepDays(monday, -1, weekends: false)) == "2026-10-30")
        #expect(dates.dayKey(dates.stepDays(day(2026, 11, 7, in: dates.calendar), 0, weekends: false)) == "2026-11-09")
        #expect(dates.dayKey(dates.stepDays(monday, 3)) == "2026-11-05")
    }

    /** dates.test.ts "shows a week's five weekdays, from any day it leads with". */
    /** Google's dates are Gregorian, as `EventTimes.day` reads them, on a phone set to the Buddhist calendar too. */
    @Test func writesDaysInTheGregorianCalendarWhicheverThePhoneShows() {
        var buddhist = Calendar(identifier: .buddhist)
        buddhist.timeZone = TimeZone(identifier: "Asia/Bangkok")!
        let dates = calendarDates(buddhist)
        let may4 = EventTimes(calendar: buddhist).day("2026-05-04")!
        #expect(dates.dayKey(may4) == "2026-05-04")
    }

    @Test func showsAWeeksFiveWeekdaysFromAnyDayItLeadsWith() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let days = dates.visibleDays(.week, day(2026, 11, 4, in: dates.calendar), free: true, weekends: false)
        #expect(days.map(dates.dayKey) == ["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10"])
    }

    /** dates.test.ts "leaves weekends out of the month". */
    @Test func leavesWeekendsOutOfTheMonth() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let days = dates.visibleDays(.month, day(2026, 11, 2, in: dates.calendar), weekends: false)
        #expect(days.count % 5 == 0)
        #expect(!days.contains(where: dates.isWeekend))
    }

    /** dates.ts's visibleDays() and step(), and the window each mode fetches. */
    @Test func showsTheDaysEachModeShows() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let wednesday = day(2026, 11, 4, 12, 0, in: dates.calendar)

        #expect(dates.visibleDays(.day, wednesday) == [day(2026, 11, 4, in: dates.calendar)])
        let week = dates.visibleDays(.week, wednesday)
        #expect(week.count == 7)
        #expect(week.first == day(2026, 11, 2, in: dates.calendar))

        // The grid starts in the week the month's first day falls in, and runs whole weeks.
        let month = dates.visibleDays(.month, wednesday)
        #expect(month.first == day(2026, 10, 26, in: dates.calendar))
        #expect(month.count == 42)
        // February 2026 starts on a Sunday and needs five rows, not six.
        #expect(dates.visibleDays(.month, day(2026, 2, 10, in: dates.calendar)).count == 35)

        #expect(dates.step(.day, wednesday, by: 1) == day(2026, 11, 5, 12, 0, in: dates.calendar))
        #expect(dates.step(.week, wednesday, by: -1) == day(2026, 10, 28, 12, 0, in: dates.calendar))
        #expect(dates.step(.month, wednesday, by: 1) == day(2026, 12, 1, in: dates.calendar))
        // The agenda is the days ahead from today and doesn't step.
        #expect(dates.step(.agenda, wednesday, by: 1) == wednesday)

        let window = dates.window(.agenda, anchor: wednesday)
        #expect(window.from == day(2026, 11, 4, in: dates.calendar))
        #expect(dates.days(in: window).count == CalendarDates.agendaDays)
        // Hiding weekends doesn't change what is fetched, so it doesn't ask Google again.
        let weekdays = self.calendarDates(dates.calendar, CalendarPreferences(ui: ["calendar:show-weekends": "false"]))
        #expect(weekdays.window(.week, anchor: wednesday) == dates.window(.week, anchor: wednesday))
        #expect(weekdays.showsWeekends(.week) == false)
        #expect(weekdays.showsWeekends(.day))
    }

    /** dates.ts's timeLabel() and hour12(), and event-style.ts's rangeLabel(). */
    @Test func labelsTimesAsTheTimeFormatAsks() {
        let berlin = zone("Europe/Berlin")
        let twelve = calendarDates(berlin, CalendarPreferences(ui: ["calendar:time-format": "12"]))
        let twentyFour = calendarDates(berlin, CalendarPreferences(ui: ["calendar:time-format": "24"]))

        // A whole hour drops its minutes on a twelve-hour clock, as timeLabel trims ":00".
        #expect(twelve.timeLabel(day(2026, 5, 4, 9, 0, in: berlin)) == "9 AM")
        #expect(twelve.timeLabel(day(2026, 5, 4, 9, 30, in: berlin)) == "9:30 AM")
        #expect(twelve.timeLabel(day(2026, 5, 4, 0, 0, in: berlin)) == "12 AM")
        #expect(twelve.timeLabel(day(2026, 5, 4, 13, 5, in: berlin)) == "1:05 PM")
        #expect(twentyFour.timeLabel(day(2026, 5, 4, 9, 0, in: berlin)) == "09:00")
        #expect(twentyFour.timeLabel(day(2026, 5, 4, 13, 5, in: berlin)) == "13:05")

        // `auto` is the region's clock.
        #expect(calendarDates(zone("Europe/Berlin", locale: "en_US")).hour12)
        #expect(!calendarDates(zone("Europe/Berlin", locale: "de_DE")).hour12)

        // The start drops the suffix the end repeats.
        #expect(twelve.rangeLabel(day(2026, 5, 4, 9, 0, in: berlin), day(2026, 5, 4, 10, 30, in: berlin)) == "9–10:30 AM")
        #expect(twelve.rangeLabel(day(2026, 5, 4, 11, 0, in: berlin), day(2026, 5, 4, 13, 0, in: berlin)) == "11 AM–1 PM")
        #expect(twentyFour.rangeLabel(day(2026, 5, 4, 9, 0, in: berlin), day(2026, 5, 4, 10, 30, in: berlin)) == "09:00–10:30")
    }

    /** dates.ts's durationLabel(). */
    @Test func labelsHowLongAnEventRuns() {
        #expect(CalendarDates.durationLabel(0) == "0min")
        #expect(CalendarDates.durationLabel(15 * 60) == "15min")
        #expect(CalendarDates.durationLabel(60 * 60) == "1h")
        #expect(CalendarDates.durationLabel(90 * 60) == "1h 30min")
        #expect(CalendarDates.durationLabel(25 * 60 * 60) == "25h")
        // Seconds round to the nearest minute.
        #expect(CalendarDates.durationLabel(89 * 60 + 40) == "1h 30min")
    }

    // MARK: - preferences.ts

    /** preferences.ts's read(): a switch is off only when it says "false", and anything unknown falls back. */
    @Test func readsTheAccountsCalendarPreferences() {
        let empty = CalendarPreferences(ui: [:])
        #expect(empty == CalendarPreferences())
        #expect(empty.weekStart == .auto)
        #expect(empty.timeFormat == .auto)
        #expect(empty.showWeekends)
        #expect(empty.showDeclined)
        #expect(empty.colors.isEmpty)

        let nonsense = CalendarPreferences(ui: [
            "calendar:week-start": "tuesday",
            "calendar:time-format": "48",
            "calendar:show-weekends": "nope",
            "calendar:colors": "not json",
        ])
        #expect(nonsense.weekStart == .auto)
        #expect(nonsense.timeFormat == .auto)
        #expect(nonsense.showWeekends)
        #expect(nonsense.colors.isEmpty)

        let chosen = CalendarPreferences(ui: [
            "calendar:week-start": "monday",
            "calendar:time-format": "24",
            "calendar:show-weekends": "false",
            "calendar:show-declined": "false",
            "calendar:colors": ##"{"robin@otter.example|work": "#f97316", "bad": 7}"##,
        ])
        #expect(chosen.weekStart == .monday)
        #expect(chosen.timeFormat == .twentyFour)
        #expect(!chosen.showWeekends)
        #expect(!chosen.showDeclined)
        #expect(chosen.colors == ["robin@otter.example|work": "#f97316"])
    }

    /** A color kept under the primary calendar's old id, the mailbox's address, moves to `primary` unless one is there. */
    @Test func movesThePrimaryCalendarsOldColorKey() {
        let old = CalendarPreferences(ui: [
            "calendar:colors": ##"{"robin@otter.example|robin@otter.example": "#f97316", "robin@otter.example|work": "#9fe1e7"}"##
        ])
        #expect(old.colors == ["robin@otter.example|primary": "#f97316", "robin@otter.example|work": "#9fe1e7"])

        let both = CalendarPreferences(ui: [
            "calendar:colors": ##"{"sam@otter.example|sam@otter.example": "#f97316", "sam@otter.example|primary": "#111111"}"##
        ])
        #expect(both.colors == ["sam@otter.example|primary": "#111111"])
    }

    /** calendar-view.tsx's listedCalendars(): a chosen color wins, else the mailbox's for its primary calendar. */
    @Test func picksAnEventsColorLikeTheSidebar() {
        let mailbox = Mailbox(
            email: "robin@otter.example", name: "Robin", displayName: "Personal",
            color: "#336699", signature: "", labels: []
        )
        let work = EventCalendar(id: "work", name: "Otterware", color: "#f97316")
        let colorless = EventCalendar(id: "birthdays", name: "Birthdays")
        let none = CalendarPreferences()

        #expect(EventStyle.key(mailbox: mailbox.email, calendar: work.id) == "robin@otter.example|work")
        #expect(EventStyle.hex(for: mine, mailbox: mailbox, preferences: none) == "#336699")
        #expect(EventStyle.hex(for: work, mailbox: mailbox, preferences: none) == "#f97316")
        #expect(EventStyle.hex(for: colorless, mailbox: mailbox, preferences: none) == "#336699")

        let chosen = CalendarPreferences(ui: [
            "calendar:colors": ##"{"robin@otter.example|work": "#9fe1e7", "robin@otter.example|primary": "#111111"}"##
        ])
        #expect(EventStyle.hex(for: work, mailbox: mailbox, preferences: chosen) == "#9fe1e7")
        #expect(EventStyle.hex(for: mine, mailbox: mailbox, preferences: chosen) == "#111111")
    }

    /**
     * eventPresentation.test.ts "follows the user's answer": a declined answer
     * wins over a tentative standing, and Google's own tentative standing
     * stands in for the instance's `tentative`.
     */
    @Test func drawsAnEventFromTheUsersAnswer() {
        let calendar = zone("Europe/Berlin")
        let at = day(2026, 11, 4, 9, 0, in: calendar)
        let event = { (response: CalendarEvent.Response?, status: CalendarEvent.Status) in
            CalendarEvent(
                eventId: "e", calendar: self.mine, title: "e", start: at, end: at,
                status: status, response: response
            )
        }
        #expect(EventStyle.tone(of: event(nil, .confirmed)) == .solid)
        #expect(EventStyle.tone(of: event(.accepted, .confirmed)) == .solid)
        #expect(EventStyle.tone(of: event(.needsAction, .confirmed)) == .unanswered)
        #expect(EventStyle.tone(of: event(.tentative, .confirmed)) == .tentative)
        #expect(EventStyle.tone(of: event(nil, .tentative)) == .tentative)
        #expect(EventStyle.tone(of: event(.declined, .tentative)) == .declined)
    }

    // MARK: - agenda.tsx and month-grid.tsx

    /** month-grid.tsx's sort: all day first, then by start, the longer first. */
    @Test func groupsADaysEventsAllDayFirst() throws {
        let calendar = zone("Europe/Berlin")
        let dates = calendarDates(calendar)
        let json = """
        {"items": [
          {"id": "later", "summary": "Later", "start": {"dateTime": "2026-05-04T16:00:00+02:00"}, "end": {"dateTime": "2026-05-04T17:00:00+02:00"}},
          {"id": "short", "summary": "Short", "start": {"dateTime": "2026-05-04T09:00:00+02:00"}, "end": {"dateTime": "2026-05-04T09:30:00+02:00"}},
          {"id": "long", "summary": "Long", "start": {"dateTime": "2026-05-04T09:00:00+02:00"}, "end": {"dateTime": "2026-05-04T11:00:00+02:00"}},
          {"id": "whole", "summary": "Whole day", "start": {"date": "2026-05-04"}, "end": {"date": "2026-05-05"}}
        ]}
        """
        let found = try events(json, in: calendar)
        let days = EventDays.grouped(found, days: [day(2026, 5, 4, in: calendar)], dates: dates)
        #expect(days.count == 1)
        #expect(days[0].id == day(2026, 5, 4, in: calendar))
        // Two events start at 9: the longer one is listed first.
        #expect(days[0].events.map(\.eventId) == ["whole", "long", "short", "later"])
        #expect(EventDays.events(found, on: day(2026, 5, 4, 15, 0, in: calendar), dates: dates).count == 4)
        #expect(EventDays.events(found, on: day(2026, 5, 5, in: calendar), dates: dates).isEmpty)
    }

    /**
     * agenda.tsx's AgendaDrawer from the start of today, earliest first, each
     * event once under the day it starts, or under `from` when it started
     * before that. Today's ended events stay, dimmed by the page.
     */
    @Test func listsTheAgendaOncePerEvent() {
        let calendar = zone("Europe/Berlin")
        let dates = calendarDates(calendar)
        let now = day(2026, 11, 4, 10, 0, in: calendar)
        let today = day(2026, 11, 4, in: calendar)
        let over = timed("over", day(2026, 11, 4, 8, 0, in: calendar), day(2026, 11, 4, 9, 0, in: calendar))
        let running = timed("running", day(2026, 11, 4, 9, 30, in: calendar), day(2026, 11, 4, 11, 0, in: calendar))
        let later = timed("later", day(2026, 11, 4, 16, 0, in: calendar), day(2026, 11, 4, 17, 0, in: calendar))
        let tomorrow = timed("tomorrow", day(2026, 11, 5, 9, 0, in: calendar), day(2026, 11, 5, 10, 0, in: calendar))
        let offsite = CalendarEvent(
            eventId: "offsite", calendar: mine, title: "Offsite",
            start: day(2026, 11, 2, in: calendar), end: day(2026, 11, 6, in: calendar), allDay: true
        )

        let rows = EventDays.agenda([later, over, tomorrow, offsite, running], from: today, dates: dates)
        #expect(rows.map(\.id) == [today, day(2026, 11, 5, in: calendar)])
        // The offsite started on the 2nd, so it leads today rather than repeating on every day it covers.
        #expect(rows[0].events.map(\.eventId) == ["offsite", "over", "running", "later"])
        #expect(rows[0].events.filter { $0.end <= now }.map(\.eventId) == ["over"])
        #expect(rows[1].events.map(\.eventId) == ["tomorrow"])
    }

    /** calendar-view.tsx's filter: `calendar:show-declined` off leaves declined events out. */
    @Test func leavesDeclinedEventsOutWhenAsked() {
        let calendar = zone("Europe/Berlin")
        let dates = calendarDates(calendar)
        let going = timed("going", day(2026, 11, 4, 9, 0, in: calendar), day(2026, 11, 4, 10, 0, in: calendar), response: .accepted)
        let not = timed("not", day(2026, 11, 4, 11, 0, in: calendar), day(2026, 11, 4, 12, 0, in: calendar), response: .declined)
        let all = [going, not]

        let hidden = CalendarPreferences(ui: ["calendar:show-declined": "false"])
        #expect(hidden.showDeclined == false)
        let kept = all.filter { hidden.showDeclined || $0.response != .declined }
        #expect(kept.map(\.eventId) == ["going"])
        #expect(EventDays.events(all, on: day(2026, 11, 4, in: calendar), dates: dates).count == 2)
        #expect(EventDays.events(kept, on: day(2026, 11, 4, in: calendar), dates: dates).count == 1)
    }

    /** agenda.tsx's dayTitle(), with "Yesterday" from format.ts's formatRelativeDay(). */
    @Test func headsEachDayAsTheAgendaDoes() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let now = day(2026, 11, 4, 10, 0, in: dates.calendar)
        #expect(dates.heading(day(2026, 11, 4, in: dates.calendar), now: now) == "Today")
        #expect(dates.heading(day(2026, 11, 5, in: dates.calendar), now: now) == "Tomorrow")
        #expect(dates.heading(day(2026, 11, 6, in: dates.calendar), now: now) == "Fri, Nov 6")
        // Another year says which.
        #expect(dates.heading(day(2027, 1, 4, in: dates.calendar), now: now) == "Mon, Jan 4, 2027")
        // A week or a month can show the day before today, which says so.
        #expect(dates.heading(day(2026, 11, 3, in: dates.calendar), now: now) == "Yesterday")
        #expect(dates.heading(day(2026, 11, 2, in: dates.calendar), now: now) == "Mon, Nov 2")
    }

    @Test func readsTheAccountsCalendars() throws {
        let json = """
        {"items": [
          {"id": "robin@otter.example", "summary": "robin@otter.example", "primary": true, "backgroundColor": "#9fe1e7"},
          {"id": "work@otter.example", "summary": "Work", "summaryOverride": "Otterware", "selected": false},
          {"id": "holidays", "summary": "Holidays", "hidden": true},
          {"id": "birthdays", "summary": "Birthdays"}
        ]}
        """
        let page = try GoogleEvents.calendars(Data(json.utf8), account: me)
        #expect(page.next == nil)
        #expect(page.calendars.allSatisfy { $0.account == me })
        // Core's listCalendars: the primary one is `primary`, so a color chosen on the Mac keys the same.
        #expect(page.calendars[0].key == "robin@otter.example|primary")
        // Google's own order, without the ones hidden there.
        #expect(page.calendars.map(\.id) == ["primary", "work@otter.example", "birthdays"])
        #expect(page.calendars[0].primary)
        #expect(page.calendars[0].color == "#9fe1e7")
        // Its name in Google Calendar wins, and one turned off there isn't fetched.
        #expect(page.calendars[1].name == "Otterware")
        #expect(page.calendars.map(\.shown) == [true, false, true])
        // The screen gets them primary first, then by name.
        #expect(GoogleEvents.sorted(page.calendars).map(\.id) == ["primary", "birthdays", "work@otter.example"])
    }

    /** Links and hidden calendars kept under the primary calendar's address before it was `primary` still find it. */
    @Test func readsThePrimaryCalendarsOlderAddressAsPrimary() throws {
        let link = try JSONDecoder().decode(TaskEvent.self, from: Data(#"""
        {"account":"Robin@otter.example","calendarId":"robin@otter.example","eventId":"evt-1","title":"Standup","start":0}
        """#.utf8))
        #expect(link.calendarId == "primary")
        #expect(link.matches(CalendarEvent(eventId: "evt-1", calendar: mine, title: "Standup", start: .now, end: .now)))
        let other = TaskEvent(account: me, calendarId: "work@otter.example", eventId: "e", title: "T", start: .now)
        #expect(other.calendarId == "work@otter.example")

        let shown = CalendarShown.read(#"{"robin@otter.example|robin@otter.example": false, "robin@otter.example|work": true}"#)
        #expect(shown == ["robin@otter.example|primary": false, "robin@otter.example|work": true])
    }

    @Test func carriesGooglesNextPage() throws {
        let json = """
        {"nextPageToken": "page-2", "items": [{"id": "a", "summary": "One of many",
          "start": {"dateTime": "2026-05-04T09:00:00Z"}, "end": {"dateTime": "2026-05-04T10:00:00Z"}}]}
        """
        let page = try GoogleEvents.events(Data(json.utf8), on: mine, me: me, times: EventTimes(calendar: zone("Europe/Berlin")))
        #expect(page.next == "page-2")
        #expect(page.events.count == 1)
    }

    // MARK: - agendaRows.ts (the mobile calendar)

    /**
     * agendaRows.test.ts "groups events under their days, all-day first": its
     * events on its days. Otter Mail's agenda lists what's coming once per
     * event (agenda.tsx), so an empty today gets no heading of its own.
     */
    @Test func groupsEventsUnderTheirDaysAllDayFirst() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let on = { (month: Int, day: Int, hour: Int, minute: Int) in
            self.day(2026, month, day, hour, minute, in: dates.calendar)
        }
        let events = [
            timed("standup", on(10, 1, 9, 0), on(10, 1, 9, 15)),
            allDay("offsite", on(10, 1, 0, 0), on(10, 2, 0, 0)),
            timed("lunch", on(10, 1, 12, 0), on(10, 1, 13, 0)),
            timed("review", on(10, 3, 15, 0), on(10, 3, 16, 0)),
        ]
        #expect(described(events, from: on(9, 30, 0, 0), days: 5, dates: dates) == [
            "# 1",
            "offsite allDay",
            "standup range",
            "lunch range",
            "# 3",
            "review range",
        ])
    }

    /** agendaRows.test.ts "repeats multi-day events on each day with where they start and end". */
    @Test func repeatsLongerEventsSayingWhereTheyStartAndEnd() {
        let dates = calendarDates(zone("Europe/Berlin"))
        let on = { (month: Int, day: Int, hour: Int, minute: Int) in
            self.day(2026, month, day, hour, minute, in: dates.calendar)
        }
        let events = [
            allDay("trip", on(9, 30, 0, 0), on(10, 3, 0, 0)),
            // Under 24 hours, but across midnight: it only says where it starts and ends.
            timed("night", on(10, 1, 22, 0), on(10, 2, 6, 0)),
            // Over 24 hours: a span, which counts its days.
            timed("conference", on(10, 1, 9, 0), on(10, 3, 17, 0)),
        ]
        #expect(described(events, from: on(9, 30, 0, 0), days: 4, dates: dates) == [
            "# 0",
            "trip allDay 1/3",
            "# 1",
            "trip allDay 2/3",
            "conference from 1/3",
            "night from",
            "# 2",
            "trip allDay 3/3",
            "conference allDay 2/3",
            "night until",
            "# 3",
            "conference until 3/3",
        ])
    }

    /**
     * time.test.ts "knows how long local days are" and days.test.ts "keeps
     * fall-back events in New York visible": a local day is 23 or 25 hours
     * around a change, and an event inside the hour that happens twice keeps
     * its real length and its day.
     */
    @Test func keepsDaysAndEventsRightAcrossDaylightSaving() throws {
        let berlin = calendarDates(zone("Europe/Berlin"))
        let hours = { (from: Date) in berlin.addDays(from, 1).timeIntervalSince(from) / 3600 }
        #expect(hours(day(2026, 3, 29, in: berlin.calendar)) == 23)
        #expect(hours(day(2026, 10, 25, in: berlin.calendar)) == 25)
        #expect(hours(day(2026, 7, 1, in: berlin.calendar)) == 24)

        // 01:30 EDT (05:30Z) to 01:10 EST (06:10Z): 40 minutes while the wall clock runs back.
        let newYork = calendarDates(zone("America/New_York"))
        let json = """
        {"items": [{"id": "overlap", "summary": "Overlap",
          "start": {"dateTime": "2026-11-01T05:30:00Z"}, "end": {"dateTime": "2026-11-01T06:10:00Z"}}]}
        """
        let overlap = try events(json, in: newYork.calendar)
        let november1 = day(2026, 11, 1, in: newYork.calendar)
        #expect(EventDays.byDay(overlap, days: [november1], dates: newYork).keys.sorted() == [november1])
        #expect(EventDays.timing(of: overlap[0], on: november1, dates: newYork).kind == .range)
        #expect(CalendarDates.durationLabel(overlap[0].end.timeIntervalSince(overlap[0].start)) == "40min")

        // The same day's midnight to midnight is 25 hours, so it's a span of that one day.
        let whole = timed("whole", november1, newYork.addDays(november1, 1))
        #expect(whole.end.timeIntervalSince(whole.start) == 25 * 3600)
        #expect(EventDays.timing(of: whole, on: november1, dates: newYork) == EventTiming(kind: .allDay))
    }

    // MARK: - eventPresentation.ts (the mobile calendar)

    /** eventPresentation.test.ts's guests: the organizer first, then by answer, and no rooms. */
    @Test func listsGuestsLikeTheMobileCalendar() throws {
        let json = """
        {"items": [{"id": "sync", "summary": "Sync",
          "start": {"dateTime": "2026-05-04T09:00:00Z"}, "end": {"dateTime": "2026-05-04T10:00:00Z"},
          "organizer": {"email": "org@example.com"},
          "attendees": [
            {"email": "zoe@example.com", "responseStatus": "declined"},
            {"email": "room@example.com", "responseStatus": "accepted", "resource": true},
            {"email": "bo@example.com", "displayName": "Bo", "responseStatus": "needsAction"},
            {"email": "al@example.com", "displayName": "Al", "responseStatus": "accepted"},
            {"email": "org@example.com", "responseStatus": "accepted"},
            {"email": "cy@example.com", "responseStatus": "tentative"}
          ]}]}
        """
        let event = try #require(try events(json, in: zone("Europe/Berlin")).first)
        #expect(event.guests.map(\.person.email) == [
            "org@example.com",
            "al@example.com",
            "cy@example.com",
            "bo@example.com",
            "zoe@example.com",
        ])
        #expect(event.rooms.map(\.person.email) == ["room@example.com"])
        #expect(CalendarEvent.responseSummary(event.guests) == "2 yes, 1 maybe, 1 no, 1 awaiting")
    }

    /** eventPresentation.test.ts's plainDescription: Google's HTML as readable text. */
    @Test func readsGooglesDescriptionAsText() {
        #expect(EventDescription.plain("  Agenda:\n1. Numbers < targets  ") == "Agenda:\n1. Numbers < targets")
        let html = """
        Join us<br>Notes: <a href="https://docs.example.com/x">the doc</a><br><br><br>\
        <ul><li>One</li><li>Two &amp; three</li></ul>&nbsp;&#8212;
        """
        #expect(EventDescription.plain(html) == "Join us\nNotes: the doc (https://docs.example.com/x)\n\n• One\n• Two & three\n —")
        // A bare link is shown once.
        #expect(EventDescription.plain(##"<a href="https://x.dev">https://x.dev</a>"##) == "https://x.dev")
        // Named entities the reader knew, and hidden elements whose text isn't the event's.
        #expect(EventDescription.plain("<p>Bob&rsquo;s notes &mdash; review</p>") == "Bob’s notes — review")
        #expect(EventDescription.plain("<style>p{color:red}</style><p>Agenda</p>") == "Agenda")
    }

    /**
     * CalendarEventRouteScreen's eventWhen: an event made in another zone also
     * says its time there, when that zone's clock differs from the phone's.
     */
    @Test func readsAnEventInItsOwnZoneWhenItDiffers() throws {
        let berlin = zone("Europe/Berlin")
        let dates = calendarDates(berlin, CalendarPreferences(ui: ["calendar:time-format": "24"]))
        let json = """
        {"items": [{"id": "call", "summary": "New York call",
          "start": {"dateTime": "2026-05-04T09:00:00+02:00", "timeZone": "America/New_York"},
          "end": {"dateTime": "2026-05-04T10:00:00+02:00", "timeZone": "America/New_York"}}]}
        """
        let event = try #require(try events(json, in: berlin).first)
        #expect(event.timeZone == "America/New_York")
        #expect(dates.elsewhere(event.start, event.end, zone: event.timeZone) == "03:00–04:00 EDT (America/New York)")
        // The phone's own zone, and one that only reads differently, say nothing.
        #expect(dates.elsewhere(event.start, event.end, zone: "Europe/Berlin") == nil)
        #expect(dates.elsewhere(event.start, event.end, zone: "Europe/Paris") == nil)
        #expect(dates.elsewhere(event.start, event.end, zone: nil) == nil)
    }

    /** The phone's picker and pages run Agenda, Day, Month; Week stays out of them. */
    @Test func thePhonesPagesRunAgendaDayMonth() {
        #expect(CalendarMode.phone == [.agenda, .day, .month])
        #expect(CalendarMode.agenda.neighbour(1) == .day)
        #expect(CalendarMode.day.neighbour(1) == .month)
        #expect(CalendarMode.month.neighbour(-1) == .day)
        #expect(CalendarMode.agenda.neighbour(-1) == nil)
        #expect(CalendarMode.month.neighbour(1) == nil)
        #expect(CalendarMode.week.neighbour(1) == nil)
    }

    /** A swipe or tap changes the mode only once it lands on another of the phone's pages. */
    @Test func aTurnSettlesOnlyOnAnotherPage() {
        #expect(CalendarMode.agenda.settling(on: .day) == .day)
        #expect(CalendarMode.month.settling(on: .agenda) == .agenda)
        #expect(CalendarMode.day.settling(on: .day) == nil)
        #expect(CalendarMode.day.settling(on: nil) == nil)
        #expect(CalendarMode.day.settling(on: .week) == nil)
    }

    @Test func theDemoFillsEveryView() {
        let calendar = zone("Europe/Berlin")
        let dates = calendarDates(calendar)
        let now = day(2026, 11, 4, 10, 0, in: calendar)
        for mode in CalendarMode.allCases {
            let window = dates.window(mode, anchor: now)
            let events = DemoCalendar.events(in: window, now: now, dates: dates)
            #expect(!events.isEmpty, "\(mode.title) has nothing to show")
            #expect(events.allSatisfy { $0.end > window.from && $0.start < window.to })
        }
        let month = dates.window(.month, anchor: now)
        let offsite = DemoCalendar.events(in: month, now: now, dates: dates).filter { $0.eventId == "offsite" }
        #expect(offsite.count == 1)
        #expect(offsite.first?.allDay == true)
        #expect(EventDays.byDay(offsite, days: dates.days(in: month), dates: dates).count == 3)
    }

    @Test func aWindowIsFreshForThirtySecondsAsOnTheMac() {
        let loaded = Date(timeIntervalSince1970: 1_000)
        #expect(CalendarStore.isFresh(loaded, now: loaded.addingTimeInterval(29)))
        #expect(!CalendarStore.isFresh(loaded, now: loaded.addingTimeInterval(30)))
        #expect(!CalendarStore.isFresh(nil, now: loaded))
    }

    /** calendar-store.ts's isShown: a choice made by hand wins, else Google's own. */
    @Test func showsACalendarAsTheWebAppDoes() {
        let key = "robin@otter.example|work"
        #expect(CalendarShown.isShown([:], key: key, hiddenByDefault: false))
        #expect(!CalendarShown.isShown([:], key: key, hiddenByDefault: true))
        #expect(CalendarShown.isShown([key: true], key: key, hiddenByDefault: true))
        #expect(!CalendarShown.isShown([key: false], key: key, hiddenByDefault: false))
        #expect(CalendarShown.isShown([key: false], key: "robin@otter.example|other", hiddenByDefault: false))

        let unselected = EventCalendar(id: "holidays", name: "Holidays", shown: false, account: me)
        #expect(!CalendarShown.isShown([:], unselected))
        #expect(CalendarShown.isShown(["\(me)|holidays": true], unselected))
        #expect(!CalendarShown.isShown(["someone@else.example|holidays": true], unselected))
        #expect(CalendarShown.isShown(["someone@else.example|holidays": true], unselected.of("someone@else.example")))
    }

    @Test func dropsTheEventsOfHiddenCalendars() {
        let calendar = zone("Europe/Berlin")
        let start = day(2026, 3, 10, 9, in: calendar)
        let end = day(2026, 3, 10, 10, in: calendar)
        let work = EventCalendar(id: "work", name: "Otterware", account: me)
        let holidays = EventCalendar(id: "holidays", name: "Holidays", shown: false, account: me)
        let all = [
            CalendarEvent(eventId: "a", calendar: mine, title: "a", start: start, end: end),
            CalendarEvent(eventId: "b", calendar: work, title: "b", start: start, end: end),
            CalendarEvent(eventId: "c", calendar: holidays, title: "c", start: start, end: end),
        ]

        #expect(CalendarShown.visible(all, shown: [:]).map(\.eventId) == ["a", "b"])
        #expect(CalendarShown.visible(all, shown: ["\(me)|work": false]).map(\.eventId) == ["a"])
        #expect(
            CalendarShown.visible(all, shown: ["\(me)|holidays": true, "\(me)|primary": false]).map(\.eventId)
                == ["b", "c"]
        )
    }

    /** Kept as localStorage keeps it: a JSON object under `calendar:shown`. */
    @MainActor @Test func keepsTheChoiceOnThisDevice() throws {
        let suite = "calendar-shown-tests"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defaults.removePersistentDomain(forName: suite)
        defer { defaults.removePersistentDomain(forName: suite) }

        let work = EventCalendar(id: "work", name: "Otterware", account: me)
        let visibility = CalendarShown(defaults: defaults)
        #expect(visibility.isShown(work))
        visibility.setShown(work, show: false)
        #expect(!visibility.isShown(work))
        #expect(CalendarShown.read(defaults.string(forKey: CalendarShown.key)) == ["\(me)|work": false])
        #expect(!CalendarShown(defaults: defaults).isShown(work))
        // Another account's calendar of the same id is its own.
        #expect(CalendarShown(defaults: defaults).isShown(work.of("maya@otter.example")))

        #expect(CalendarShown.read(##"{"a|b": true, "bad": "yes"}"##) == ["a|b": true])
        #expect(CalendarShown.read("nonsense").isEmpty)
        #expect(CalendarShown.read(nil).isEmpty)
    }

    private func mailbox(_ email: String, _ name: String, signedOut: Bool = false) -> Mailbox {
        Mailbox(email: email, name: name, displayName: name, color: "#336699", signature: "", labels: [], signedOut: signedOut)
    }

    /** calendar-view.tsx's calendarAccounts: every mailbox with a calendar, unless it's signed out. */
    @Test func readsTheCalendarOfEveryMailboxThatHasOne() {
        let personal = mailbox(me, "Personal")
        let work = mailbox("work@otter.example", "Work")
        let gone = mailbox("old@otter.example", "Old", signedOut: true)
        let outlook = Mailbox(
            email: "robin@outlook.example", name: "Robin", displayName: "Outlook",
            color: "#000000", signature: "", labels: [], outlook: true
        )
        #expect(CalendarStore.sources([personal, outlook, gone, work]).map(\.email) == [me, "work@otter.example"])
    }

    /** Two accounts' primary calendars are both `primary`: the account tells them, and their events, apart. */
    @Test func tellsTwoAccountsPrimaryCalendarsApart() {
        let theirs = mine.of("work@otter.example")
        #expect(mine != theirs)
        #expect(mine.key == "robin@otter.example|primary")
        #expect(theirs.key == "work@otter.example|primary")
        let start = Date(timeIntervalSince1970: 1_000)
        let a = CalendarEvent(eventId: "x", calendar: mine, title: "a", start: start, end: start.addingTimeInterval(60))
        let b = CalendarEvent(eventId: "x", calendar: theirs, title: "a", start: start, end: start.addingTimeInterval(60))
        #expect(a.id != b.id)
        #expect(CalendarShown.visible([a, b], shown: ["work@otter.example|primary": false]).map(\.calendar.account) == [me])
    }

    /** One list of every account's events, in the calendar's order, whichever account answered first. */
    @Test func mergesEveryAccountsEvents() {
        let other = mine.of("work@otter.example")
        let start = Date(timeIntervalSince1970: 10_000)
        let early = CalendarEvent(eventId: "early", calendar: other, title: "early", start: start, end: start.addingTimeInterval(600))
        let late = CalendarEvent(eventId: "late", calendar: mine, title: "late", start: start.addingTimeInterval(3600), end: start.addingTimeInterval(4200))
        let allDay = CalendarEvent(eventId: "day", calendar: mine, title: "day", start: start.addingTimeInterval(7200), end: start.addingTimeInterval(90_000), allDay: true)
        let parts = [me: [late, allDay], "work@otter.example": [early], "gone@otter.example": [early]]
        let merged = CalendarStore.merged(parts, accounts: [me, "work@otter.example"])
        #expect(merged.map(\.eventId) == ["day", "early", "late"])
        #expect(CalendarStore.merged([:], accounts: [me]).isEmpty)
    }

    /** calendar-sidebar.tsx: a section a mailbox, in the mailboxes' order, one with no list yet empty. */
    @Test func groupsTheCalendarsByAccount() {
        let personal = mailbox(me, "Personal")
        let work = mailbox("work@otter.example", "Work")
        let lists = [
            "work@otter.example": [mine.of("work@otter.example")],
            "gone@otter.example": [mine.of("gone@otter.example")],
        ]
        let groups = CalendarStore.grouped([personal, work], lists: lists)
        #expect(groups.map(\.mailbox.email) == [me, "work@otter.example"])
        #expect(groups[0].calendars.isEmpty)
        #expect(groups[1].calendars.map(\.key) == ["work@otter.example|primary"])
    }

    @Test func findsTheInvitationsWaitingOnAnAnswer() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let hour: TimeInterval = 3600
        var hidden = EventCalendar(id: "team", name: "Team", account: me)
        hidden.shown = false
        var other = EventCalendar(id: "shared", name: "Shared", account: me)
        other.primary = false
        var cancelled = timed("cancelled", now + hour, now + 2 * hour, response: .needsAction)
        cancelled.status = .cancelled
        var weekly1 = timed("weekly_1", now + 5 * hour, now + 6 * hour, response: .needsAction)
        weekly1.seriesId = "weekly"
        var weekly2 = timed("weekly_2", now + 50 * hour, now + 51 * hour, response: .needsAction)
        weekly2.seriesId = "weekly"
        var onHidden = timed("hidden", now + hour, now + 2 * hour, response: .needsAction)
        onHidden.calendar = hidden
        var copy = timed("lunch", now + 3 * hour, now + 4 * hour, response: .needsAction)
        copy.calendar = other
        let events = [
            timed("past", now - 2 * hour, now - hour, response: .needsAction),
            timed("answered", now + hour, now + 2 * hour, response: .accepted),
            timed("mine", now + hour, now + 2 * hour),
            cancelled, weekly2, weekly1, onHidden, copy,
            timed("lunch", now + 3 * hour, now + 4 * hour, response: .needsAction),
        ]
        let invites = CalendarStore.invites(events, shown: [:], now: now)
        #expect(invites.map(\.eventId) == ["lunch", "weekly_1"])
        #expect(invites.first?.calendar.primary == true)
        #expect(CalendarStore.invites(events, shown: [hidden.key: true], now: now).map(\.eventId) == ["hidden", "lunch", "weekly_1"])
    }

    @Test func answersForTheSeriesAnOccurrenceIsOf() {
        var occurrence = timed("weekly_20261106", .now, .now, response: .needsAction)
        #expect(CalendarStore.answerKey(occurrence) == "\(me)/weekly_20261106")
        occurrence.seriesId = "weekly"
        #expect(CalendarStore.answerKey(occurrence) == "\(me)/weekly")
        occurrence.attendees = [.init(person: Person(name: "", email: "Robin@Otter.example")), .init(person: Person(name: "", email: "ann@example.com"))]
        let answered = CalendarStore.answered(occurrence, .tentative)
        #expect(answered.response == .tentative)
        #expect(answered.attendees.map(\.response) == [.tentative, .needsAction])
    }

    /** core's setResponse: the mailbox's own attendee gets the answer, the rest stay, and it's added when missing. */
    @Test func answersAsCoreDoes() {
        let attendees: [[String: Any]] = [
            ["email": "ann@example.com", "responseStatus": "accepted"],
            ["email": "Robin@Otter.example", "responseStatus": "needsAction", "displayName": "Robin"],
        ]
        let answered = GoogleEvents.answered(attendees, me: me, response: .declined)
        #expect(answered.map { $0["responseStatus"] as? String } == ["accepted", "declined"])
        #expect(answered[1]["displayName"] as? String == "Robin")
        let bySelf = GoogleEvents.answered([["email": "alias@otter.example", "self": true]], me: me, response: .accepted)
        #expect(bySelf.count == 1 && bySelf[0]["responseStatus"] as? String == "accepted")
        let added = GoogleEvents.answered([["email": "ann@example.com"]], me: me, response: .tentative)
        #expect(added.count == 2)
        #expect(added[1]["email"] as? String == me && added[1]["self"] as? Bool == true && added[1]["responseStatus"] as? String == "tentative")
    }
}
