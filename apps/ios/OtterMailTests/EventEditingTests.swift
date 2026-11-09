import Foundation
import Testing
@testable import Otter_Mail

/**
 * Making, changing and deleting events, as ported from the web app's
 * event-panel.tsx (NewEvent, EventDetails, TimeRows), api.ts (eventTimes,
 * hasGuests, useCalendarActions) and core's gmail/calendar.ts (apiBody). The
 * store's writes go to a stand-in for Google that records what it was asked;
 * nothing here reaches a calendar.
 */
struct EventEditingTests {
    private let robin = "robin@otter.example"
    private var mine: EventCalendar {
        EventCalendar(id: "robin@otter.example", name: "Robin", primary: true, account: robin, writable: true)
    }
    private var shared: EventCalendar {
        EventCalendar(id: "holidays", name: "Holidays", account: robin)
    }

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Europe/Berlin")!
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    private var dates: CalendarDates { CalendarDates(calendar: calendar) }

    private func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    // MARK: Drafts

    @Test func aNewEventTodayStartsAtTheNextHourForAnHour() {
        let draft = EventDraft.new(on: mine, day: at(7, 0), now: at(7, 14, 20), dates: dates)
        #expect(draft.start == at(7, 15))
        #expect(draft.end == at(7, 16))
        #expect(!draft.allDay)
        #expect(draft.calendar == mine)
    }

    @Test func aNewEventOnAnotherDayStartsAtNine() {
        let draft = EventDraft.new(on: mine, day: at(12, 0), now: at(7, 14), dates: dates)
        #expect(draft.start == at(12, 9))
        #expect(draft.end == at(12, 10))
    }

    @Test func allDayCoversTheDaysAndBackIsNineToTen() {
        var draft = EventDraft(calendar: mine, start: at(9, 14), end: at(10, 11))
        draft.setAllDay(true, dates: dates)
        #expect(draft.start == at(9, 0))
        #expect(draft.end == at(11, 0), "an all-day event ends the midnight after its last day")
        #expect(dates.sameDay(draft.lastDay(dates: dates), at(10, 0)))
        draft.setAllDay(false, dates: dates)
        #expect(draft.start == at(9, 9))
        #expect(draft.end == at(9, 10))
    }

    @Test func movingTheStartKeepsTheLength() {
        var draft = EventDraft(calendar: mine, start: at(9, 14), end: at(9, 15, 30))
        draft.move(to: at(10, 8))
        #expect(draft.end == at(10, 9, 30))
    }

    @Test func editingReadsTheDescriptionAsText() {
        let event = CalendarEvent(eventId: "e", calendar: mine, title: "(no title)", start: at(9, 9), end: at(9, 10),
                                  location: "Studio", details: "Bring <b>seeds</b><br>and gloves")
        let draft = EventDraft(editing: event)
        #expect(draft.title == "")
        #expect(draft.location == "Studio")
        #expect(draft.notes == "Bring seeds\nand gloves")
    }

    // MARK: Validation

    @Test func anEndBeforeTheStartIsRefused() {
        var draft = EventDraft(calendar: mine, start: at(9, 10), end: at(9, 10))
        #expect(draft.problem == "The end has to be after the start.")
        draft.end = at(9, 11)
        #expect(draft.problem == nil)
    }

    @Test func aReadOnlyCalendarIsRefused() {
        let draft = EventDraft(calendar: shared, start: at(9, 10), end: at(9, 11))
        #expect(draft.problem == "This calendar can't be changed from Otter Mail.")
    }

    @Test func theDefaultCalendarIsThePickThenThePrimaryThenAnyThatTakesEvents() {
        let work = EventCalendar(id: "work", name: "Work", account: robin, writable: true)
        let all = [shared, work, mine]
        #expect(defaultCalendar(of: all, chosen: "") == mine)
        #expect(defaultCalendar(of: all, chosen: work.key) == work)
        #expect(defaultCalendar(of: all, chosen: "\(robin)|primary") == mine, "core names the primary calendar `primary`")
        #expect(defaultCalendar(of: all, chosen: shared.key) == mine, "a read-only pick doesn't take events")
        #expect(defaultCalendar(of: [shared], chosen: "") == nil)
    }

    @Test func onlyYourOwnEventsOnWritableCalendarsOpenToBeChanged() {
        let organizer = Person(name: "Jonas", email: "jonas@example.de")
        let yours = CalendarEvent(eventId: "a", calendar: mine, title: "Mine", start: at(9, 9), end: at(9, 10))
        let invite = CalendarEvent(eventId: "b", calendar: mine, title: "Theirs", start: at(9, 9), end: at(9, 10), organizer: organizer)
        let readOnly = CalendarEvent(eventId: "c", calendar: shared, title: "Holiday", start: at(9, 0), end: at(10, 0), allDay: true)
        #expect(yours.isEditable)
        #expect(!invite.isEditable)
        #expect(!readOnly.isEditable)
    }

    // MARK: Payloads

