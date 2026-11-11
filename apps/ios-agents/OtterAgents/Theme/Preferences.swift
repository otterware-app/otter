import Foundation
import Observation
import SwiftUI

/**
 * The look, under the same keys as the other apps (apps/web's synced-preferences.ts), so it
 * follows the Otter account: this app reads and writes the theme choice in the `ui` section and
 * leaves the rest of it as it found it.
 */
@Observable
final class Preferences {
    enum Scheme: String, CaseIterable, Identifiable {
        case system, light, dark
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
        var colorScheme: ColorScheme? {
            switch self {
            case .system: nil
            case .light: .light
            case .dark: .dark
            }
        }
    }

    static let initialTheme = "otter"

    private let defaults: UserDefaults
    @ObservationIgnored var onChange: () -> Void = {}
    @ObservationIgnored private var applying = false

    var scheme: Scheme { didSet { ui("otter:theme-source", scheme.rawValue) } }
    var lightTheme: String { didSet { ui("otter:theme:light", lightTheme) } }
    var darkTheme: String { didSet { ui("otter:theme:dark", darkTheme) } }
    private(set) var customThemes: [Theme]

    private func ui(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
        if !applying { onChange() }
    }

    var uiSection: [String: String] {
        ["otter:theme-source": scheme.rawValue, "otter:theme:light": lightTheme, "otter:theme:dark": darkTheme]
    }

    func apply(ui: [String: Any]) {
        applying = true
        defer { applying = false }
        if let raw = ui["otter:themes:v1"] as? String, raw != defaults.string(forKey: "otter:themes:v1") {
            defaults.set(raw, forKey: "otter:themes:v1")
            customThemes = CustomThemes.themes(raw)
        }
        if let value = (ui["otter:theme-source"] as? String).flatMap(Scheme.init), value != scheme { scheme = value }
        if let value = ui["otter:theme:light"] as? String, value != lightTheme { lightTheme = value }
        if let value = ui["otter:theme:dark"] as? String, value != darkTheme { darkTheme = value }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        scheme = defaults.string(forKey: "otter:theme-source").flatMap(Scheme.init) ?? .system
        lightTheme = defaults.string(forKey: "otter:theme:light") ?? Self.initialTheme
        darkTheme = defaults.string(forKey: "otter:theme:dark") ?? Self.initialTheme
        customThemes = CustomThemes.themes(defaults.string(forKey: "otter:themes:v1"))
    }

    func theme(_ id: String) -> Theme? { Theme.named(id) ?? customThemes.first { $0.id == id } }

    var themes: [Theme] { Theme.all + customThemes }
}

struct Themed<Content: View>: View {
    @Environment(Preferences.self) private var preferences
    @ViewBuilder var content: Content

    var body: some View {
        ThemedContent(content: content)
            .preferredColorScheme(preferences.scheme.colorScheme)
    }

    private struct ThemedContent: View {
        @Environment(Preferences.self) private var preferences
        @Environment(\.colorScheme) private var colorScheme
        let content: Content

        var body: some View {
            let id = colorScheme == .dark ? preferences.darkTheme : preferences.lightTheme
            let palette = (preferences.theme(id) ?? Theme.named(Preferences.initialTheme))?.palette(colorScheme)
            content
                .environment(\.palette, palette ?? EnvironmentValues().palette)
                .font(.inter(.body))
                .tint(palette?.action)
                .toggleStyle(SwitchToggleStyle(tint: palette?.focus ?? .blue))
        }
    }
}
