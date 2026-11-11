import Foundation
import Testing
@testable import Otter_Mail

/** What the bar's ⌃⌄ panels scope: the calendar to one mailbox or one calendar (calendar-store.ts's showOnly). */
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
}
