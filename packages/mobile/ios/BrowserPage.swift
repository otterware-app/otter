import SwiftUI
import UIKit

struct BrowserPage: View {
    nonisolated struct Pointer: Equatable {
        var at: CGPoint
        var clicks: Int
        var seen: Date
    }

    nonisolated struct Typing: Equatable {
        var box: CGRect
        var seen: Date
    }

    let image: UIImage?
    let css: CGSize?
    let controlling: Bool
    let pointer: Pointer?
    let typing: Typing?
    let keyboard: Bool
    let accent: Color
    var input: (BrowserPageInput) -> Void
    var touched: () -> Void

    var body: some View {
        BrowserCanvas(image: image, css: css, controlling: controlling, pointer: pointer,
                      typing: typing, accent: accent, input: input, touched: touched)
            .overlay {
                PageKeyboard(shown: keyboard) { text in
                    input(text.count == 1 ? .key(text) : .text(text))
                } delete: {
                    input(.key("\u{8}"))
                }
                .frame(width: 0, height: 0)
                .accessibilityHidden(true)
            }
    }
}

nonisolated enum BrowserPageInput {
    case tap(at: CGPoint, clickCount: Int)
    case wheel(at: CGPoint, deltaX: Double, deltaY: Double)
    case key(String)
    case text(String)
}

private struct BrowserCanvas: UIViewControllerRepresentable {
    var image: UIImage?
    var css: CGSize?
    var controlling: Bool
    var pointer: BrowserPage.Pointer?
    var typing: BrowserPage.Typing?
    var accent: Color
    var input: (BrowserPageInput) -> Void
    var touched: () -> Void

    func makeUIViewController(context: Context) -> BrowserPageController { BrowserPageController() }

    func updateUIViewController(_ controller: BrowserPageController, context: Context) {
        controller.input = input
        controller.touched = touched
        controller.update(image: image, css: css, controlling: controlling, pointer: pointer, typing: typing, accent: accent)
    }
}

final class BrowserPageController: UIViewController, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    let scroll = UIScrollView()
    private let picture = UIHostingController(rootView: BrowserPicture())
    private var imageSize = CGSize.zero
    private var cssSize = CGSize.zero
    private var viewport = CGSize.zero
    private var lastTap: (at: CGPoint, time: TimeInterval, count: Int)?
    private var tap: UITapGestureRecognizer!
    private var wheel: UIPanGestureRecognizer!
    var input: (BrowserPageInput) -> Void = { _ in }
    var touched: () -> Void = {}

    override func loadView() { view = scroll }

    override func viewDidLoad() {
        super.viewDidLoad()
        scroll.delegate = self
        scroll.maximumZoomScale = 4
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.accessibilityLabel = "Browser page"
        scroll.backgroundColor = .clear
        addChild(picture)
        picture.view.backgroundColor = .clear
        scroll.addSubview(picture.view)
        picture.didMove(toParent: self)
        tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        wheel = UIPanGestureRecognizer(target: self, action: #selector(scrolled))
        wheel.maximumNumberOfTouches = 1
        wheel.delegate = self
        tap.require(toFail: wheel)
        if let pinch = scroll.pinchGestureRecognizer {
            tap.require(toFail: pinch)
        }
        scroll.addGestureRecognizer(tap)
        scroll.addGestureRecognizer(wheel)
    }

    func update(image: UIImage?, css: CGSize?, controlling: Bool, pointer: BrowserPage.Pointer?, typing: BrowserPage.Typing?, accent: Color = .accentColor) {
        loadViewIfNeeded()
        imageSize = image?.size ?? .zero
        cssSize = css ?? imageSize
        picture.rootView = BrowserPicture(image: image, css: cssSize, pointer: controlling ? nil : pointer, typing: controlling ? nil : typing, accent: accent)
        tap.isEnabled = controlling
        wheel.isEnabled = controlling
        scroll.panGestureRecognizer.minimumNumberOfTouches = controlling ? 2 : 1
        scroll.accessibilityHint = controlling ? "Pinch to zoom. Pan with two fingers; scroll the page with one." : "Pinch to zoom and drag to pan."
        view.setNeedsLayout()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard let fit = BrowserFit(view: scroll.bounds.size, image: imageSize, css: cssSize) else { return }
        let size = fit.rect.size
        guard viewport != scroll.bounds.size || picture.view.bounds.size != size else { return }
        viewport = scroll.bounds.size
        let zoom = scroll.zoomScale
        scroll.setZoomScale(1, animated: false)
        picture.view.frame = CGRect(origin: .zero, size: size)
        scroll.contentSize = size
        scroll.setZoomScale(zoom, animated: false)
        scrollViewDidZoom(scroll)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { picture.view }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        otherGestureRecognizer == scroll.pinchGestureRecognizer
    }

    func scrollViewDidZoom(_ scrollView: UIScrollView) {
        scroll.contentInset = UIEdgeInsets(top: 0, left: max(0, (scroll.bounds.width - picture.view.frame.width) / 2), bottom: 0, right: 0)
        scroll.accessibilityValue = "\(Int((scroll.zoomScale * 100).rounded()))%"
    }

    func pagePoint(_ point: CGPoint, clamped: Bool = false) -> CGPoint? {
        BrowserFit(view: picture.view.bounds.size, image: imageSize, css: cssSize)?.page(scroll.convert(point, to: picture.view), clamped: clamped)
    }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        touched()
        guard let at = pagePoint(gesture.location(in: scroll)) else { return }
        let time = ProcessInfo.processInfo.systemUptime
        let again = lastTap.map { time - $0.time < 0.5 && hypot(at.x - $0.at.x, at.y - $0.at.y) < 16 } ?? false
        let count = again ? (lastTap?.count ?? 0) + 1 : 1
        lastTap = (at, time, count)
        input(.tap(at: at, clickCount: count))
    }

    @objc private func scrolled(_ gesture: UIPanGestureRecognizer) {
        if gesture.state == .began { touched() }
        guard gesture.state == .changed, let at = pagePoint(gesture.location(in: scroll), clamped: true) else { return }
        let delta = gesture.translation(in: picture.view)
        gesture.setTranslation(.zero, in: picture.view)
        let scale = picture.view.bounds.width / cssSize.width
        input(.wheel(at: at, deltaX: -delta.x / scale, deltaY: -delta.y / scale))
    }
}

