import SwiftUI
import UIKit

/**
 * T3 Code's phone layout (apps/mobile in t3code) in Otter's own face: its
 * type sizes and spacing, and Inter for DM Sans.
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

    static let working = color(0x0369a1, 0x38bdf8)
    static let done = color(0x04633f, 0x6ee7b7)
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
    var dangerFill: Color { error.opacity(0.14) }
}

/**
 * An agent's picture: the face of the gateway's agent a chat runs on (an OpenClaw agent's picture
 * or emoji), else the picture you gave the agent, else its kind's mark (Claude's for a Mac's
 * Claude agent too), else Otter's.
 */
struct AgentAvatar: View {
    @Environment(\.palette) private var palette
    @Environment(ChatStore.self) private var store: ChatStore?
    /** The agent's id. */
    var agent: String?
    /** Which of an OpenClaw gateway's agents. */
    var gatewayAgent: String?
    /** A kind's mark, for no agent in particular. */
    var kind: String?
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
        let found = store?.agents.agent(agent)
        let face = gatewayAgent.flatMap { found?.faces[$0] }
        if let avatar = face?.avatar ?? (face?.emoji == nil ? found?.avatar : nil), let image = Self.picture(avatar) {
            Image(uiImage: image).resizable().scaledToFill().frame(width: size, height: size).clipShape(.circle).accessibilityHidden(true)
        } else if let avatar = face?.avatar, let url = URL(string: avatar), url.scheme == "https" {
            AsyncImage(url: url) { image in image.resizable().scaledToFill() } placeholder: { mark(found?.entry.kind) }
                .frame(width: size, height: size).clipShape(.circle).accessibilityHidden(true)
        } else if let emoji = face?.emoji, !emoji.isEmpty {
            Text(emoji).font(.system(size: size * 0.82)).frame(width: size, height: size).accessibilityHidden(true)
        } else {
            mark(kind ?? found?.entry.kind)
        }
    }

    private func mark(_ kind: String?) -> some View {
        Group {
            switch kind {
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
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { proxy in
                    LinearGradient(colors: [.clear, .white.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: 72)
                        .offset(x: phase * (proxy.size.width + 72))
                        .blendMode(.sourceAtop)
                }
                .allowsHitTesting(false)
            }
            .compositingGroup()
            .onAppear {
                withAnimation(.linear(duration: 1.35).delay(0.6).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

extension View {
    /** Only while active: its group is drawn apart from the rest, and every reply's pill and step has one. */
    @ViewBuilder func shimmer(_ active: Bool = true) -> some View {
        if active { modifier(Shimmer()) } else { self }
    }
}

enum Haptics {
    static func tap() { UISelectionFeedbackGenerator().selectionChanged() }
    static func done() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func impact() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
}

extension Palette {
    func incoming(_ scheme: ColorScheme) -> Color {
        Color(hex: scheme == .dark ? "#242426" : "#e6e6e6")
    }

    func outgoing(_ scheme: ColorScheme) -> Color {
        scheme == .dark ? canvas.mix(with: action, by: 0.38) : canvas.mix(with: action, by: 0.16)
    }
}

/** A message's bubble: round, but tight on its side where it meets the one above or below, as T3 Code groups them. */
func bubbleShape(_ side: HorizontalEdge, joinsAbove: Bool = false, joinsBelow: Bool = false) -> UnevenRoundedRectangle {
    let (round, tight): (CGFloat, CGFloat) = (18, 5)
    let top = joinsAbove ? tight : round, bottom = joinsBelow ? tight : round
    return side == .leading
        ? UnevenRoundedRectangle(topLeadingRadius: top, bottomLeadingRadius: bottom, bottomTrailingRadius: round, topTrailingRadius: round, style: .continuous)
        : UnevenRoundedRectangle(topLeadingRadius: round, bottomLeadingRadius: round, bottomTrailingRadius: bottom, topTrailingRadius: top, style: .continuous)
}

/**
 * Drag a message to the right to reply to it, as in WhatsApp: it follows the finger, an arrow
 * comes in behind it, and letting go past the arrow quotes it in your next message.
 */
struct SwipeToReply: ViewModifier {
    @Environment(\.palette) private var palette
    let reply: (() -> Void)?
    @State private var offset: CGFloat = 0
    @State private var armed = false
    private static let threshold: CGFloat = 60

    func body(content: Content) -> some View {
        if let reply {
            content
                .offset(x: offset)
                .background(alignment: .leading) {
                    // Only while dragged: every bubble has one, and a chat has hundreds.
                    if offset > 0 {
                        Image(systemName: "arrowshape.turn.up.left.fill")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(palette.text)
                            .frame(width: 30, height: 30)
                            .background(palette.text.opacity(0.12), in: .circle)
                            .scaleEffect(armed ? 1.1 : 0.4 + 0.6 * min(1, offset / Self.threshold))
                            .opacity(min(1, offset / Self.threshold))
                            .offset(x: min(offset, Self.threshold) - 38)
                            .allowsHitTesting(false)
                    }
                }
                .gesture(ReplyPan { x in
                    offset = x <= 0 ? 0 : x < 80 ? x : 80 + (x - 80) * 0.2
                    if (x >= Self.threshold) != armed {
                        armed = x >= Self.threshold
                        if armed { Haptics.impact() }
                    }
                } ended: {
                    if armed { reply() }
                    armed = false
                    withAnimation(.spring(duration: 0.3, bounce: 0.2)) { offset = 0 }
                })
                .accessibilityAction(named: "Reply", reply)
        } else {
            content
        }
    }
}

extension View {
    func swipeToReply(_ reply: (() -> Void)?) -> some View { modifier(SwipeToReply(reply: reply)) }
}

/** A pan that only starts rightward, so the conversation still scrolls and text still selects. */
private struct ReplyPan: UIGestureRecognizerRepresentable {
    var changed: (CGFloat) -> Void
    var ended: () -> Void

    func makeUIGestureRecognizer(context: Context) -> RightwardPan { RightwardPan() }

    func handleUIGestureRecognizerAction(_ recognizer: RightwardPan, context: Context) {
        switch recognizer.state {
        case .began, .changed: changed(recognizer.translation(in: recognizer.view).x)
        default: ended()
        }
    }
}

private final class RightwardPan: UIPanGestureRecognizer {
    private var start: CGPoint?

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        start = touches.first?.location(in: view)
        // From the screen's edge, a swipe goes back: it would quote the message it passes instead.
        if let window = view?.window, let x = touches.first?.location(in: window).x, x < 24 { state = .failed }
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        if state == .possible, let start, let point = touches.first?.location(in: view) {
            let dx = point.x - start.x, dy = abs(point.y - start.y)
            if dx < -4 || (dy > 4 && dy > dx * 0.7) {
                state = .failed
                return
            }
        }
        super.touchesMoved(touches, with: event)
    }
}
