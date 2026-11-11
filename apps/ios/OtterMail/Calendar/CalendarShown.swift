import Foundation
import Observation

/**
 * Calendars shown or hidden by hand, by `calendarKey`, as
 * apps/web/src/main/calendar/calendar-store.ts keeps them: on this device only
 * (`calendar:shown`, its localStorage key), and the rest follow Google's own
 * choice (`hiddenByDefault`: a calendar not selected there).
 */
@Observable
final class CalendarShown {
    nonisolated static let key = "calendar:shown"

    private(set) var shown: [String: Bool]
    /** One mailbox's calendars only, picked in the bar's ⌃⌄; nil for all of them. Not kept, as the mail's place isn't. */
    var account: String?
    @ObservationIgnored private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        shown = Self.read(defaults.string(forKey: Self.key))
    }

    nonisolated static func read(_ json: String?) -> [String: Bool] {
        guard let data = json?.data(using: .utf8),
              let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return [:] }
        // A primary calendar was kept under its address (`me|me`) before it was `primary`, as core lists it.
        let flags: [String: Bool] = record.compactMapValues { $0 as? Bool }
        return flags.reduce(into: [String: Bool]()) { shown, entry in
            let parts = entry.key.split(separator: "|", maxSplits: 1).map(String.init)
            let key = parts.count == 2 && parts[0].lowercased() == parts[1].lowercased()
                ? EventStyle.key(mailbox: parts[0], calendar: "primary") : entry.key
            if shown[key] == nil || key == entry.key { shown[key] = entry.value }
        }
    }

    nonisolated static func isShown(_ shown: [String: Bool], key: String, hiddenByDefault: Bool) -> Bool {
        shown[key] ?? !hiddenByDefault
    }

    nonisolated static func isShown(_ shown: [String: Bool], _ calendar: EventCalendar) -> Bool {
        isShown(shown, key: calendar.key, hiddenByDefault: !calendar.shown)
    }

    nonisolated static func visible(_ events: [CalendarEvent], shown: [String: Bool]) -> [CalendarEvent] {
        events.filter { isShown(shown, $0.calendar) }
    }

    /** What the pages draw: the calendars shown, and of one mailbox only while `account` picks one. */
    nonisolated static func scoped(_ shown: [String: Bool], account: String?, calendars: [EventCalendar]) -> [String: Bool] {
        guard let account else { return shown }
        var scoped = shown
        for calendar in calendars where calendar.account.lowercased() != account.lowercased() { scoped[calendar.key] = false }
        return scoped
    }

    /** calendar-store.ts's showOnly: this calendar on, every other one listed off. */
    nonisolated static func showingOnly(_ shown: [String: Bool], key: String, keys: [String]) -> [String: Bool] {
        shown.merging(keys.map { ($0, $0 == key) }) { _, only in only }
    }

    /** All calendars: every listed one on, Google's unchecked ones included; switching one off is the exception. */
    nonisolated static func allShown(_ shown: [String: Bool], keys: [String]) -> [String: Bool] {
        shown.merging(keys.map { ($0, true) }) { _, on in on }
    }

    func showAll(_ calendars: [EventCalendar]) {
        account = nil
        write(Self.allShown(shown, keys: calendars.map(\.key)))
    }

    func scoped(_ calendars: [EventCalendar]) -> [String: Bool] {
        Self.scoped(shown, account: account, calendars: calendars)
    }

    func showOnly(_ calendar: EventCalendar, among calendars: [EventCalendar]) {
        write(Self.showingOnly(shown, key: calendar.key, keys: calendars.map(\.key)))
        if let account, account.lowercased() != calendar.account.lowercased() { self.account = nil }
    }

    func isShown(key: String, hiddenByDefault: Bool) -> Bool {
        Self.isShown(shown, key: key, hiddenByDefault: hiddenByDefault)
    }

    func isShown(_ calendar: EventCalendar) -> Bool {
        Self.isShown(shown, calendar)
    }

    func setShown(key: String, show: Bool) {
        var next = shown
        next[key] = show
        write(next)
    }

    private func write(_ next: [String: Bool]) {
        shown = next
        guard let data = try? JSONSerialization.data(withJSONObject: shown, options: [.sortedKeys]) else { return }
        defaults.set(String(decoding: data, as: UTF8.self), forKey: Self.key)
    }

    func setShown(_ calendar: EventCalendar, show: Bool) {
        setShown(key: calendar.key, show: show)
    }
}
