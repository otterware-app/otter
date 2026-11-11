import SwiftUI

/**
 * Themes of your own, made on the Mac or the web (the theme editor ported from
 * T3 Code, apps/web's theme/themePalette.ts) and synced as the account's
 * "otter:themes:v1" ui preference: a list of {id, label, appearance, colors,
 * variants?}, every role an "oklch(…)" color. The phone wears them and lets you
 * pick them, but doesn't edit them. A theme may have one appearance only; the
 * other is the stock palette's, as on the web.
 */
enum CustomThemes {
    private struct Stored: Decodable {
        let id: String
        let label: String
        let appearance: String
        let colors: [String: String]
        let variants: [String: [String: String]]?
    }

    /** The stored list as themes; entries that don't hold up are dropped. */
    static func themes(_ raw: String?) -> [Theme] {
        struct Entry: Decodable {
            let theme: Stored?
            init(from decoder: Decoder) throws { theme = try? Stored(from: decoder) }
        }
        guard let data = raw?.data(using: .utf8), let entries = try? JSONDecoder().decode([Entry].self, from: data)
        else { return [] }
        let stock = Theme.named("otter")
        var seen = Set<String>()
        return entries.compactMap(\.theme).compactMap { stored in
            guard stored.appearance == "light" || stored.appearance == "dark", !stored.label.isEmpty,
                  seen.insert(stored.id).inserted, Theme.named(stored.id) == nil
            else { return nil }
            let palette = { (mode: String) in
                mode == stored.appearance ? stored.colors : stored.variants?[mode]
            }
            let (light, dark) = (palette("light"), palette("dark"))
            return Theme(
                id: stored.id, label: stored.label, exact: true, monochrome: true,
                light: light ?? stock?.light ?? [:], dark: dark ?? stock?.dark ?? [:],
                modes: [light.map { _ in ColorScheme.light }, dark.map { _ in .dark }].compactMap { $0 }
            )
        }
    }
}
