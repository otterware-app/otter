import SwiftUI
import UIKit

struct Palette {
    let canvas: Color
    let surface: Color
    let raised: Color
    let card: Color
    let text: Color
    let muted: Color
    let tertiary: Color
    let border: Color
    let input: Color
    let focus: Color
    let action: Color
    let actionText: Color
    let error: Color
    let warning: Color

    init(_ scheme: ColorScheme) {
        let dark = scheme == .dark
        canvas = dark ? .black : .white
        surface = canvas
        raised = Color(hex: dark ? "#2c2c2e" : "#e5e5ea")
        card = Color(hex: dark ? "#1c1c1e" : "#ededed")
        text = dark ? .white : .black
        muted = Color(hex: dark ? "#b0b0b5" : "#5c5c63")
        tertiary = Color(hex: dark ? "#9d9da3" : "#64646b")
        border = Color(hex: dark ? "#38383a" : "#e5e5ea")
        input = raised
        focus = Color(hex: dark ? "#5c9eff" : "#105fd9")
        action = focus
        actionText = dark ? .black : .white
        error = Color(hex: dark ? "#ff6961" : "#ae0012")
        warning = Color(hex: dark ? "#ff9f0a" : "#924900")
    }
}

extension EnvironmentValues {
    @Entry var palette = Palette(.light)
}

extension Color {
    var contrastingText: Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, alpha: CGFloat = 0
        UIColor(self).getRed(&r, green: &g, blue: &b, alpha: &alpha)
        func linear(_ component: CGFloat) -> Double {
            let value = Double(component)
            return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        let luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
        return luminance > 0.179 ? .black : .white
    }

    init(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt64(digits.prefix(6), radix: 16) ?? 0x808080
        self.init(red: Double((value >> 16) & 0xff) / 255,
                  green: Double((value >> 8) & 0xff) / 255,
                  blue: Double(value & 0xff) / 255)
    }
}

/**
 * The canvas behind a tab screen's top and bottom controls, opaque out to their middle and fading
 * over 10pt, past which the system's soft edge goes on. Both edges alike, so the screen reads as one
 * frame; and what pins to a list's edge (its day headers) draws over the soft edge, so mustn't
 * show through the controls.
 */
struct BarBacking: View {
    @Environment(\.palette) private var palette
    let edge: VerticalEdge

    var body: some View {
        let fade = LinearGradient(colors: [palette.canvas, palette.canvas.opacity(0)],
                                  startPoint: edge == .top ? .top : .bottom, endPoint: edge == .top ? .bottom : .top)
        VStack(spacing: 0) {
            if edge == .bottom { fade.frame(height: 10) }
            palette.canvas
            if edge == .top { fade.frame(height: 10) }
        }
        .ignoresSafeArea(edges: edge == .top ? .top : .bottom)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

extension View {
    /** Under the navigation bar, the backing the bottom bar has (`BarBacking`), so the title sits wholly on the canvas. */
    func topBarBacking() -> some View {
        overlay(alignment: .top) { BarBacking(edge: .top).frame(height: 10).offset(y: -10) }
    }
}
