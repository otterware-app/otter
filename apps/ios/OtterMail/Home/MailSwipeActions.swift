import SwiftUI

struct MailSwipeAction: Identifiable {
    let title: String
    let symbol: String
    let tint: Color
    let perform: () -> Void
    var id: String { title }
}

struct MailSwipeActions: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.layoutDirection) private var layoutDirection
    let id: String
    @Binding var activeRow: String?
    let leading: [MailSwipeAction]
    let trailing: [MailSwipeAction]

    @State private var width: CGFloat = 0
    @State private var offset: CGFloat = 0
    @State private var start: CGFloat = 0
    @State private var committing = false

    private var animation: Animation? { reduceMotion ? nil : .easeOut(duration: 0.16) }
    private var direction: CGFloat { layoutDirection == .rightToLeft ? -1 : 1 }
    private var actions: [MailSwipeAction] { offset > 0 ? leading : trailing }

    func body(content: Content) -> some View {
        content
            .overlay {
                if activeRow != nil {
                    Color.clear.contentShape(.rect).onTapGesture { activeRow = nil }
                }
            }
            .offset(x: offset * direction)
            .background(alignment: offset > 0 ? .leading : .trailing) {
                if offset != 0, let first = actions.first {
                    let fullSwipe = abs(offset) >= width * 0.72
                    HStack(spacing: 0) {
                        ForEach(fullSwipe ? [first] : offset > 0 ? actions : Array(actions.reversed())) { action in
                            Button { perform(action) } label: {
                                VStack(spacing: 6) {
                                    Image(systemName: action.symbol).font(.inter(.title3))
                                    Text(action.title).lineLimit(1).minimumScaleFactor(0.8)
                                }
                                    .padding(.horizontal, 4)
                                    .font(.inter(.caption).weight(.medium))
                                    .foregroundStyle(.white)
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .background(action.tint)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(width: abs(offset))
                    .disabled(committing)
                }
            }
            .clipped()
            .contentShape(.rect)
            .gesture(HorizontalMailSwipe(enabled: !committing && !(leading.isEmpty && trailing.isEmpty)) { state, translation, velocity in
                switch state {
                case .began:
                    start = offset
                    activeRow = id
                case .changed:
                    let next = start + translation * direction
                    offset = min(max(next, trailing.isEmpty ? 0 : -width), leading.isEmpty ? 0 : width)
                case .ended:
                    finish(velocity: velocity * direction)
                case .cancelled, .failed:
                    close()
                default: break
                }
            })
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
            .onChange(of: activeRow) { _, active in
                if active != id && !committing { withAnimation(animation) { offset = 0 } }
            }
            .onDisappear {
                if activeRow == id { activeRow = nil }
                offset = 0
            }
            .accessibilityActions {
                ForEach(leading + trailing) { action in
                    Button(action.title) { perform(action) }
                }
            }
            .accessibilityAction(.escape) { close() }
    }

    private func finish(velocity: CGFloat) {
        let target = MailSwipeTarget.resolve(offset: offset, velocity: velocity, width: width, actionCount: actions.count)
        switch target {
        case .closed: close()
        case .revealed(let target):
            withAnimation(animation) { offset = target }
        case .committed:
            guard let action = actions.first else { return close() }
            committing = true
            withAnimation(animation) {
                offset = offset > 0 ? width : -width
            } completion: {
                perform(action)
                committing = false
            }
        }
    }

    private func close() {
        withAnimation(animation) { offset = 0 }
        if activeRow == id { activeRow = nil }
    }

    private func perform(_ action: MailSwipeAction) {
        close()
        action.perform()
    }
}

nonisolated enum MailSwipeTarget: Equatable {
    case closed, revealed(CGFloat), committed

    static func resolve(offset: CGFloat, velocity: CGFloat, width: CGFloat, actionCount: Int) -> Self {
        guard width > 0, actionCount > 0, offset != 0 else { return .closed }
        let sign: CGFloat = offset > 0 ? 1 : -1
        if abs(offset) >= width * 0.72 && velocity * sign >= -100 { return .committed }
        let reveal = min(CGFloat(actionCount) * 76, width * 0.6)
        return (offset + velocity * 0.12) * sign > reveal * 0.4 ? .revealed(sign * reveal) : .closed
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