    @Test func createSendsTitleTimesAndPlace() {
        var draft = EventDraft(calendar: mine, title: "  Lunch  ", start: at(9, 12), end: at(9, 13))
        draft.location = " Café Linden "
        let input = draft.input(dates: dates)
        #expect(input == EventInput(title: "Lunch", start: .instant(at(9, 12)), end: .instant(at(9, 13)), location: "Café Linden"))
        let body = EventBody.json(input, timeZone: "Europe/Berlin")
        #expect(body["summary"] as? String == "Lunch")
        #expect(body["location"] as? String == "Café Linden")
        #expect(body["description"] == nil)
        #expect((body["start"] as? [String: Any])?["dateTime"] as? String == "2026-11-09T11:00:00Z")
        #expect((body["start"] as? [String: Any])?["timeZone"] as? String == "Europe/Berlin")
        #expect((body["end"] as? [String: Any])?["dateTime"] as? String == "2026-11-09T12:00:00Z")
    }

    @Test func anUntitledEventIsNoTitle() {
        let draft = EventDraft(calendar: mine, title: "   ", start: at(9, 12), end: at(9, 13))
        #expect(draft.input(dates: dates).title == "(no title)")
    }

    @Test func allDaySendsLocalDaysWithTheEndTheDayAfter() {
        var draft = EventDraft(calendar: mine, title: "Offsite", start: at(9, 0), end: at(9, 0))
        draft.allDay = true
        let input = draft.input(dates: dates)
        #expect(input.start == .day("2026-11-09"))
        #expect(input.end == .day("2026-11-10"), "an end at the start is moved to the day after, as eventTimes does")
        #expect(input.allDay == true)
        let body = EventBody.json(input)
        #expect((body["start"] as? [String: Any])?["date"] as? String == "2026-11-09")
        #expect((body["start"] as? [String: Any])?["dateTime"] == nil)
    }

    @Test func aPatchHasOnlyWhatChanged() {
        let original = EventDraft(calendar: mine, title: "Lunch", start: at(9, 12), end: at(9, 13), location: "Café", notes: "Bring cake")
        var draft = original
        #expect(draft.patch(from: original, dates: dates).isEmpty)
        draft.location = "Park"
        #expect(draft.patch(from: original, dates: dates) == EventInput(location: "Park"))
        draft.move(to: at(9, 14))
        let moved = draft.patch(from: original, dates: dates)
        #expect(moved.start == .instant(at(9, 14)))
        #expect(moved.end == .instant(at(9, 15)))
        #expect(moved.allDay == false)
        #expect(moved.title == nil)
        #expect(moved.description == nil)
    }

    @Test func turningAnEventAllDayClearsItsTimes() throws {
        let original = EventDraft(calendar: mine, title: "Lunch", start: at(9, 12), end: at(9, 13))
        var draft = original
        draft.setAllDay(true, dates: dates)
        let body = EventBody.json(draft.patch(from: original, dates: dates), wasAllDay: false)
        let start = try #require(body["start"] as? [String: Any])
        #expect(start["date"] as? String == "2026-11-09")
        #expect(start["dateTime"] is NSNull)
        #expect(start["timeZone"] is NSNull)
        #expect(JSONSerialization.isValidJSONObject(body))
    }

    @Test func googleSaysWhichCalendarsTakeEvents() throws {
        let json = """
        {"items":[
          {"id":"robin@otter.example","summary":"Robin","primary":true,"accessRole":"owner"},
          {"id":"team","summary":"Team","accessRole":"writer"},
          {"id":"holidays","summary":"Holidays","accessRole":"reader"}
        ]}
        """
        let listed = try GoogleEvents.calendars(Data(json.utf8), account: robin).calendars
        #expect(listed.map(\.writable) == [true, true, false])
    }

    @Test func googlesAnswerToACreateIsTheEvent() throws {
        let json = """
        {"id":"abc","summary":"Lunch","location":"Café","start":{"dateTime":"2026-11-09T12:00:00+01:00"},
         "end":{"dateTime":"2026-11-09T13:00:00+01:00"},"htmlLink":"https://calendar.google.com/event?eid=abc"}
        """
        let event = try GoogleEvents.event(Data(json.utf8), on: mine, me: robin, times: EventTimes(calendar: calendar))
        #expect(event.eventId == "abc")
        #expect(event.title == "Lunch")
        #expect(event.start == at(9, 12))
        #expect(event.calendar == mine)
    }

    // MARK: The store, against a stand-in for Google

    @MainActor @Test func theStoreCreatesChangesAndDeletesThroughTheWriter() async throws {
        let store = CalendarStore()
        let mailbox = Mailbox(email: robin, name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])
        let window = dates.window(.day, anchor: at(9, 0))
        await store.load(window, sources: [mailbox], demo: true, google: GoogleAuth(), dates: dates)
        let listed = store.lists[robin] ?? []
        let firstWritable = listed.first { $0.writable }
        let calendar = try #require(firstWritable)
        let writer = RecordingWriter(dates: dates)

