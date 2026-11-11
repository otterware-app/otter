import SwiftUI
import UIKit

/**
 * T3 Code's phone layout (apps/mobile in t3code) in Otter's own face and themes: its
 * type sizes and spacing, Inter for DM Sans, and the account's palette for its colors.
 */
extension Font {
    /** Inter at one of the layout's sizes, scaling with Dynamic Type. */
    static func ui(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        .custom(interFamily, size: size, relativeTo: .body).weight(weight)
    }

    static func mono(_ size: CGFloat, _ weight: Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }
}

extension UIFont {
    static func ui(_ size: CGFloat, _ weight: Weight = .regular) -> UIFont {
        let descriptor = UIFontDescriptor(fontAttributes: [
            .family: Font.interFamily,
            .traits: [UIFontDescriptor.TraitKey.weight: weight],
        ])
        return UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: descriptor, size: size))
    }
}

/** What a chat is doing, in the colors the list and the transcript share. */
enum Status {
    static func color(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    }

    static let working = color(0x0284c7, 0x38bdf8)
    static let done = color(0x047857, 0x6ee7b7)
    static let input = color(0x4f46e5, 0xa5b4fc)
}

extension UIColor {
    convenience init(rgb: UInt32) {
        self.init(red: CGFloat((rgb >> 16) & 0xff) / 255, green: CGFloat((rgb >> 8) & 0xff) / 255, blue: CGFloat(rgb & 0xff) / 255, alpha: 1)
    }
}

extension Palette {
    /** The hairline between rows. */
    var hairline: Color { border.opacity(0.7) }
    /** A third voice under the muted one: times and counts. */
    var tertiary: Color { muted.opacity(0.85) }
    var dangerFill: Color { error.opacity(0.14) }
}

/** An agent's picture: its own (an OpenClaw agent's picture or emoji), its maker's mark, or Otter's for the agent Otter runs. */
struct AgentAvatar: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store: ChatStore?
    let provider: String
    /** Which of OpenClaw's agents. */
    var agent: String?
    var size: CGFloat = 20

    private static let pictures = NSCache<NSString, UIImage>()

    private static func picture(_ url: String) -> UIImage? {
        if let cached = pictures.object(forKey: url as NSString) { return cached }
        guard url.hasPrefix("data:"), let comma = url.firstIndex(of: ","), let data = Data(base64Encoded: String(url[url.index(after: comma)...])),
              let image = UIImage(data: data) else { return nil }
        pictures.setObject(image, forKey: url as NSString)
        return image
    }

    var body: some View {
        let face = provider == "openclaw" ? agent.flatMap { store?.agents.openClawFaces[$0] } : nil
        if let avatar = face?.avatar, let image = Self.picture(avatar) {
            Image(uiImage: image).resizable().scaledToFill().frame(width: size, height: size).clipShape(.circle).accessibilityHidden(true)
        } else if let avatar = face?.avatar, let url = URL(string: avatar), url.scheme == "https" {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { mark }
                .frame(width: size, height: size).clipShape(.circle).accessibilityHidden(true)
        } else if let emoji = face?.emoji, !emoji.isEmpty {
            Text(emoji).font(.system(size: size * 0.82)).frame(width: size, height: size).accessibilityHidden(true)
        } else {
            mark
        }
    }

    private var mark: some View {
        Group {
            switch provider {
            case "hermes": Image("AgentHermes").resizable().clipShape(.rect(cornerRadius: size * 0.25))
            case "openclaw": Image("AgentOpenClaw").resizable().padding(size * 0.06)
            case "varys": Image("AgentVarys").resizable().padding(size * 0.12).foregroundStyle(palette.text)
            case "claude": Image("AgentClaude").resizable().padding(size * 0.08)
            case "codex": Image("AgentCodex").resizable().padding(size * 0.08).foregroundStyle(palette.text)
            default: Image("OtterAgent").resizable().padding(size * 0.04).foregroundStyle(palette.text)
            }
        }
        .scaledToFit()
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/** A glass pill of words that comes up over the list and leaves on its own. */
struct Toast: View {
    @Environment(\.palette) private var palette
    let text: String
    var symbol = "checkmark.circle"
    var action: (label: String, run: () -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).font(.system(size: 18)).foregroundStyle(palette.muted)
            Text(text).font(.ui(14)).foregroundStyle(palette.text).lineLimit(2)
            if let action {
                Spacer(minLength: 8)
                Button(action.label, action: action.run)
                    .font(.ui(14, .semibold))
                    .foregroundStyle(palette.text)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 48)
        .glassEffect(.regular, in: .capsule)
        .padding(.horizontal, 24)
    }
}

/** A sweep of light over work in progress. */
struct Shimmer: ViewModifier {
    var active: Bool
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                if active {
                    GeometryReader { proxy in
                        LinearGradient(colors: [.clear, .white.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                            .frame(width: 72)
                            .offset(x: phase * (proxy.size.width + 72))
                            .blendMode(.sourceAtop)
                    }
                    .allowsHitTesting(false)
                }
            }
            .compositingGroup()
            .onAppear {
                guard active else { return }
                withAnimation(.linear(duration: 1.35).delay(0.6).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    func shimmer(_ active: Bool = true) -> some View { modifier(Shimmer(active: active)) }
}

enum Haptics {
    static func tap() { UISelectionFeedbackGenerator().selectionChanged() }
    static func done() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func impact() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
}
