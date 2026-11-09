import Foundation
import Testing
import UserNotifications
@testable import Otter_Mail

/**
 * The tasks' pure parts: how the list groups and sorts them (in the calendar's
 * days, `CalendarDates`), the JSON on disk, which reminders are scheduled and
 * what their requests are called, and which notifications route to a task
 * rather than to mail. The store's own scheduling is checked against a
 * stand-in notification center (`Reminders`), which can hold a job mid-flight.
 */
struct TaskTests {
    private func folder() -> URL {
        URL.temporaryDirectory.appending(path: "tasks-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    private func zone(_ identifier: String = "Europe/Berlin") -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: identifier)!
        calendar.firstWeekday = 2
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    private func at(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0, in calendar: Calendar) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private func task(_ content: String, due: Date? = nil, hasTime: Bool = false, reminder: Bool = false,
                      done: Bool = false, created: Date = Date(timeIntervalSince1970: 0)) -> MailTask {
        MailTask(content: content, due: due, hasTime: hasTime, reminder: reminder, done: done, created: created)
    }

    // MARK: Sorting and grouping

    @Test func groupsByWhenATaskIsDue() {
        let calendar = zone()
        let dates = CalendarDates(calendar: calendar)
        let now = at(2026, 3, 10, 14, 0, in: calendar)
        let group = { (task: MailTask) in TaskList.group(of: task, now: now, dates: dates) }

        #expect(group(task("no date")) == .noDate)
        #expect(group(task("yesterday", due: at(2026, 3, 9, 23, 0, in: calendar))) == .overdue)
        #expect(group(task("today, no time", due: at(2026, 3, 10, 9, 0, in: calendar))) == .today)
        // A time that has passed is overdue; later today is still today.
        #expect(group(task("this morning", due: at(2026, 3, 10, 9, 0, in: calendar), hasTime: true)) == .overdue)
        #expect(group(task("tonight", due: at(2026, 3, 10, 20, 0, in: calendar), hasTime: true)) == .today)
        #expect(group(task("tomorrow", due: at(2026, 3, 11, 8, 0, in: calendar), hasTime: true)) == .upcoming)
        #expect(group(task("finished", due: at(2026, 3, 9, 8, 0, in: calendar), done: true)) == .done)
    }

    @Test func sortsSoonestFirstAndTheUndatedLast() {
        let calendar = zone()
        let dates = CalendarDates(calendar: calendar)
        let now = at(2026, 3, 10, 14, 0, in: calendar)
        let later = task("later", due: at(2026, 3, 12, 9, 0, in: calendar))
        let soon = task("soon", due: at(2026, 3, 11, 9, 0, in: calendar))
        let none = task("none")
        let first = task("written first", created: Date(timeIntervalSince1970: 10))
        let second = task("written second", created: Date(timeIntervalSince1970: 20))

        #expect(TaskList.sorted([none, later, soon]).map(\.content) == ["soon", "later", "none"])
        #expect(TaskList.sorted([second, first]).map(\.content) == ["written first", "written second"])

        let sections = TaskList.sections([none, later, soon], now: now, dates: dates)
        #expect(sections.map(\.id) == [.upcoming, .noDate])
        #expect(sections[0].tasks.map(\.content) == ["soon", "later"])
    }

    @Test func sectionsAreInOrderAndFinishedTasksReadNewestFirst() {
        let calendar = zone()
        let dates = CalendarDates(calendar: calendar)
        let now = at(2026, 3, 10, 14, 0, in: calendar)
        var earlier = task("done earlier", done: true)
        earlier.completed = at(2026, 3, 10, 9, 0, in: calendar)
        var later = task("done later", done: true)
        later.completed = at(2026, 3, 10, 13, 0, in: calendar)
        let sections = TaskList.sections([
            earlier,
            later,
            task("no date"),
            task("overdue", due: at(2026, 3, 1, 9, 0, in: calendar)),
            task("today", due: now),
            task("upcoming", due: at(2026, 3, 20, 9, 0, in: calendar)),
        ], now: now, dates: dates)

        #expect(sections.map(\.id) == [.overdue, .today, .upcoming, .noDate, .done])
        #expect(sections.last?.tasks.map(\.content) == ["done later", "done earlier"])
    }

    @Test func labelsTheDueDateInTheCalendarsWords() {
        let calendar = zone()
        var preferences = CalendarPreferences()
        preferences.timeFormat = .twentyFour
        let dates = CalendarDates(calendar: calendar, preferences: preferences)
        let now = at(2026, 3, 10, 14, 0, in: calendar)

        #expect(TaskList.dueLabel(task("none"), now: now, dates: dates) == nil)
        #expect(TaskList.dueLabel(task("day", due: at(2026, 3, 11, 0, 0, in: calendar)), now: now, dates: dates) == "Tomorrow")
        #expect(TaskList.dueLabel(
            task("time", due: at(2026, 3, 10, 18, 30, in: calendar), hasTime: true), now: now, dates: dates
        ) == "Today · 18:30")
    }

