import Foundation
import Testing
import UserNotifications
@testable import Otter_Mail

/**
 * What the bar's ⌃⌄ panels scope: the calendar to one mailbox or one calendar
 * (calendar-store.ts's showOnly), and Tasks to a list (`TaskProject`, shaped
 * as the Todoist extension's projects), its lists kept beside the tasks file.
 */
struct ScopeTests {
    private let robin = "robin@otter.example"
    private let sam = "sam@acme.example"

    private var calendars: [EventCalendar] {
        [
            EventCalendar(id: "primary", name: "Robin", primary: true, account: robin),
            EventCalendar(id: "work", name: "Otterware", account: robin),
            EventCalendar(id: "primary", name: "Sam", primary: true, account: sam),
            EventCalendar(id: "acme", name: "Acme team", account: sam),
            EventCalendar(id: "holidays", name: "Holidays", shown: false, account: sam),
        ]
    }

    private func folder() -> URL {
        URL.temporaryDirectory.appending(path: "tasks-\(UUID().uuidString)", directoryHint: .isDirectory)
    }

    private func defaults() -> UserDefaults {
        let name = "scope-tests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }


    @Test func scopingToAMailboxHidesTheOthersCalendars() {
        let all = calendars
        let scoped = CalendarShown.scoped([:], account: sam, calendars: all)
        let shown = all.filter { CalendarShown.isShown(scoped, $0) }.map(\.key)
        // Sam's Holidays stays off, as Google has it.
        #expect(shown == ["\(sam)|primary", "\(sam)|acme"])
        // A mailbox's address in another case is the same mailbox.
        #expect(CalendarShown.scoped([:], account: sam.uppercased(), calendars: all) == scoped)
        // All: what was chosen by hand, nothing more.
        #expect(CalendarShown.scoped(["\(robin)|work": false], account: nil, calendars: all) == ["\(robin)|work": false])
    }

    @Test func scopingFiltersTheEventsDrawn() {
        let all = calendars
        let events = all.map { CalendarEvent(eventId: $0.key, calendar: $0, title: $0.name, start: .now, end: .now.addingTimeInterval(60)) }
        let robins = CalendarShown.visible(events, shown: CalendarShown.scoped([:], account: robin, calendars: all))
        #expect(robins.map(\.calendar.account) == [robin, robin])
        #expect(CalendarShown.visible(events, shown: [:]).count == 4)
    }

    @Test func showsOnlyOneCalendarAndAllBringsTheRestBack() {
        let all = calendars
        let keys = all.map(\.key)
        let only = CalendarShown.showingOnly(["elsewhere|x": true], key: "\(sam)|acme", keys: keys)
        #expect(all.filter { CalendarShown.isShown(only, $0) }.map(\.key) == ["\(sam)|acme"])
        // A calendar that isn't listed here keeps its own choice.
        #expect(only["elsewhere|x"] == true)

        // All means every one on, the one Google leaves unchecked (Holidays) too.
        let everything = CalendarShown.allShown(only, keys: keys)
        #expect(all.allSatisfy { CalendarShown.isShown(everything, $0) })
        #expect(everything["\(sam)|holidays"] == true)
        #expect(everything["elsewhere|x"] == true)
        #expect(CalendarShown.allShown(["elsewhere|x": false], keys: keys)["elsewhere|x"] == false)
    }

    @Test func keepsTheChoicesAndNotTheMailboxPicked() {
        let defaults = defaults()
        let all = calendars
        let visibility = CalendarShown(defaults: defaults)
        visibility.account = sam
        visibility.showOnly(all[0], among: all)
        // Showing only one of Robin's calendars leaves Sam's mailbox.
        #expect(visibility.account == nil)
        #expect(visibility.isShown(all[0]))
        #expect(!visibility.isShown(all[3]))

        let again = CalendarShown(defaults: defaults)
        #expect(again.shown == visibility.shown)
        #expect(again.account == nil)

        again.account = robin
        again.showAll(all)
        #expect(again.account == nil)
        #expect(all.allSatisfy { again.isShown($0) })
        #expect(all.allSatisfy { CalendarShown(defaults: defaults).isShown($0) })
    }

    @Test func writesACalendarsColorUnderTheSyncedKey() throws {
        let defaults = defaults()
        let preferences = Preferences(defaults: defaults)
        var changed: [String] = []
        preferences.onChange = { changed.append($0) }
        // Nothing pulled or picked yet: the synced section leaves the other devices' colors alone.
        #expect(preferences.uiSection["calendar:colors"] == nil)

        preferences.setCalendarColor("#5ea8e0", for: "\(sam)|acme")
        #expect(preferences.calendar.colors == ["\(sam)|acme": "#5ea8e0"])
        #expect(changed == ["ui"])
        let synced = try #require(preferences.uiSection["calendar:colors"])
        #expect(CalendarPreferences(ui: ["calendar:colors": synced]).colors == ["\(sam)|acme": "#5ea8e0"])

        preferences.setCalendarColor(nil, for: "\(sam)|acme")
        #expect(preferences.calendar.colors.isEmpty)
        #expect(preferences.uiSection["calendar:colors"] == "{}")
        #expect(Preferences(defaults: defaults).calendar.colors.isEmpty)
        #expect(EventStyle.choices.count == 17)
    }

    @Test func demoHasACalendarForEachGmailMailbox() {
        let dates = CalendarDates()
        let window = dates.window(.month, anchor: .now)
        #expect(DemoCalendar.acmeCalendars.map(\.id) == ["demo-sam", "demo-acme"])
        let acme = DemoCalendar.acmeEvents(in: window, dates: dates)
        #expect(!acme.isEmpty)
        #expect(Set(acme.map(\.calendar.id)).isSubset(of: ["demo-sam", "demo-acme"]))
        #expect(!acme.contains { $0.response == .needsAction })
    }

    @Test func filtersTasksByList() {
        let work = TaskProject(id: "work", name: "Work")
        let tasks = [
            MailTask(content: "inbox, from before lists"),
            MailTask(content: "on work", projectId: work.id),
            MailTask(content: "on a list since gone", projectId: "gone"),
        ]
        #expect(TaskProject.filter(tasks, project: nil).count == 3)
        #expect(TaskProject.filter(tasks, project: TaskProject.inbox.id).map(\.content) == ["inbox, from before lists"])
        #expect(TaskProject.filter(tasks, project: work.id).map(\.content) == ["on work"])
        #expect(TaskProject.named("  Errands \n") == "Errands")
        #expect(TaskProject.named("   ") == nil)
    }

    @Test func readsATasksFileFromBeforeListsAndWritesTheListBack() throws {
        let id = UUID()
        let older = Data(#"[{"id":"\#(id.uuidString)","content":"Older build","done":false}]"#.utf8)
        let tasks = try JSONDecoder().decode([MailTask].self, from: older)
        #expect(tasks[0].projectId == nil)
        // No list, no key: a build from before lists reads it unchanged.
        let written = try JSONSerialization.jsonObject(with: JSONEncoder().encode(tasks)) as? [[String: Any]]
        #expect(written?.first?["projectId"] == nil)

        var moved = tasks[0]
        moved.projectId = "work"
        let again = try JSONDecoder().decode([MailTask].self, from: JSONEncoder().encode([moved]))
        #expect(again[0].projectId == "work")
    }

    @Test func createsRenamesAndSelectsListsKeptOnDisk() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let defaults = defaults()
        // A tasks file from before lists, and no lists file.
        try await files.save([MailTask(content: "Older task")], scope: "demo")

        let store = TaskStore(files: files, reminders: Reminders(), defaults: defaults)
        store.open("demo")
        #expect(store.lists == [.inbox])
        #expect(store.selected == nil)
        #expect(store.visible.map(\.content) == ["Older task"])
        // No list made, nothing written beside the tasks.
        #expect(try files.loadProjects("demo") == nil)

        let errands = try #require(try await store.createProject("  Errands "))
        #expect(errands.name == "Errands")
        #expect(store.selected == errands.id)
        #expect(store.visible.isEmpty)
        #expect(try await store.createProject("  ") == nil)

        try await store.save(MailTask(content: "Post the letter", projectId: errands.id))
        #expect(store.visible.map(\.content) == ["Post the letter"])
        store.select(TaskProject.inbox.id)
        #expect(store.visible.map(\.content) == ["Older task"])
        store.select(nil)
        #expect(store.visible.count == 2)
        store.select("not a list")
        #expect(store.selected == nil)

        try await store.renameProject(errands.id, to: "Town")
        try await store.renameProject(TaskProject.inbox.id, to: "Renamed inbox")
        #expect(store.lists.map(\.name) == ["Inbox", "Town"])
        store.select(errands.id)

        // Opened again: the lists, the tasks on them and the list picked.
        let reopened = TaskStore(files: files, reminders: Reminders(), defaults: defaults)
        reopened.open("demo")
        #expect(reopened.projects == [TaskProject(id: errands.id, name: "Town")])
        #expect(reopened.selected == errands.id)
        #expect(reopened.visible.map(\.content) == ["Post the letter"])
        #expect(try files.load("demo")?.count == 2)

        // Another account has its own lists and its own pick.
        reopened.open("other")
        #expect(reopened.projects.isEmpty)
        #expect(reopened.selected == nil)
        reopened.close()
        #expect(reopened.projects.isEmpty)
        #expect(reopened.selected == nil)
    }

    @Test func seedsTheDemosListsOnce() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders(), defaults: defaults())
        store.open("demo", seed: DemoTasks.seed(), seedProjects: DemoTasks.projects)
        #expect(store.lists.map(\.name) == ["Inbox", "Home", "Work"])
        #expect(!TaskProject.filter(store.tasks, project: DemoTasks.work.id).isEmpty)
        #expect(!TaskProject.filter(store.tasks, project: TaskProject.inbox.id).isEmpty)
        await store.settled()
        try await Task.sleep(for: .milliseconds(100))
        #expect(try files.loadProjects("demo") == DemoTasks.projects)
    }

    @Test func aListsFileItCantReadLeavesItAlone() async throws {
        let folder = folder()
        defer { try? FileManager.default.removeItem(at: folder) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let broken = Data("not json".utf8)
        try broken.write(to: folder.appending(path: "demo.projects.json"))
        let files = TaskFiles(folder: folder)
        let store = TaskStore(files: files, reminders: Reminders(), defaults: defaults())
        store.open("demo")
        #expect(store.failure != nil)
        await #expect(throws: (any Error).self) { try await store.createProject("Errands") }
        #expect(try Data(contentsOf: folder.appending(path: "demo.projects.json")) == broken)
    }
}

/** No notification center: the lists never schedule anything. */
private nonisolated struct Reminders: TaskReminding {
    func status() async -> UNAuthorizationStatus { .denied }
    func ask() async {}
    func pending() async -> [String] { [] }
    func delivered() async -> [String] { [] }
    func remove(pending: [String], delivered: [String]) async {}
    func add(_ task: MailTask, scope: String) async {}
}
