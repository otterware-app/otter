import SwiftUI

struct Theme: Identifiable, Decodable {
    let id: String
    let label: String
    let exact: Bool
    /** The theme's own action color stays; otherwise the mailbox's color stands in. */
    let monochrome: Bool
    let light: [String: String]
    let dark: [String: String]
    var modes: [ColorScheme] = [.light, .dark]

    private enum CodingKeys: String, CodingKey { case id, label, exact, monochrome, light, dark }

    static let all: [Theme] = {
        guard
            let url = Bundle.main.url(forResource: "Themes", withExtension: "json"),
            let data = try? Data(contentsOf: url),
            let themes = try? JSONDecoder().decode([Theme].self, from: data)
        else { return [] }
        return themes
    }()

    static func named(_ id: String) -> Theme? { all.first { $0.id == id } }

    func palette(_ scheme: ColorScheme) -> Palette {
        Palette(roles: scheme == .dark ? dark : light, exact: exact, monochrome: monochrome)
    }
}

struct Palette {
    let canvas: Color
    let chrome: Color
    let sidebar: Color
    let sidebarText: Color
    let sidebarMuted: Color
    let sidebarSelected: Color
    let surface: Color
    let raised: Color
    let card: Color
    let text: Color
    /** The text's channels, for mixing a color toward it (`EventStyle.legible`). */
    let textRGB: RGB
    let muted: Color
    let border: Color
    let input: Color
    let focus: Color
    let action: Color
    let actionText: Color
    let error: Color
    let warning: Color
    let monochrome: Bool

    init(roles: [String: String], exact: Bool, monochrome: Bool) {
        let role = { (name: String) in RGB(css: roles[name] ?? "#808080") }
        let soften = { (name: String, over: String, keep: Double) -> Color in
            exact ? role(name).color : role(name).mixed(toward: role(over), keep: keep).color
        }
        canvas = role("canvas").color
        chrome = role("chrome").color
        sidebar = role("sidebar").color
        sidebarText = role("sidebarForeground").color
        sidebarMuted = role("sidebarMutedForeground").color
        sidebarSelected = soften("sidebarRowActive", "sidebar", 0.5)
        surface = soften("surface", "canvas", 0.6)
        raised = soften("surfaceRaised", "canvas", 0.45)
        textRGB = role("text")
        text = textRGB.color
        card = textRGB.mixed(toward: role("canvas"), keep: 0.07).color
        muted = role("mutedForeground").color
        border = soften("border", "canvas", 0.35)
        input = soften("input", "canvas", 0.5)
        focus = role("focus").color
        action = role("messageAction").color
        actionText = role("messageActionForeground").color
        error = role("error").color
        warning = role("warning").color
        self.monochrome = monochrome
    }

    func action(for mailbox: Mailbox?) -> Color {
        guard !monochrome, let mailbox else { return action }
        return Color(hex: mailbox.color)
    }
}

extension EnvironmentValues {
    @Entry var palette = Theme.named(Preferences.initialTheme)?.palette(.dark)
        ?? Palette(roles: [:], exact: true, monochrome: true)
}

extension Color {
    init(hex: String) { self = RGB(css: hex).color }
}

struct RGB {
    var r, g, b: Double

    init(css: String) {
        if css.hasPrefix("oklch(") {
            // L C H, then maybe "/ alpha" (which the phone doesn't paint).
            let parts = css.dropFirst(6).dropLast().split(separator: " ").prefix(3).compactMap { Double($0) }
            let (l, c, h) = parts.count == 3 ? (parts[0], parts[1], parts[2] * .pi / 180) : (0.5, 0, 0)
            self.init(oklab: (l, c * cos(h), c * sin(h)))
        } else {
            self.init(hex: css)
        }
    }

    private init(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt64(digits.prefix(6), radix: 16) ?? 0x808080
        r = Double((value >> 16) & 0xff) / 255
        g = Double((value >> 8) & 0xff) / 255
        b = Double(value & 0xff) / 255
    }

    init(r: Double, g: Double, b: Double) { (self.r, self.g, self.b) = (r, g, b) }

    var color: Color { Color(red: r, green: g, blue: b) }

    func mixed(toward other: RGB, keep: Double) -> RGB {
        let (a, o) = (oklab, other.oklab)
        return RGB(oklab: (
            a.0 * keep + o.0 * (1 - keep),
            a.1 * keep + o.1 * (1 - keep),
            a.2 * keep + o.2 * (1 - keep)
        ))
    }

    private static func linear(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
    private static func gamma(_ c: Double) -> Double {
        let c = min(max(c, 0), 1)
        return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1 / 2.4) - 0.055
    }

    private var oklab: (Double, Double, Double) {
        let (r, g, b) = (Self.linear(r), Self.linear(g), Self.linear(b))
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return (
            0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
        )
    }

    private init(oklab: (Double, Double, Double)) {
        let l = pow(oklab.0 + 0.3963377774 * oklab.1 + 0.2158037573 * oklab.2, 3)
        let m = pow(oklab.0 - 0.1055613458 * oklab.1 - 0.0638541728 * oklab.2, 3)
        let s = pow(oklab.0 - 0.0894841775 * oklab.1 - 1.2914855480 * oklab.2, 3)
        self.init(
            r: Self.gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            g: Self.gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            b: Self.gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
        )
    }
}
