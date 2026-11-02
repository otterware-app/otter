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
    /** Messages' content edge to edge, without the reader's side inset (the iPhone's own). */
    var fullWidthMessages: Bool { didSet { ui("otter:full-width-messages", String(fullWidthMessages)) } }
    var advance: Advance { didSet { ui("gmail:advance-direction", advance.rawValue) } }
    var arrangement: Arrangement {
        didSet {
            guard arrangement != oldValue else { return }
            ui("mail:mailboxes", Self.json(arrangement))
        }
    }
    /** Themes made on the Mac or the web (`CustomThemes`): worn and picked here, never written (so not in `uiSection`). */
    private(set) var customThemes: [Theme]
    var notifications: Notifications { didSet { setting("notificationsMode", notifications.rawValue) } }
    /** BCP-47 codes, first = where translations go; empty = the system's languages. */
    var readLanguages: [String] { didSet { setting("readLanguages", readLanguages) } }
    var autoTranslate: Bool { didSet { setting("autoTranslate", autoTranslate) } }

    private func ui(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
        if !applying { onChange("ui") }
    }

    private func setting(_ key: String, _ value: Any) {
        defaults.set(value, forKey: "settings.\(key)")
        if !applying { onChange("settings") }
    }

    private static func json(_ arrangement: Arrangement) -> String {
        (try? JSONEncoder().encode(arrangement)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    }

    var uiSection: [String: String] {
        [
            "otter:theme-source": scheme.rawValue,
            "otter:theme:light": lightTheme,
            "otter:theme:dark": darkTheme,
            "otter:group-messages-by-day": String(groupMessagesByDay),
            "otter:full-width-messages": String(fullWidthMessages),
            "gmail:advance-direction": advance.rawValue,
            "mail:mailboxes": Self.json(arrangement),
        ]
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
        if let value = (ui["otter:full-width-messages"] as? String).flatMap(Bool.init), value != fullWidthMessages {
            fullWidthMessages = value
        }
        if let value = (ui["gmail:advance-direction"] as? String).flatMap(Advance.init), value != advance { advance = value }
        if let value = (ui["mail:mailboxes"] as? String)?.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(Arrangement.self, from: value), decoded != arrangement {
            arrangement = decoded
        }
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
        fullWidthMessages = defaults.string(forKey: "otter:full-width-messages").flatMap(Bool.init) ?? false
        advance = defaults.string(forKey: "gmail:advance-direction").flatMap(Advance.init) ?? .next
        arrangement = defaults.string(forKey: "mail:mailboxes")?.data(using: .utf8)
            .flatMap { try? JSONDecoder().decode(Arrangement.self, from: $0) } ?? Arrangement()
        customThemes = CustomThemes.themes(defaults.string(forKey: "otter:themes:v1"))
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
