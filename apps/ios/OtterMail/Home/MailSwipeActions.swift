import SwiftUI

struct MailSwipeAction: Identifiable {
    let title: String
    let symbol: String
    let tint: Color
    let perform: () -> Void
    var id: String { title }
}

/**
 * Linear's swipe: the row follows the finger and rounds off on the side it
 * uncovers, over a grey pill with the action. Past the threshold the pill takes
 * the action's color (with a tap of haptics); let go there and it runs,
 * anywhere short of it and the row springs back. One action a side.
 */
struct MailSwipeActions: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.palette) private var palette
    let leading: MailSwipeAction?
    let trailing: MailSwipeAction?
    /** Full-width rows: the row and its pill stay square, the pill flush with the screen's edge. */
    var square = false

    @State private var width: CGFloat = 0
    @State private var offset: CGFloat = 0
    @State private var dragging = false
    @State private var committing = false

    private var radius: CGFloat { square ? 0 : 28 }
    private var inset: CGFloat { square ? 0 : 12 }

    private var direction: CGFloat { layoutDirection == .rightToLeft ? -1 : 1 }
    private var action: MailSwipeAction? { offset > 0 ? leading : offset < 0 ? trailing : nil }
    private var armed: Bool { MailSwipe.armed(offset: offset, width: width) }

    func body(content: Content) -> some View {
        let edge = min(abs(offset), radius)
        let fromLeading = offset > 0
        content
            .clipShape(UnevenRoundedRectangle(
                topLeadingRadius: fromLeading ? edge : 0, bottomLeadingRadius: fromLeading ? edge : 0,
                bottomTrailingRadius: offset < 0 ? edge : 0, topTrailingRadius: offset < 0 ? edge : 0
            ))
            .offset(x: offset * direction)
            .background(alignment: fromLeading ? .leading : .trailing) {
                if let action {
                    pill(action, fromLeading: fromLeading)
                        // The whole row's width, still: the row covers it, and the drag uncovers it.
                        .padding(fromLeading ? .leading : .trailing, inset)
                }
            }
            .clipped()
            .contentShape(.rect)
            .gesture(HorizontalMailSwipe(enabled: !committing && (leading != nil || trailing != nil)) { state, translation, velocity in
                switch state {
                case .began:
                    dragging = true
                case .changed:
                    let next = translation * direction
                    offset = min(max(next, trailing == nil ? 0 : -width), leading == nil ? 0 : width)
                case .ended:
                    dragging = false
                    finish(velocity: velocity * direction)
                default:
                    dragging = false
                    settle()
                }
            })
            .sensoryFeedback(trigger: armed) { _, _ in dragging ? .impact(weight: .medium) : nil }
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .onDisappear { offset = 0 }
            .accessibilityActions {
                ForEach([leading, trailing].compactMap(\.self)) { action in
                    Button(action.title, action: action.perform)
                }
            }
    }

    private func pill(_ action: MailSwipeAction, fromLeading: Bool) -> some View {
        HStack(spacing: 10) {
            if fromLeading { Image(systemName: action.symbol) }
            Text(action.title)
            if !fromLeading { Image(systemName: action.symbol) }
        }
        .font(.inter(.body).weight(.medium))
        .lineLimit(1)
        .fixedSize()
        .foregroundStyle(armed ? action.tint.contrastingText : palette.muted)
        .padding(.horizontal, 22)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: fromLeading ? .leading : .trailing)
        .background(armed ? action.tint : palette.text.opacity(0.08))
        .clipShape(UnevenRoundedRectangle(
            topLeadingRadius: fromLeading ? radius : 0, bottomLeadingRadius: fromLeading ? radius : 0,
            bottomTrailingRadius: fromLeading ? 0 : radius, topTrailingRadius: fromLeading ? 0 : radius
        ))
        .animation(reduceMotion ? nil : .smooth(duration: 0.18), value: armed)
    }

    private func finish(velocity: CGFloat) {
        guard MailSwipe.commits(offset: offset, velocity: velocity, width: width), let action else { return settle() }
        committing = true
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.22)) {
            offset = offset > 0 ? width : -width
        } completion: {
            action.perform()
            offset = 0
            committing = false
        }
    }

    private func settle() {
        withAnimation(reduceMotion ? nil : .spring(duration: 0.4, bounce: 0.2)) { offset = 0 }
    }
}

nonisolated enum MailSwipe {
    /** How far to pull before letting go runs the action. */
    static func armed(offset: CGFloat, width: CGFloat) -> Bool {
        width > 0 && abs(offset) >= min(width * 0.35, 150)
    }

    /** Armed, and not flung back toward where it started. */
    static func commits(offset: CGFloat, velocity: CGFloat, width: CGFloat) -> Bool {
        armed(offset: offset, width: width) && velocity * (offset > 0 ? 1 : -1) > -400
    }
}

/** Reject vertical pans before recognition so the list keeps its normal scrolling. */
private struct HorizontalMailSwipe: UIGestureRecognizerRepresentable {
    var enabled: Bool
    var update: (UIGestureRecognizer.State, CGFloat, CGFloat) -> Void

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let recognizer = UIPanGestureRecognizer()
        recognizer.maximumNumberOfTouches = 1
        recognizer.delegate = context.coordinator
        recognizer.isEnabled = enabled
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIPanGestureRecognizer, context: Context) {
        recognizer.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIPanGestureRecognizer, context: Context) {
        update(recognizer.state, recognizer.translation(in: nil).x, recognizer.velocity(in: nil).x)
    }

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
            guard let pan = gestureRecognizer as? UIPanGestureRecognizer else { return false }
            let velocity = pan.velocity(in: nil)
            return abs(velocity.x) > abs(velocity.y) * 1.5
        }
    }
}
