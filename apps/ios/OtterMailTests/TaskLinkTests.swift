import Foundation
import Testing
import UserNotifications
@testable import Otter_Mail

/**
 * A task's links to mail and events: files from before several links (one
 * `email`) read as one link and are written so those builds still read them,
 * a link a build can't read is left out rather than the task, and an event's
 * link reaches its occurrence or its whole series.
 */
struct TaskLinkTests {
    private let id = UUID()
    private let start = Date(timeIntervalSince1970: 1_800_000_000)

    private func decode(_ json: String) throws -> MailTask {
        try JSONDecoder().decode(MailTask.self, from: Data(json.utf8))
    }

    private func email(_ thread: String, mailbox: String = "robin@otter.example") -> TaskEmail {
        TaskEmail(mailbox: mailbox, thread: thread, message: "m-\(thread)", subject: "Subject \(thread)")
    }

    private func event(
        _ eventId: String, series: String? = nil, originalStart: Date? = nil, calendar: String = "work",
        account: String = "robin@otter.example"
    ) -> CalendarEvent {
        CalendarEvent(
            eventId: eventId, calendar: EventCalendar(id: calendar, name: "Work", account: account), title: "Standup",
            start: originalStart ?? start, end: (originalStart ?? start).addingTimeInterval(900), recurring: series != nil,
            seriesId: series, originalStart: originalStart
        )
    }

    // MARK: Migration

