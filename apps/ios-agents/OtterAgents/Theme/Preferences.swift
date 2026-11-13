import Foundation
import Observation
import SwiftUI

/**
 * The look, under the same keys as the other apps (apps/web's synced-preferences.ts), so it
 * follows the Otter account: this app reads and writes the color scheme in the `ui` section and
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

    private let defaults: UserDefaults
    @ObservationIgnored var onChange: () -> Void = {}
    @ObservationIgnored private var applying = false

    var scheme: Scheme { didSet { ui("otter:theme-source", scheme.rawValue) } }

    private func ui(_ key: String, _ value: String) {
        defaults.set(value, forKey: key)
        if !applying { onChange() }
    }

    var uiSection: [String: String] {
        ["otter:theme-source": scheme.rawValue]
    }

    func apply(ui: [String: Any]) {
        applying = true
        defer { applying = false }
        if let value = (ui["otter:theme-source"] as? String).flatMap(Scheme.init), value != scheme { scheme = value }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        scheme = defaults.string(forKey: "otter:theme-source").flatMap(Scheme.init) ?? .system
    }
}

struct Themed<Content: View>: View {
    @Environment(Preferences.self) private var preferences
    @ViewBuilder var content: Content

    var body: some View {
        ThemedContent(content: content)
            .preferredColorScheme(preferences.scheme.colorScheme)
    }

    private struct ThemedContent: View {
        @Environment(\.colorScheme) private var colorScheme
        let content: Content

        var body: some View {
            let palette = Palette(colorScheme)
            content
                .environment(\.palette, palette)
                .font(.inter(.body))
                .tint(palette.action)
                .toggleStyle(SwitchToggleStyle(tint: palette.focus))
        }
    }
}