    // MARK: Reminders

    @Test func remindsOnlyWhenThereIsATimeStillToCome() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let ahead = now.addingTimeInterval(3600)
        #expect(task("day only", due: ahead, reminder: true).reminderAt == nil)
        #expect(task("no reminder", due: ahead, hasTime: true).reminderAt == nil)
        #expect(task("reminds", due: ahead, hasTime: true, reminder: true).reminderAt == ahead)
        #expect(task("finished", due: ahead, hasTime: true, reminder: true, done: true).reminderAt == nil)
    }

    @Test func schedulesTheNearestRemindersAndNothingInThePast() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let reminding = { (name: String, seconds: TimeInterval) in
            self.task(name, due: now.addingTimeInterval(seconds), hasTime: true, reminder: true)
        }
        let past = reminding("past", -60)
        let soon = reminding("soon", 60)
        let later = reminding("later", 600)
        let plain = task("no reminder", due: now.addingTimeInterval(60))

        let scheduled = TaskReminders.scheduled([later, past, plain, soon], now: now)
        #expect(scheduled.map(\.content) == ["soon", "later"])

        // iOS keeps 64 pending requests an app, so only the nearest are asked for.
        let many = (1...50).map { reminding("task \($0)", TimeInterval($0) * 60) }
        let limited = TaskReminders.scheduled(Array(many.reversed()), now: now, limit: 3)
        #expect(limited.map(\.content) == ["task 1", "task 2", "task 3"])
        #expect(TaskReminders.scheduled(many, now: now).count == TaskReminders.limit)
    }

    @Test func namesTheRemindersThereIsNoRoomFor() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let reminding = { (name: String, seconds: TimeInterval) in
            self.task(name, due: now.addingTimeInterval(seconds), hasTime: true, reminder: true)
        }
        let many = (1...TaskReminders.limit + 1).map { reminding("task \($0)", TimeInterval($0) * 60) }

        #expect(TaskReminders.waiting(many, now: now).map(\.content) == ["task \(TaskReminders.limit + 1)"])
        #expect(TaskReminders.waiting(Array(many.prefix(TaskReminders.limit)), now: now).isEmpty)
        #expect(TaskReminders.waiting(many, now: now, limit: 2).count == TaskReminders.limit - 1)
        // One that has passed is no longer scheduled, so it isn't waiting either.
        #expect(TaskReminders.waiting([reminding("past", -60)], now: now, limit: 0).isEmpty)
    }

    @Test func tellsTheEditorWhichReminderIsStillWaiting() async {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let reminding = { (minutes: Int) in
            self.task("task \(minutes)", due: .now.addingTimeInterval(TimeInterval(minutes) * 60), hasTime: true, reminder: true)
        }
        let many = (1...TaskReminders.limit + 1).map(reminding)
        let store = TaskStore(files: TaskFiles(folder: folder), reminders: Reminders())
        store.open("demo", seed: many)
        await store.settled()

        #expect(store.waiting == [many[TaskReminders.limit].id])
        #expect(store.isWaiting(many[TaskReminders.limit]))
        #expect(!store.isWaiting(many[0]))
        // Brought forward, it takes a scheduled one's place.
        var sooner = many[TaskReminders.limit]
        sooner.due = .now.addingTimeInterval(30)
        #expect(!store.isWaiting(sooner))
    }

    // MARK: Scheduling

    @Test func doesntPutADeletedTasksReminderBack() async {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let reminders = Reminders(holding: true)
        let store = TaskStore(files: TaskFiles(folder: folder), reminders: reminders)
        let reminding = task("Call the clinic", due: .now.addingTimeInterval(3600), hasTime: true, reminder: true)
        store.open("demo", seed: [reminding])

        // The task is deleted while the first job is still asking iOS what's pending.
        await reminders.reached()
        store.delete(reminding)
        await reminders.release()
        await store.settled()

        #expect(await reminders.added.isEmpty)
        #expect(await reminders.pendingIds.isEmpty)
    }

    @Test func takesTheScopesRemindersDownOnSignOutMidFlight() async {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let reminding = task("Call the clinic", due: .now.addingTimeInterval(3600), hasTime: true, reminder: true)
        let delivered = TaskReminders.identifier(reminding.id, scope: "demo")
        let reminders = Reminders(holding: true, delivered: [delivered, "mail:robin@otter.example"])
        let store = TaskStore(files: TaskFiles(folder: folder), reminders: reminders)
        store.open("demo", seed: [reminding])

        await reminders.reached()
        store.close()
        await reminders.release()
        await store.settled()

        #expect(await reminders.added.isEmpty)
        // A reminder already in Notification Center goes too; mail's notifications stay.
        #expect(await reminders.deliveredIds == ["mail:robin@otter.example"])
    }

    @Test func namesOneRequestPerTaskAndFindsItsScope() {
        let id = UUID()
        let identifier = TaskReminders.identifier(id, scope: "demo")
        #expect(identifier == TaskReminders.identifier(id, scope: "demo"))
        #expect(identifier != TaskReminders.identifier(UUID(), scope: "demo"))
        #expect(TaskReminders.scope(of: identifier) == "demo")
        #expect(TaskReminders.scope(of: TaskReminders.identifier(id, scope: "cm9iaW4=")) == "cm9iaW4=")
        #expect(TaskReminders.scope(of: "otter-mail:something") == nil)
        #expect(TaskReminders.scope(of: "mail:demo:\(id.uuidString)") == nil)
    }

    // MARK: Routing

    @Test func routesItsOwnRemindersAndLeavesMailAlone() {
        let id = UUID()
        let reminding = task("reminds")
        let payload = TaskReminders.payload(reminding, scope: "demo")
        #expect(TaskReminders.destination(payload) == TaskDestination(scope: "demo", id: reminding.id))
        #expect(TaskReminders.destination(["otterTask": ["id": id.uuidString, "scope": "demo"]] as [AnyHashable: Any])
            == TaskDestination(scope: "demo", id: id))
        // Mail's notifications (OtterMailApp's AppDelegate) must still reach their conversation.
        #expect(TaskReminders.destination([
            "otter": ["userId": "u1", "email": "robin@otter.example"], "thread": "t1", "message": "m1",
        ] as [AnyHashable: Any]) == nil)
        #expect(TaskReminders.destination(["otterTask": ["id": "not a uuid", "scope": "demo"]] as [AnyHashable: Any]) == nil)
        #expect(TaskReminders.destination(["otterTask": ["id": id.uuidString, "scope": ""]] as [AnyHashable: Any]) == nil)
        #expect(TaskReminders.destination([:] as [AnyHashable: Any]) == nil)
    }

    // MARK: On disk

    @Test func keepsTasksOnDiskPerScope() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)

        // No file yet is not the same as a file that reads as no tasks.
        #expect(try files.load("demo") == nil)

        let dinner = MailTask(
            content: "Say yes to dinner",
            notes: "Bring the wine.",
            due: Date(timeIntervalSince1970: 1_700_000_000),
            hasTime: true,
            reminder: true
        )
        try await files.save([dinner, MailTask(content: "Water the plot")], scope: "demo")

        let loaded = try files.load("demo")
        #expect(loaded?.count == 2)
        #expect(loaded?.first == dinner)
        // One scope an account: the demo's tasks aren't another's.
        #expect(try files.load("cm9iaW4=") == nil)
    }

    @Test func keepsAFileItCantReadAndSaysSo() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = folder.appending(path: "demo.json")
        let broken = Data(#"[{"id":"not a uuid"}]"#.utf8)
        try broken.write(to: file)
        let files = TaskFiles(folder: folder)

        #expect(throws: (any Error).self) { try files.load("demo") }

        let store = TaskStore(files: files, reminders: Reminders())
        store.open("demo", seed: [task("seeded")])
        #expect(store.tasks.isEmpty)
        #expect(store.failure != nil)

        // Nothing is written over a file that might still hold the user's tasks.
        await #expect(throws: (any Error).self) { try await store.save(self.task("Buy the tickets")) }
        #expect(store.tasks.isEmpty)
        #expect(try Data(contentsOf: file) == broken)
    }

    @Test func doesntConfirmASaveThatCouldntBeWritten() async throws {
        let blocked = URL.temporaryDirectory.appending(path: "tasks-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: blocked) }
        // A file where the folder would go: the write fails, and the editor is told.
        try Data("not a folder".utf8).write(to: blocked)
        let files = TaskFiles(folder: blocked.appending(path: "tasks", directoryHint: .isDirectory))
        let store = TaskStore(files: files, reminders: Reminders())
        store.open("demo")

        await #expect(throws: (any Error).self) { try await store.save(self.task("Buy the tickets")) }
        #expect(store.tasks.isEmpty)
    }

    @Test func doesntPutBackATaskDeletedWhileItsSaveWasWritten() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        let reply = task("Reply to Robin")
        store.open("demo", seed: [reply])
        await store.settled()

        var edited = reply
        edited.content = "Reply to Robin today"
        let saving = Task { try await store.save(edited) }
        await Task.yield()
        store.delete(reply)
        try await saving.value
        await store.settled()

        #expect(store.tasks.isEmpty)
        #expect(try files.load("demo")?.isEmpty == true)
    }

    @Test func doesntPutBackATaskDeletedWhileItsSaveWaitedItsTurn() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        let reply = task("Reply to Robin")
        store.open("demo", seed: [reply])
        await store.settled()

        var edited = reply
        edited.content = "Reply to Robin today"
        // The save waits behind another write, and the task is deleted before its turn comes.
        let other = Task { try await store.save(self.task("Buy the tickets")) }
        let saving = Task { try await store.save(edited) }
        await Task.yield()
        await Task.yield()
        store.delete(reply)
        try await other.value
        try await saving.value
        await store.settled()

        #expect(store.tasks.map(\.content) == ["Buy the tickets"])
        #expect(try files.load("demo")?.map(\.content) == ["Buy the tickets"])
    }

    @Test func dropsASaveFromTheAccountSignedOutOfWhileItWasWritten() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        store.open("a", seed: [task("A's first")])
        await store.settled()

        let writing = Task { try await store.save(self.task("A's second")) }
        let queued = Task { try await store.save(self.task("A's third")) }
        // The first is on its way to disk and the second waits behind it when the account changes.
        await Task.yield()
        store.close()
        store.open("b", seed: [task("B's own")])
        try await writing.value
        try await queued.value
        await store.settled()

        #expect(store.scope == "b")
        #expect(store.tasks.map(\.content) == ["B's own"])
        #expect(try files.load("b")?.map(\.content) == ["B's own"])
        // A's file has what was on its way to it, and nothing that was asked after A had gone.
        #expect(try files.load("a")?.contains { $0.content == "A's third" } == false)
    }

    /** Done and deleted while a save is being written are shown at once, and land in A's file even once B is open. */
    @Test func keepsWhatAShowedWhenTheAccountChangesBeforeItsWritten() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        let finished = task("A's finished")
        let dropped = task("A's dropped")
        store.open("a", seed: [finished, dropped])
        await store.settled()

        let writing = Task { try await store.save(self.task("A's saved")) }
        await Task.yield()
        store.setDone(true, finished)
        store.delete(dropped)
        store.close()
        store.open("b", seed: [task("B's own")])
        try await writing.value
        await store.settled()

        #expect(store.tasks.map(\.content) == ["B's own"])
        #expect(try files.load("b")?.map(\.content) == ["B's own"])
        let a = try #require(try files.load("a"))
        #expect(a.map(\.content) == ["A's finished", "A's saved"])
        #expect(a.first?.done == true)
    }

    /** Opened again before what it left queued is written, the account shows those changes, and its next save keeps them. */
    @Test func keepsWhatItLeftQueuedWhenTheSameAccountOpensAgain() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        let finished = task("A's finished")
        let dropped = task("A's dropped")
        store.open("a", seed: [finished, dropped])
        await store.settled()

        let writing = Task { try await store.save(self.task("A's saved")) }
        await Task.yield()
        store.setDone(true, finished)
        store.delete(dropped)
        store.close()
        store.open("a")
        #expect(store.tasks.map(\.content) == ["A's finished"])
        #expect(store.task(finished.id)?.done == true)
        try await writing.value
        await store.settled()

        #expect(store.tasks.map(\.content) == ["A's finished", "A's saved"])
        try await store.save(task("A's next"))
        let a = try #require(try files.load("a"))
        #expect(a.map(\.content) == ["A's finished", "A's saved", "A's next"])
        #expect(a.first?.done == true)
    }

    /** Opened again while a new list is written, the account reads it back from the file, and has it once. */
    @Test func makesOneListWhenTheSameAccountOpensDuringItsWrite() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        store.open("a")
        await store.settled()

        let creating = Task { try await store.createProject("Errands") }
        await Task.yield()
        store.close()
        store.open("a")
        let made = try #require(try await creating.value)
        await store.settled()

        #expect(store.projects.map(\.id) == [made.id])
        try await store.renameProject(made.id, to: "Chores")
        #expect(try files.loadProjects("a")?.map(\.name) == ["Chores"])
    }

    @Test func keepsBothOfTwoQuickLinks() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        let reply = task("Reply to Robin")
        store.open("demo", seed: [reply])
        await store.settled()

        let one = TaskEmail(mailbox: "robin@otter.example", thread: "t1", subject: "One")
        let two = TaskEmail(mailbox: "robin@otter.example", thread: "t2", subject: "Two")
        // The second is asked for while the first is still being written.
        let first = Task { try await store.update(reply.id) { TaskLinks.linking($0, email: one) } }
        let second = Task { try await store.update(reply.id) { TaskLinks.linking($0, email: two) } }
        try await first.value
        try await second.value

        #expect(store.task(reply.id)?.emails.map(\.thread) == ["t1", "t2"])
        #expect(try files.load("demo")?.first?.emails.map(\.thread) == ["t1", "t2"])
    }

    /** A change that would come out differently asked twice (the scope picker moved during the write) is asked once. */
    @Test func showsTheLinkItWrote() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders())
        let reply = task("Reply to Robin")
        store.open("demo", seed: [reply])
        await store.settled()

        var asked = 0
        try await store.update(reply.id) { task in
            asked += 1
            return TaskLinks.linking(task, email: TaskEmail(mailbox: "robin@otter.example", thread: "t\(asked)", subject: "One"))
        }

        #expect(asked == 1)
        #expect(store.task(reply.id)?.emails.map(\.thread) == ["t1"])
        #expect(try files.load("demo")?.first?.emails.map(\.thread) == ["t1"])
    }

    @Test func takesItsContentAndLinkFromTheConversation() {
        let thread = MailThread(
            id: "t1",
            mailbox: "robin@otter.example",
            subject: "Dinner Saturday? 🍝",
            labels: ["INBOX"],
            messages: [Message(
                id: "m1",
                from: Person(name: "Maya Chen", email: "maya.chen@example.com"),
                to: [Person(name: "Robin", email: "robin@otter.example")],
                cc: [],
                date: Date(timeIntervalSince1970: 1_700_000_000),
                text: "Pasta?",
                html: nil,
                attachments: [],
                unread: true,
                starred: false,
                draft: false,
                headers: [:]
            )]
        )
        let task = MailTask(from: thread, mailbox: "robin@otter.example")
        #expect(task.content == "Dinner Saturday? 🍝")
        #expect(task.email?.mailbox == "robin@otter.example")
        #expect(task.email?.thread == "t1")
        #expect(task.email?.message == "m1")
        // Without notes, a reminder says which conversation it came from.
        #expect(task.reminderBody == "From: Dinner Saturday? 🍝")
    }
    @Test func readsAFileMissingTheFieldsItDoesntHaveYet() throws {
        let id = UUID()
        let json = Data(#"[{"id":"\#(id.uuidString)","content":"Older build"}]"#.utf8)
        let tasks = try JSONDecoder().decode([MailTask].self, from: json)
        #expect(tasks.count == 1)
        #expect(tasks[0].id == id)
        #expect(tasks[0].content == "Older build")
        #expect(tasks[0].due == nil)
        #expect(!tasks[0].done)
    }

}

