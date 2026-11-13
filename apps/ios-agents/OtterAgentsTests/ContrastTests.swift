import SwiftUI
import Testing
import UIKit
@testable import Otter_Agents

@MainActor
struct ContrastTests {
    @Test func avatarInitialsRemainLegibleAcrossHues() {
        for hue in stride(from: 0.0, to: 1.0, by: 0.05) {
            let color = Color(hue: hue, saturation: 0.614, brightness: 0.75)
            #expect(contrast(color.contrastingText, color, .light) >= 4.5)
        }
    }

    @Test func contentRemainsLegibleOnEverySurface() {
        for scheme in [ColorScheme.light, .dark] {
            let palette = Palette(scheme)
            let surfaces = [palette.canvas, palette.card, palette.raised, palette.incoming(scheme), palette.outgoing(scheme)]
            for surface in surfaces {
                for foreground in [palette.text, palette.muted, palette.tertiary, palette.focus, palette.error, palette.warning,
                                   Status.working, Status.done, Status.input] {
                    #expect(contrast(foreground, surface, scheme) >= 4.5, "Low contrast in \(scheme): \(foreground) on \(surface)")
                }
            }
            #expect(contrast(palette.actionText, palette.action, scheme) >= 4.5)
        }
    }

    private func contrast(_ foreground: Color, _ background: Color, _ scheme: ColorScheme) -> Double {
        let trait = UITraitCollection(userInterfaceStyle: scheme == .dark ? .dark : .light)
        func luminance(_ color: Color) -> Double {
            var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, alpha: CGFloat = 0
            UIColor(color).resolvedColor(with: trait).getRed(&r, green: &g, blue: &b, alpha: &alpha)
            func linear(_ value: CGFloat) -> Double {
                let value = Double(value)
                return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
            }
            return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
        }
        let values = [luminance(foreground), luminance(background)].sorted()
        return (values[1] + 0.05) / (values[0] + 0.05)
    }
}