    @Test func readsTheOneEmailOfAnOlderFileAsItsOnlyLink() throws {
        let task = try decode(#"""
        {"id":"\#(id.uuidString)","content":"Say yes","email":{"mailbox":"robin@otter.example","thread":"t1","message":"m1","subject":"Dinner?"}}
        """#)
        #expect(task.emails == [TaskEmail(mailbox: "robin@otter.example", thread: "t1", message: "m1", subject: "Dinner?")])
        #expect(task.email?.thread == "t1")
        #expect(task.events.isEmpty)
    }

    @Test func readsAnOlderFileWithoutLinks() throws {
        let task = try decode(#"{"id":"\#(id.uuidString)","content":"Water the plot"}"#)
        #expect(task.emails.isEmpty)
        #expect(task.events.isEmpty)
        #expect(task.email == nil)
    }

    @Test func prefersTheListOverTheOneEmailItRepeats() throws {
        let task = try decode(#"""
        {"id":"\#(id.uuidString)","content":"Both",
         "email":{"mailbox":"robin@otter.example","thread":"t1","subject":"One"},
         "emails":[{"mailbox":"robin@otter.example","thread":"t1","subject":"One"},{"mailbox":"robin@otter.example","thread":"t2","subject":"Two"}]}
        """#)
        #expect(task.emails.map(\.thread) == ["t1", "t2"])
    }

    @Test func writesTheFirstLinkAsTheOneEmailForOlderBuilds() throws {
        let task = MailTask(content: "Linked", emails: [email("t1"), email("t2")])
        let data = try JSONEncoder().encode(task)
        let object = try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect((object["email"] as? [String: Any])?["thread"] as? String == "t1")
        #expect((object["emails"] as? [Any])?.count == 2)

        // What an older build reads is the first link; this build reads every one.
        #expect(try JSONDecoder().decode(OlderTask.self, from: data).email?.thread == "t1")
        #expect(try JSONDecoder().decode(MailTask.self, from: data) == task)
    }

    @Test func roundTripsEmailsAndEvents() throws {
        let series = TaskEvent(event("standup_1", series: "standup", originalStart: start), scope: .series)
        let one = TaskEvent(event("call"), scope: .occurrence)
        let task = MailTask(content: "Both", emails: [email("t1")], events: [series, one])
        let decoded = try JSONDecoder().decode(MailTask.self, from: JSONEncoder().encode(task))
        #expect(decoded == task)
        #expect(decoded.events.map(\.scope) == [.series, .occurrence])
    }

    @Test func leavesOutALinkItCantReadAndKeepsTheTask() throws {
        let task = try decode(#"""
        {"id":"\#(id.uuidString)","content":"Mixed",
         "emails":[{"mailbox":"robin@otter.example","thread":"t1","subject":"One"},{"thread":42}],
         "events":[{"account":"robin@otter.example","calendarId":"work","eventId":"e1","title":"Call","start":800000000},{"title":"no ids"}]}
        """#)
        #expect(task.content == "Mixed")
        #expect(task.emails.map(\.thread) == ["t1"])
        #expect(task.events.map(\.eventId) == ["e1"])
        #expect(task.events.first?.provider == "google")
    }

    @Test func readsAScopeItDoesntKnowAsTheOneOccurrence() throws {
        let task = try decode(#"""
        {"id":"\#(id.uuidString)","content":"Newer",
         "events":[{"account":"Robin@Otter.example","calendarId":"work","eventId":"e1","seriesId":"s","scope":"thisAndFollowing","title":"Call","start":800000000}]}
        """#)
        #expect(task.events.first?.scope == .occurrence)
        #expect(task.events.first?.account == "robin@otter.example")
    }

    @Test func linksOnlyAnEventOfASeriesAsTheSeries() {
        let single = TaskEvent(event("call"), scope: .series)
        #expect(single.scope == .occurrence)
        #expect(single.scoped(.series).scope == .occurrence)
    }

    // MARK: Links

    @Test func keepsOneLinkATarget() {
        var task = MailTask(content: "Dedup", email: email("t1"), emails: [email("t1", mailbox: "Robin@Otter.example"), email("t2")])
        #expect(task.emails.map(\.thread) == ["t1", "t2"])
        task = TaskLinks.linking(task, email: email("t2"))
        #expect(task.emails.count == 2)

        let occurrence = TaskEvent(event("standup_1", series: "standup", originalStart: start), scope: .occurrence)
        task = TaskLinks.linking(TaskLinks.linking(task, event: occurrence), event: occurrence)
        #expect(task.events.count == 1)
        // The series is another link than its occurrence.
        task = TaskLinks.linking(task, event: occurrence.scoped(.series))
        #expect(task.events.count == 2)
    }

    @Test func offersOnlyEventsFromTodayOnSoonestFirst() {
        var gregorian = Calendar(identifier: .gregorian)
        gregorian.timeZone = TimeZone(identifier: "Europe/Berlin")!
        let dates = CalendarDates(calendar: gregorian)
        let now = gregorian.date(from: DateComponents(year: 2026, month: 11, day: 8, hour: 12))!
        let today = gregorian.startOfDay(for: now)
        let hour: TimeInterval = 3600
        func at(_ id: String, _ start: Date, hours: Double = 1, allDay: Bool = false) -> CalendarEvent {
            CalendarEvent(
                eventId: id, calendar: EventCalendar(id: "work", name: "Work", account: "robin@otter.example"), title: id,
                start: start, end: start.addingTimeInterval(hours * hour), allDay: allDay
            )
        }
        let events = [
            at("next-week", today.addingTimeInterval(7 * 24 * hour)),
            at("decade-ago", gregorian.date(byAdding: .year, value: -10, to: now)!),
            at("yesterday", today.addingTimeInterval(-5 * hour)),
            at("tomorrow", today.addingTimeInterval(33 * hour)),
            at("this-morning", today.addingTimeInterval(9 * hour)),
            at("all-day-next-week", today.addingTimeInterval(7 * 24 * hour), hours: 24, allDay: true),
            at("going-on", today.addingTimeInterval(-2 * hour), hours: 16),
        ]
        #expect(TaskLinks.upcoming(events, now: now, dates: dates).map(\.title) == [
            "going-on", "this-morning", "tomorrow", "all-day-next-week", "next-week",
        ])
    }

    @Test func rescopesInPlaceWithoutMakingASecondLink() {
        let occurrence = TaskEvent(event("standup_1", series: "standup", originalStart: start), scope: .occurrence)
        var task = MailTask(content: "Rescope", events: [occurrence])
        task = TaskLinks.rescoping(task, event: occurrence.key, to: .series)
        #expect(task.events.map(\.scope) == [.series])
        // Widening an occurrence to a series already linked folds them into one.
        task = MailTask(content: "Fold", events: [occurrence, occurrence.scoped(.series)])
        task = TaskLinks.rescoping(task, event: occurrence.key, to: .series)
        #expect(task.events.count == 1)
    }

    @Test func unlinkingKeepsTheTaskAndItsOtherLinks() {
        let call = TaskEvent(event("call"), scope: .occurrence)
        var task = MailTask(content: "Keep", emails: [email("t1"), email("t2")], events: [call])
        task = TaskLinks.unlinking(task, email: email("t1").key)
        task = TaskLinks.unlinking(task, event: call.key)
        #expect(task.content == "Keep")
        #expect(task.emails.map(\.thread) == ["t2"])
        #expect(task.events.isEmpty)
    }

    @Test func findsTheTasksOfAConversationUnderAnyOfItsAddresses() {
        let linked = MailTask(content: "Alias", email: email("t1", mailbox: "Robin@Otter.example"))
        let other = MailTask(content: "Other", email: email("t2"))
        let found = TaskLinks.linked([linked, other], thread: "t1", mailboxes: ["alias@otter.example", "robin@otter.example"])
        #expect(found.map(\.content) == ["Alias"])
    }

    @Test func reachesAnOccurrenceOrTheWholeSeries() {
        let first = event("standup_1", series: "standup", originalStart: start)
        let next = event("standup_2", series: "standup", originalStart: start.addingTimeInterval(86400))
        let elsewhere = event("standup_2", series: "standup", originalStart: start, calendar: "home")

        let occurrence = TaskEvent(first, scope: .occurrence)
        #expect(occurrence.matches(first))
        #expect(!occurrence.matches(next))
        #expect(!occurrence.matches(elsewhere))

        let series = TaskEvent(first, scope: .series)
        #expect(series.matches(first))
        #expect(series.matches(next))
        #expect(!series.matches(elsewhere))

        let tasks = [MailTask(content: "One", events: [occurrence]), MailTask(content: "All", events: [series])]
        #expect(TaskLinks.linked(tasks, to: next).map(\.content) == ["All"])
        #expect(TaskLinks.linked(tasks, to: first).map(\.content) == ["One", "All"])
    }

    @Test func findsAMovedOccurrenceByWhereItWas() {
        let linked = TaskEvent(event("standup_1", series: "standup", originalStart: start), scope: .occurrence)
        var moved = event("standup_moved", series: "standup", originalStart: start)
        moved.start = start.addingTimeInterval(7200)
        #expect(linked.matches(moved))
    }

    /** A tap on a link of a task's detail goes through Tasks: a conversation to Mail, an event to the calendar. */
    @MainActor @Test func opensEachLinkOfTheTaskDetailWhereItLeads() throws {
        let suite = "TaskLinkTests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let mailbox = Mailbox(email: "robin@otter.example", name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])
        let store = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], defaults: defaults)
        let labels = TaskLinkLabels(store: store, calendar: CalendarStore(), dates: CalendarDates())
        let conversation = email("t1")
        let gone = email("t2", mailbox: "gone@otter.example")
        let series = TaskEvent(event("standup_1", series: "standup", originalStart: start), scope: .series)
        let task = MailTask(content: "Prepare", emails: [conversation, gone], events: [series])

        var mail: [TaskEmail] = []
        var calendar: [TaskTarget] = []
        let links = TaskDetailLink.all(of: task, labels: labels) { target in
            TasksView.route(target, onEmail: { mail.append($0) }, openTarget: { calendar.append($0) })
        }
        #expect(links.map(\.target) == [.email(conversation), .email(gone), .event(series)])
        #expect(links[1].open == nil)

        links[0].open?()
        #expect(mail == [conversation])
        #expect(calendar.isEmpty)

        links[2].open?()
        #expect(mail == [conversation])
        #expect(calendar == [.event(series)])
    }

    @Test func keepsWhatTheEventSaidForWhenItsGone() {
        let link = TaskEvent(event("call"), scope: .occurrence)
        let kept = link.snapshot(calendar: nil)
        #expect(kept.title == "Standup")
        #expect(kept.start == start)
        #expect(kept.end == start.addingTimeInterval(900))
        #expect(kept.calendar.id == "work")
    }

    @MainActor @Test func readsAConversationDeletedFromItsMailboxAsNotAvailable() {
        let mailbox = Mailbox(email: "robin@otter.example", name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])
        let message = Message(id: "m-t1", from: Person(name: "Ann", email: "ann@example.com"), to: [], cc: [], date: start,
                              text: "", html: nil, attachments: [], unread: false, starred: false, draft: false, headers: [:])
        let thread = MailThread(id: "t1", mailbox: mailbox.email, subject: "Dinner?", labels: ["INBOX"], messages: [message])
        let store = MailStore(preferences: Preferences(), mailboxes: [mailbox], threads: [thread])
        let labels = TaskLinkLabels(store: store, calendar: CalendarStore(), dates: CalendarDates())

        #expect(labels.email(email("t1")).unavailable == false)
        #expect(labels.email(email("t2")).unavailable == false)
        store.remove(threadIDs: ["t1"])
        #expect(labels.email(email("t1")).unavailable == true)
        store.upsert(threads: [thread])
        #expect(labels.email(email("t1")).unavailable == false)
    }

    @MainActor @Test func stillReadsADeletedConversationAsNotAvailableAfterARestart() throws {
        let suite = "TaskLinkTests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let mailbox = Mailbox(email: "robin@otter.example", name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])
        MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], defaults: defaults).remove(threadIDs: ["t1"])

        let reopened = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], defaults: defaults)
        let labels = TaskLinkLabels(store: reopened, calendar: CalendarStore(), dates: CalendarDates())
        #expect(labels.email(email("t1")).unavailable == true)
    }

    /** Gmail's history ran out: the cache starts over from the inbox, and the conversations it left out are still there. */
    @MainActor @Test func keepsAConversationOnlyDroppedFromTheCacheAvailable() async throws {
        let suite = "TaskLinkTests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let mailbox = Mailbox(email: "robin@otter.example", name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])
        let message = Message(id: "m-t1", from: Person(name: "Ann", email: "ann@example.com"), to: [], cc: [], date: start,
                              text: "", html: nil, attachments: [], unread: false, starred: false, draft: false, headers: [:])
        let archived = MailThread(id: "t1", mailbox: mailbox.email, subject: "Dinner?", labels: [], messages: [message])
        let store = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], threads: [archived], defaults: defaults)
        let folder = URL.temporaryDirectory.appending(path: "TaskLinkTests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: folder) }
        let sync = MailSync(store: store, google: GoogleAuth(), cache: MailCache(folder: folder), providers: [mailbox.email: StartOverProvider()])

        await sync.sync(mailbox.email)
        #expect(store.thread("t1") == nil)
        let labels = TaskLinkLabels(store: store, calendar: CalendarStore(), dates: CalendarDates())
        #expect(labels.email(email("t1")).unavailable == false)
        let reopened = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], defaults: defaults)
        #expect(TaskLinkLabels(store: reopened, calendar: CalendarStore(), dates: CalendarDates()).email(email("t1")).unavailable == false)
    }

}

@MainActor
private final class Gate {
    private var held: CheckedContinuation<Void, Never>?
    var reached: Bool { held != nil }
    func wait() async { await withCheckedContinuation { held = $0 } }
    func open() {
        held?.resume()
        held = nil
    }
}

private nonisolated struct NoReminders: TaskReminding {
    func status() async -> UNAuthorizationStatus { .denied }
    func ask() async {}
    func pending() async -> [String] { [] }
    func delivered() async -> [String] { [] }
    func remove(pending: [String], delivered: [String]) async {}
    func add(_ task: MailTask, scope: String) async {}
}

/** A task as builds from before several links read it. */
private nonisolated struct OlderTask: Decodable {
    var email: TaskEmail?
}