/**
 * Stands in for iOS's notification center: it keeps what was asked of it, and
 * can hold a job where the real one would be answering, so what the store does
 * meanwhile is what the tests are about.
 */
private actor Reminders: TaskReminding {
    private(set) var added: [String] = []
    private(set) var pendingIds: [String] = []
    private(set) var deliveredIds: [String] = []
    private var holding: Bool
    private var atGate = false
    private var waiting: CheckedContinuation<Void, Never>?
    private var held: CheckedContinuation<Void, Never>?

    init(holding: Bool = false, delivered: [String] = []) {
        self.holding = holding
        deliveredIds = delivered
    }

    func status() async -> UNAuthorizationStatus { .authorized }

    func ask() async {}

    func pending() async -> [String] {
        await hold()
        return pendingIds
    }

    func delivered() async -> [String] { deliveredIds }

    func remove(pending: [String], delivered: [String]) async {
        pendingIds.removeAll { pending.contains($0) }
        deliveredIds.removeAll { delivered.contains($0) }
    }

    func add(_ task: MailTask, scope: String) async {
        let identifier = TaskReminders.identifier(task.id, scope: scope)
        added.append(identifier)
        if !pendingIds.contains(identifier) { pendingIds.append(identifier) }
    }

    /** Waits for a job to reach the hold. */
    func reached() async {
        guard !atGate else { return }
        await withCheckedContinuation { waiting = $0 }
    }

    /** Lets it go on, and answers every job after it. */
    func release() {
        holding = false
        atGate = false
        held?.resume()
        held = nil
    }

    private func hold() async {
        guard holding else { return }
        atGate = true
        waiting?.resume()
        waiting = nil
        await withCheckedContinuation { held = $0 }
    }
}
