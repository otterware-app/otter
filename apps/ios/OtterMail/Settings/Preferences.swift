import Foundation
import Observation

/**
 * The user's choices, under the same keys and values as the other apps
 * (apps/web's synced-preferences.ts for `ui`, core's settings-store.ts for
 * `settings`), so they can follow the Otter account to every device.
 */
@Observable
final class Preferences {
    enum Scheme: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    enum Advance: String, CaseIterable, Identifiable {
        case next, previous, none
        var id: String { rawValue }
        var title: String {
            switch self {
            case .next: "Next message"
            case .previous: "Previous message"
            case .none: "Back to the list"
            }
        }
    }

    enum Notifications: String, CaseIterable, Identifiable {
        case off, inbox, all
        var id: String { rawValue }
        var title: String {
            switch self {
            case .off: "Off"
            case .inbox: "Inbox only"
            case .all: "All new mail"
            }
        }
    }

    struct Arrangement: Codable, Equatable {
        var order: [String] = []
        var off: [String] = []

        init() {}

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            order = try container.decodeIfPresent([String].self, forKey: .order) ?? []
            off = try container.decodeIfPresent([String].self, forKey: .off) ?? []
        }
    }

    static let initialTheme = "codex"

    private let defaults: UserDefaults
    @ObservationIgnored var onChange: (String) -> Void = { _ in }
    @ObservationIgnored private var applying = false

    var scheme: Scheme { didSet { ui("otter:theme-source", scheme.rawValue) } }
    var lightTheme: String { didSet { ui("otter:theme:light", lightTheme) } }
    var darkTheme: String { didSet { ui("otter:theme:dark", darkTheme) } }
    var groupMessagesByDay: Bool { didSet { ui("otter:group-messages-by-day", String(groupMessagesByDay)) } }
    /** The list's rows edge to edge with a hairline between them, instead of cards (the desktop's). */
    var fullWidthRows: Bool { didSet { ui("otter:full-width-rows", String(fullWidthRows)) } }
    /** Messages' content edge to edge, without the reader's side inset (the iPhone's own). */
    var fullWidthMessages: Bool { didSet { ui("otter:full-width-messages", String(fullWidthMessages)) } }
    var advance: Advance { didSet { ui("gmail:advance-direction", advance.rawValue) } }
    var arrangement: Arrangement {
        didSet {
            guard arrangement != oldValue else { return }
            ui("mail:mailboxes", Self.json(arrangement))
        }
    }
    /** Mailboxes (addresses, lower-cased) whose list leaves out their alias mailboxes' mail. */
    var aliasMailApart: [String] {
        didSet {
            guard aliasMailApart != oldValue else { return }
            ui("mail:alias-mail-apart", Self.json(aliasMailApart))
        }
    }
    /** Themes made on the Mac or the web (`CustomThemes`): worn and picked here, never written (so not in `uiSection`). */
    private(set) var customThemes: [Theme]
    /** Settings › Calendar, made on the Mac or the web and followed here; only a calendar's color is written (`setCalendarColor`). */
    private(set) var calendar: CalendarPreferences
    var notifications: Notifications { didSet { setting("notificationsMode", notifications.rawValue) } }
    /** BCP-47 codes, first = where translations go; empty = the system's languages. */
    var readLanguages: [String] { didSet { setting("readLanguages", readLanguages) } }
    var autoTranslate: Bool { didSet { setting("autoTranslate", autoTranslate) } }

    private func ui(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
        if !applying { onChange("ui") }
    }

    /** calendar-sidebar.tsx's color pick: a color by calendarKey, or nil for its own again, under the synced `calendar:colors`. */
    func setCalendarColor(_ hex: String?, for key: String) {
        var colors = calendar.colors
        colors[key] = hex
        guard colors != calendar.colors,
              let data = try? JSONSerialization.data(withJSONObject: colors, options: [.sortedKeys]) else { return }
        calendar.colors = colors
        ui("calendar:colors", String(decoding: data, as: UTF8.self))
    }

    private func setting(_ key: String, _ value: Any) {
        defaults.set(value, forKey: "settings.\(key)")
        if !applying { onChange("settings") }
    }

    private static func calendarSection(_ defaults: UserDefaults) -> CalendarPreferences {
        CalendarPreferences(ui: Dictionary(uniqueKeysWithValues: CalendarPreferences.keys.compactMap { key in
            defaults.string(forKey: key).map { (key, $0) }
        }))
    }

    private static func json(_ value: some Encodable) -> String {
        (try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    var uiSection: [String: String] {
        var section = [
            "otter:theme-source": scheme.rawValue,
            "otter:theme:light": lightTheme,
            "otter:theme:dark": darkTheme,
            "otter:group-messages-by-day": String(groupMessagesByDay),
            "otter:full-width-rows": String(fullWidthRows),
            "otter:full-width-messages": String(fullWidthMessages),
            "gmail:advance-direction": advance.rawValue,
            "mail:mailboxes": Self.json(arrangement),
            "mail:alias-mail-apart": Self.json(aliasMailApart),
        ]
        // Only once there is one here (pulled, or picked): an empty record would write over the other devices' colors.
        if let colors = defaults.string(forKey: "calendar:colors") { section["calendar:colors"] = colors }
        return section
    }

    var settingsSection: [String: Any] {
        ["notificationsMode": notifications.rawValue, "readLanguages": readLanguages, "autoTranslate": autoTranslate]
    }

    /** Takes the account's choices (from another device), without echoing them back. */
    func apply(ui: [String: Any], settings: [String: Any]) {
        applying = true
        defer { applying = false }
        // Before the theme ids, which may name one of them.
        if let raw = ui["otter:themes:v1"] as? String, raw != defaults.string(forKey: "otter:themes:v1") {
            defaults.set(raw, forKey: "otter:themes:v1")
            customThemes = CustomThemes.themes(raw)
        }
        if let value = (ui["otter:theme-source"] as? String).flatMap(Scheme.init), value != scheme { scheme = value }
        if let value = ui["otter:theme:light"] as? String, value != lightTheme { lightTheme = value }
        if let value = ui["otter:theme:dark"] as? String, value != darkTheme { darkTheme = value }
        if let value = (ui["otter:group-messages-by-day"] as? String).flatMap(Bool.init), value != groupMessagesByDay { groupMessagesByDay = value }
        if let value = (ui["otter:full-width-rows"] as? String).flatMap(Bool.init), value != fullWidthRows { fullWidthRows = value }
        if let value = (ui["otter:full-width-messages"] as? String).flatMap(Bool.init), value != fullWidthMessages {
            fullWidthMessages = value
        }
        if let value = (ui["gmail:advance-direction"] as? String).flatMap(Advance.init), value != advance { advance = value }
        if let value = (ui["mail:mailboxes"] as? String)?.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(Arrangement.self, from: value), decoded != arrangement {
            arrangement = decoded
        }
        if let value = (ui["mail:alias-mail-apart"] as? String)?.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([String].self, from: value), decoded != aliasMailApart {
            aliasMailApart = decoded
        }
        for key in CalendarPreferences.keys {
            if let value = ui[key] as? String, value != defaults.string(forKey: key) {
                defaults.set(value, forKey: key)
            }
        }
        let chosen = Self.calendarSection(defaults)
        if chosen != calendar { calendar = chosen }
        if let value = (settings["notificationsMode"] as? String).flatMap(Notifications.init), value != notifications {
            notifications = value
        }
        if let value = settings["readLanguages"] as? [String], value != readLanguages { readLanguages = value }
        if let value = settings["autoTranslate"] as? Bool, value != autoTranslate { autoTranslate = value }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        scheme = defaults.string(forKey: "otter:theme-source").flatMap(Scheme.init) ?? .system
        lightTheme = defaults.string(forKey: "otter:theme:light") ?? Self.initialTheme
        darkTheme = defaults.string(forKey: "otter:theme:dark") ?? Self.initialTheme
        groupMessagesByDay = defaults.string(forKey: "otter:group-messages-by-day").flatMap(Bool.init) ?? true
        fullWidthRows = defaults.string(forKey: "otter:full-width-rows").flatMap(Bool.init) ?? false
        fullWidthMessages = defaults.string(forKey: "otter:full-width-messages").flatMap(Bool.init) ?? false
        advance = defaults.string(forKey: "gmail:advance-direction").flatMap(Advance.init) ?? .next
        arrangement = defaults.string(forKey: "mail:mailboxes")?.data(using: .utf8)
            .flatMap { try? JSONDecoder().decode(Arrangement.self, from: $0) } ?? Arrangement()
        aliasMailApart = defaults.string(forKey: "mail:alias-mail-apart")?.data(using: .utf8)
            .flatMap { try? JSONDecoder().decode([String].self, from: $0) } ?? []
        customThemes = CustomThemes.themes(defaults.string(forKey: "otter:themes:v1"))
        calendar = Self.calendarSection(defaults)
        notifications = defaults.string(forKey: "settings.notificationsMode").flatMap(Notifications.init) ?? .inbox
        readLanguages = defaults.stringArray(forKey: "settings.readLanguages") ?? []
        autoTranslate = defaults.bool(forKey: "settings.autoTranslate")
    }

    func theme(_ id: String) -> Theme? { Theme.named(id) ?? customThemes.first { $0.id == id } }

    var themes: [Theme] { Theme.all + customThemes }

    var effectiveReadLanguages: [String] {
        readLanguages.isEmpty
            ? Locale.preferredLanguages.map { Locale.Language(identifier: $0).minimalIdentifier }
            : readLanguages
    }
}
