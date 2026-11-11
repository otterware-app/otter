import Foundation

/**
 * The calendar's choices, read as apps/web/src/main/calendar/preferences.ts
 * reads them, under the keys synced-preferences.ts syncs: the Mac and web apps
 * make them in Settings › Calendar and the Otter account carries them here.
 * The phone reads them; it doesn't write them.
 */
nonisolated struct CalendarPreferences: Equatable {
    enum WeekStart: String { case auto, sunday, monday, saturday }
    enum TimeFormat: String {
        case auto
        case twelve = "12"
        case twentyFour = "24"
    }

    var weekStart: WeekStart = .auto
    var showWeekends = true
    var showDeclined = true
    var timeFormat: TimeFormat = .auto
    /** A calendar's chosen color by `calendarKey` (api.ts: `<mailbox>|<calendar>`). */
    var colors: [String: String] = [:]
    /** Where new events go, by `calendarKey`, picked in the Mac and web apps' calendar list; empty for the primary one. */
    var defaultCalendar = ""

    static let keys = [
        "calendar:week-start",
        "calendar:show-weekends",
        "calendar:show-declined",
        "calendar:time-format",
        "calendar:colors",
        "calendar:default-calendar",
    ]

    init() {}

    /** As `read()` does there: anything unknown falls back, and a switch is off only when it says "false". */
    init(ui: [String: String]) {
        weekStart = ui["calendar:week-start"].flatMap(WeekStart.init) ?? .auto
        timeFormat = ui["calendar:time-format"].flatMap(TimeFormat.init) ?? .auto
        showWeekends = ui["calendar:show-weekends"] != "false"
        showDeclined = ui["calendar:show-declined"] != "false"
        defaultCalendar = ui["calendar:default-calendar"] ?? ""
        if let data = ui["calendar:colors"]?.data(using: .utf8),
           let record = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            colors = Self.migratingPrimary(record.compactMapValues { $0 as? String })
        }
    }

    /**
     * The primary calendar was keyed by its id, the mailbox's address (`<mailbox>|<mailbox>`),
     * before it became `primary`: its color moves there, unless one is chosen there already.
     */
    private static func migratingPrimary(_ colors: [String: String]) -> [String: String] {
        var migrated = colors
        for (key, hex) in colors {
            let parts = key.split(separator: "|", omittingEmptySubsequences: false)
            guard parts.count == 2, parts[0] == parts[1], parts[0].contains("@") else { continue }
            migrated[key] = nil
            let primary = "\(parts[0])|primary"
            if colors[primary] == nil { migrated[primary] = hex }
        }
        return migrated
    }
}