private struct BrowserPicture: View {
    var image: UIImage?
    var css = CGSize.zero
    var pointer: BrowserPage.Pointer?
    var typing: BrowserPage.Typing?
    var accent: Color = .accentColor

    var body: some View {
        GeometryReader { proxy in
            if let image {
                Image(uiImage: image).resizable().frame(width: proxy.size.width, height: proxy.size.height)
                if let fit = BrowserFit(view: proxy.size, image: image.size, css: css) {
                    AgentCursor(pointer: pointer, typing: typing, fit: fit, accent: accent)
                }
            }
        }
        .accessibilityHidden(true)
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
        let coordinator = context.coordinator
        Task {
            guard coordinator.shown == shown else { return }
            _ = shown ? view.becomeFirstResponder() : view.resignFirstResponder()
        }
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
    let pointer: BrowserPage.Pointer?
    let typing: BrowserPage.Typing?
    let fit: BrowserFit
    let accent: Color
    @State private var pointerShown = false
    @State private var typingShown = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.clear
            if let typing {
                let origin = fit.view(typing.box.origin)
                RoundedRectangle(cornerRadius: 3)
                    .strokeBorder(accent.opacity(0.8), lineWidth: 2)
                    .frame(width: typing.box.width * fit.scale + 4, height: typing.box.height * fit.scale + 4)
                    .offset(x: origin.x - 2, y: origin.y - 2)
                    .opacity(typingShown ? 1 : 0)
            }
            if let pointer {
                let at = fit.view(pointer.at)
                ZStack(alignment: .topLeading) {
                    if pointer.clicks > 0 { Ping(accent: accent).id(pointer.clicks) }
                    PointerArrow()
                        .fill(accent)
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
    let accent: Color
    @State private var spread = false

    var body: some View {
        Circle()
            .fill(accent.opacity(0.5))
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

/** Where the frame sits in its view, fitted and against the top, and what a point of one is in the other. */
nonisolated struct BrowserFit: Equatable, Sendable {
    /** The frame, in the view. */
    var rect: CGRect
    /** View points per page CSS px. */
    var scale: CGFloat
    var css: CGSize

    init?(view: CGSize, image: CGSize, css: CGSize) {
        guard view.width > 0, view.height > 0, image.width > 0, image.height > 0, css.width > 0, css.height > 0 else { return nil }
        let fit = min(view.width / image.width, view.height / image.height)
        let size = CGSize(width: image.width * fit, height: image.height * fit)
        rect = CGRect(x: (view.width - size.width) / 2, y: 0, width: size.width, height: size.height)
        scale = size.width / css.width
        self.css = css
    }

    /** The page's point under a point of the view: none outside the frame, unless clamped to it. */
    func page(_ point: CGPoint, clamped: Bool = false) -> CGPoint? {
        let x = (point.x - rect.minX) / rect.width * css.width
        let y = (point.y - rect.minY) / rect.height * css.height
        if !clamped, x < 0 || y < 0 || x > css.width || y > css.height { return nil }
        return CGPoint(x: min(max(x, 0), css.width), y: min(max(y, 0), css.height))
    }

    func view(_ point: CGPoint) -> CGPoint {
        CGPoint(x: rect.minX + point.x * scale, y: rect.minY + point.y * scale)
    }
}

/** The demo's picture of an agent's browser: one drawn page, so the live view can be opened and tried. */
enum DemoBrowser {
    static let page = "https://otterware.app/mail/changelog"
    static let size = CGSize(width: 1280, height: 800)
    static let picture: UIImage = {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let lines: [(String, CGFloat, CGFloat, UIFont)] = [
                ("Otter", 40, 24, .systemFont(ofSize: 22, weight: .bold)),
                ("Changelog", 160, 130, .systemFont(ofSize: 40, weight: .bold)),
                ("A calmer place for your work", 160, 230, .systemFont(ofSize: 28, weight: .semibold)),
                ("Mail, calendar, files and tasks, with your agents alongside.", 160, 288, .systemFont(ofSize: 20)),
                ("Follow along as your agent browses", 160, 390, .systemFont(ofSize: 28, weight: .semibold)),
                ("Watch the page, take control, and hand it back when you are ready.", 160, 448, .systemFont(ofSize: 20)),
                ("Everything together", 160, 550, .systemFont(ofSize: 28, weight: .semibold)),
                ("Keep the conversation and the work in the same place.", 160, 608, .systemFont(ofSize: 20)),
            ]
            for (text, x, y, font) in lines {
                text.draw(at: CGPoint(x: x, y: y), withAttributes: [.font: font, .foregroundColor: UIColor.black])
            }
        }
    }()
}
