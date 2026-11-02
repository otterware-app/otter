import SwiftUI
import UIKit

/**
 * Inter, the Mac and web apps' face (apps/web/src/styles.css), so the iPhone
 * reads as the same app. Each text style keeps its iOS size and scales with
 * Dynamic Type; headline keeps its semibold. Code stays in SF Mono, as there.
 * The font is Resources/Fonts/InterVariable.ttf (SIL OFL, Inter-LICENSE.txt).
 */
extension Font {
    static let interFamily = "Inter Variable"

    static func inter(_ style: TextStyle) -> Font {
        let font = Font.custom(interFamily, size: UIFont.basePointSize(style.uiKit), relativeTo: style)
        return style == .headline ? font.weight(.semibold) : font
    }

    static func inter(size: CGFloat, weight: Weight = .regular) -> Font {
        .custom(interFamily, fixedSize: size).weight(weight)
    }
}

extension UIFont {
    static func inter(_ style: TextStyle, weight: Weight = .regular) -> UIFont {
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: Font.interFamily,
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFontMetrics(forTextStyle: style)
            .scaledFont(for: UIFont(descriptor: descriptor, size: basePointSize(style)))
    }

    /** A text style's size at the default text size, before Dynamic Type scales it. */
    fileprivate static func basePointSize(_ style: TextStyle) -> CGFloat {
        preferredFont(forTextStyle: style, compatibleWith: UITraitCollection(preferredContentSizeCategory: .large)).pointSize
    }

    static func useInterInBars() {
        let navigation = UINavigationBar.appearance()
        navigation.titleTextAttributes = [.font: inter(.headline, weight: .semibold)]
        navigation.largeTitleTextAttributes = [.font: inter(.largeTitle, weight: .bold)]
        UITabBarItem.appearance().setTitleTextAttributes([.font: inter(.caption2, weight: .medium)], for: .normal)
    }
}

private extension Font.TextStyle {
    var uiKit: UIFont.TextStyle {
        switch self {
        case .largeTitle: .largeTitle
        case .title: .title1
        case .title2: .title2
        case .title3: .title3
        case .headline: .headline
        case .subheadline: .subheadline
        case .callout: .callout
        case .footnote: .footnote
        case .caption: .caption1
        case .caption2: .caption2
        default: .body
        }
    }
}

extension View {
    /** A Form section's heading in Inter, as bold as iOS's own (the app's Inter default would flatten it). */
    func sectionHeader() -> some View { font(.inter(.headline)) }

    func sectionFooter() -> some View { font(.inter(.footnote)) }
}