        let draft = EventDraft(calendar: calendar, title: "Dentist", start: at(9, 15), end: at(9, 16))
        let made = try await store.create(draft, with: writer, dates: dates)
        #expect(found(made, in: window, of: store) != nil)
        #expect(await writer.calls == ["create Dentist notify:false"])

        var changed = EventDraft(editing: made)
        changed.title = "Dentist (moved)"
        changed.move(to: at(9, 17))
        let saved = try await store.update(made, to: changed, with: writer, dates: dates)
        #expect(saved.title == "Dentist (moved)")
        #expect(found(made, in: window, of: store)?.start == at(9, 17))
        #expect(await writer.patches.last == EventInput(
            title: "Dentist (moved)", start: .instant(at(9, 17)), end: .instant(at(9, 18)), allDay: false
        ))

        try await store.delete(saved, with: writer)
        #expect(found(made, in: window, of: store) == nil)
        #expect(await writer.calls.last == "delete Dentist (moved) notify:false")
    }

    @MainActor @Test func anUnchangedEventIsntSentAndAnInvalidOneIsRefused() async throws {
        let store = CalendarStore()
        let writer = RecordingWriter(dates: dates)
        let event = CalendarEvent(eventId: "e", calendar: mine, title: "Lunch", start: at(9, 12), end: at(9, 13))
        _ = try await store.update(event, to: EventDraft(editing: event), with: writer, dates: dates)
        var backwards = EventDraft(editing: event)
        backwards.end = at(9, 11)
        await #expect(throws: EventProblem.self) {
            try await store.update(event, to: backwards, with: writer, dates: dates)
        }
        await #expect(throws: EventProblem.self) {
            try await store.create(EventDraft(calendar: shared, start: at(9, 9), end: at(9, 10)), with: writer, dates: dates)
        }
        #expect(await writer.calls.isEmpty)
    }

    @MainActor @Test func guestsAreToldOfChangesToEventsWithThem() async throws {
        let store = CalendarStore()
        let writer = RecordingWriter(dates: dates)
        let guest = CalendarEvent.Attendee(person: Person(name: "Maya", email: "maya@example.com"))
        let event = CalendarEvent(eventId: "e", calendar: mine, title: "Review", start: at(9, 12), end: at(9, 13), attendees: [guest])
        var draft = EventDraft(editing: event)
        draft.location = "Studio"
        _ = try await store.update(event, to: draft, with: writer, dates: dates)
        try await store.delete(event, with: writer)
        #expect(await writer.calls == ["update Review notify:true", "delete Review notify:true"])
    }

    @MainActor @Test func theDemosChangesOutliveItsEventsBeingMadeAgain() async throws {
        let store = CalendarStore()
        let mailbox = Mailbox(email: robin, name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])
        let window = dates.window(.day, anchor: .now)
        await store.load(window, sources: [mailbox], demo: true, google: GoogleAuth(), dates: dates)
        let listed = store.lists[robin] ?? []
        let firstWritable = listed.first { $0.writable }
        let calendar = try #require(firstWritable)
        let writer = store.writer(for: robin, demo: true, google: GoogleAuth())
        let start = dates.calendar.date(bySettingHour: 18, minute: 0, second: 0, of: .now)!
        let made = try await store.create(
            EventDraft(calendar: calendar, title: "Demo dinner", start: start, end: start.addingTimeInterval(3600)),
            with: writer, demo: true, dates: dates
        )
        await store.load(window, sources: [mailbox], demo: true, google: GoogleAuth(), dates: dates, force: true)
        #expect(found(made, in: window, of: store) != nil)

        try await store.delete(made, with: writer, demo: true)
        await store.load(window, sources: [mailbox], demo: true, google: GoogleAuth(), dates: dates, force: true)
        #expect(found(made, in: window, of: store) == nil)
    }

    /** The window's copy of an event, looked up outside the macros so they wrap no closure. */
    @MainActor private func found(_ event: CalendarEvent, in window: EventWindow, of store: CalendarStore) -> CalendarEvent? {
        let events = store.events(in: window) ?? []
        return events.first { $0.id == event.id }
    }
}

/** Google, as far as the store can tell: it answers as Google would and keeps what it was asked. */
private actor RecordingWriter: EventWriter {
    let dates: CalendarDates
    private(set) var calls: [String] = []
    private(set) var patches: [EventInput] = []

    init(dates: CalendarDates) { self.dates = dates }

    func create(_ input: EventInput, on calendar: EventCalendar, notify: Bool) async throws -> CalendarEvent {
        calls.append("create \(input.title ?? "") notify:\(notify)")
        let blank = CalendarEvent(eventId: "made-\(calls.count)", calendar: calendar, title: "", start: .now, end: .now)
        return input.applied(to: blank, dates: dates)
    }

    func update(_ event: CalendarEvent, with patch: EventInput, notify: Bool) async throws -> CalendarEvent {
        calls.append("update \(event.title) notify:\(notify)")
        patches.append(patch)
        return patch.applied(to: event, dates: dates)
    }

    func delete(_ event: CalendarEvent, notify: Bool) async throws {
        calls.append("delete \(event.title) notify:\(notify)")
    }
}
