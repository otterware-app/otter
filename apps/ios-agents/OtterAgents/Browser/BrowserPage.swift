import SwiftUI
import UIKit

/** The page's frames, fitted against the top, and what you do on them while you hold the tab. */
struct BrowserPage: View {
    let session: BrowserSession
    /** The iPhone keyboard may come up for the page's field: not while the address has it. */
    let typing: Bool
    var touched: () -> Void
    /** Where the finger last was, once it has gone far enough to be scrolling. */
    @State private var panned: CGPoint?
    @State private var lastTap: (at: CGPoint, time: Date, count: Int)?

    var body: some View {
        GeometryReader { proxy in
            let fit = session.frame.flatMap { BrowserFit(view: proxy.size, image: $0.size, css: session.cssSize ?? $0.size) }
            ZStack(alignment: .top) {
                if let image = session.frame, let fit {
                    Image(uiImage: image)
                        .resizable()
                        .frame(width: fit.rect.width, height: fit.rect.height)
                        .accessibilityLabel("Browser page")
                }
                if let fit, !session.controlling {
                    AgentCursor(pointer: session.pointer, typing: session.typing, fit: fit)
                }
                PageKeyboard(shown: session.keyboard && typing) { text in
                    session.send(text.count == 1 ? BrowserInput.press(text) : [.text(text)])
                } delete: {
                    session.send(BrowserInput.press("\u{8}"))
                }
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
            .contentShape(.rect)
            .gesture(touches(fit), isEnabled: session.controlling)
        }
    }

    /** A tap clicks; a drag past a tap's slop turns the wheel, so the page follows the finger. */
    private func touches(_ fit: BrowserFit?) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                guard let fit else { return }
                if panned == nil, hypot(value.translation.width, value.translation.height) < 8 { return }
                let last = panned ?? value.startLocation
                panned = value.location
                guard let at = fit.page(value.location, clamped: true) else { return }
                session.send([.wheel(at: at, deltaX: (last.x - value.location.x) / fit.scale, deltaY: (last.y - value.location.y) / fit.scale)])
            }
            .onEnded { value in
                defer { panned = nil }
                touched()
                guard panned == nil, let at = fit?.page(value.location) else { return }
                let again = lastTap.map { value.time.timeIntervalSince($0.time) < 0.5 && hypot(value.location.x - $0.at.x, value.location.y - $0.at.y) < 4 } ?? false
                let count = again ? (lastTap?.count ?? 0) + 1 : 1
                lastTap = (value.location, value.time, count)
                session.send(BrowserInput.tap(at: at, clickCount: count))
            }
    }
}

/** The iPhone keyboard for the page's field: nothing to see, and what's typed goes to the page. */
private struct PageKeyboard: UIViewRepresentable {
    var shown: Bool
    var type: (String) -> Void
    var delete: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }
    func makeUIView(context: Context) -> Keys { Keys() }

    func updateUIView(_ view: Keys, context: Context) {
        view.type = type
        view.delete = delete
        guard shown != context.coordinator.shown else { return }
        context.coordinator.shown = shown
        // After this update: taking the keyboard from the address field changes what SwiftUI has focused.
        Task { _ = shown ? view.becomeFirstResponder() : view.resignFirstResponder() }
    }

    final class Coordinator {
        var shown = false
    }

    final class Keys: UIView, UIKeyInput {
        var type: (String) -> Void = { _ in }
        var delete: () -> Void = {}
        var autocapitalizationType = UITextAutocapitalizationType.none
        var autocorrectionType = UITextAutocorrectionType.no
        var spellCheckingType = UITextSpellCheckingType.no
        var smartQuotesType = UITextSmartQuotesType.no
        var smartDashesType = UITextSmartDashesType.no

        override var canBecomeFirstResponder: Bool { true }
        // Always something to delete: what the field holds is the page's to know.
        var hasText: Bool { true }
        func insertText(_ text: String) { type(text) }
        func deleteBackward() { delete() }
    }
}

/**
 * The agent's pointer, gliding to where it moved or clicked (a pulse for a click), and an outline
 * on the field it types in (apps/web's agent-browser-overlay.tsx). Drawn over the stream, never
 * into the page.
 */
private struct AgentCursor: View {
    let pointer: BrowserSession.Pointer?
    let typing: BrowserSession.Typing?
    let fit: BrowserFit
    @State private var pointerShown = false
    @State private var typingShown = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if let typing {
                let origin = fit.view(typing.box.origin)
                RoundedRectangle(cornerRadius: 3)
                    .strokeBorder(Status.working.opacity(0.8), lineWidth: 2)
                    .frame(width: typing.box.width * fit.scale + 4, height: typing.box.height * fit.scale + 4)
                    .offset(x: origin.x - 2, y: origin.y - 2)
                    .opacity(typingShown ? 1 : 0)
            }
            if let pointer {
                let at = fit.view(pointer.at)
                ZStack(alignment: .topLeading) {
                    if pointer.clicks > 0 { Ping().id(pointer.clicks) }
                    PointerArrow()
                        .fill(Status.working)
                        .stroke(.white, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
                        .frame(width: 20, height: 20)
                        .shadow(color: .black.opacity(0.3), radius: 2, y: 1)
                        .offset(x: -3, y: -3)
                }
                .offset(x: at.x, y: at.y)
                .opacity(pointerShown ? 1 : 0)
                .animation(.easeOut(duration: 0.2), value: at)
            }
        }
        .clipped()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .animation(.easeOut(duration: 0.3), value: typingShown)
        .animation(.easeOut(duration: 0.2), value: pointerShown)
        .task(id: pointer?.seen) { await show($pointerShown, pointer != nil) }
        .task(id: typing?.seen) { await show($typingShown, typing != nil) }
    }

    /** Fades out a while after the last thing the agent did. */
    private func show(_ shown: Binding<Bool>, _ recent: Bool) async {
        guard recent else { return }
        shown.wrappedValue = true
        guard (try? await Task.sleep(for: .milliseconds(1800))) != nil else { return }
        shown.wrappedValue = false
    }
}

private struct Ping: View {
    @State private var spread = false

    var body: some View {
        Circle()
            .fill(Status.working.opacity(0.5))
            .frame(width: 24, height: 24)
            .scaleEffect(spread ? 2 : 1)
            .opacity(spread ? 0 : 1)
            .offset(x: -12, y: -12)
            .onAppear { withAnimation(.easeOut(duration: 0.6)) { spread = true } }
    }
}

/** A mouse pointer, its tip a sixth in from the top left. */
private nonisolated struct PointerArrow: Shape {
    func path(in rect: CGRect) -> Path {
        let points: [(CGFloat, CGFloat)] = [(4, 4), (20.7, 10.8), (14.3, 12.6), (12.6, 14.3), (10.8, 20.7)]
        var path = Path()
        path.addLines(points.map { CGPoint(x: rect.minX + $0.0 / 24 * rect.width, y: rect.minY + $0.1 / 24 * rect.height) })
        path.closeSubpath()
        return path
    }
}
