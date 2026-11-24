import ExpoModulesCore
import SwiftUI
import UIKit

public final class OtterAgentBrowserModule: Module {
    public func definition() -> ModuleDefinition {
        Name("OtterAgentBrowser")

        View(OtterAgentBrowserView.self) {
            Events("onPageInput", "onPageTouch")

            Prop("controlling") { (view, controlling: Bool) in view.controlling = controlling }
            Prop("keyboard") { (view, keyboard: Bool) in view.keyboard = keyboard }
            Prop("demo") { (view, demo: Bool) in view.demo = demo }
            Prop("accent") { (view, accent: UIColor) in view.accent = Color(uiColor: accent) }
            Prop("pointer") { (view, pointer: BrowserPointerRecord?) in view.pointer = pointer?.value }
            Prop("typing") { (view, typing: BrowserTypingRecord?) in view.typing = typing?.value }
            OnViewDidUpdateProps { (view: OtterAgentBrowserView) in view.showPage() }

            AsyncFunction("drawFrame") { (view: OtterAgentBrowserView, jpeg: Uint8Array, width: Double, height: Double, promise: Promise) in
                let data = Data(bytes: jpeg.rawPointer, count: jpeg.byteLength)
                let size = width > 0 && height > 0 ? CGSize(width: width, height: height) : nil
                DispatchQueue.global(qos: .userInitiated).async { [weak view] in
                    let image = UIImage(data: data)?.preparingForDisplay()
                    DispatchQueue.main.async {
                        guard let view, let image else { return promise.resolve(false) }
                        view.image = image
                        view.css = size
                        view.showPage()
                        promise.resolve(true)
                    }
                }
            }
        }
    }
}

private struct BrowserPointerRecord: Record {
    @Field var x: Double = 0
    @Field var y: Double = 0
    @Field var clicks: Int = 0
    @Field var seen: Double = 0

    var value: BrowserPage.Pointer {
        .init(at: CGPoint(x: x, y: y), clicks: clicks, seen: Date(timeIntervalSince1970: seen / 1000))
    }
}

private struct BrowserTypingRecord: Record {
    @Field var x: Double = 0
    @Field var y: Double = 0
    @Field var width: Double = 0
    @Field var height: Double = 0
    @Field var seen: Double = 0

    var value: BrowserPage.Typing {
        .init(box: CGRect(x: x, y: y, width: width, height: height), seen: Date(timeIntervalSince1970: seen / 1000))
    }
}

private final class OtterAgentBrowserView: ExpoView {
    let onPageInput = EventDispatcher()
    let onPageTouch = EventDispatcher()
    var image: UIImage?
    var css: CGSize?
    var controlling = false
    var keyboard = false
    var demo = false
    var accent = Color.accentColor
    var pointer: BrowserPage.Pointer?
    var typing: BrowserPage.Typing?
    private lazy var host = UIHostingController(rootView: page)

    override func didMoveToWindow() {
        super.didMoveToWindow()
        guard window != nil else {
            host.willMove(toParent: nil)
            host.view.removeFromSuperview()
            host.removeFromParent()
            return
        }
        var responder = next
        while let current = responder, !(current is UIViewController) {
            responder = current.next
        }
        guard let parent = responder as? UIViewController, host.parent == nil else { return }
        parent.addChild(host)
        host.view.frame = bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        host.view.backgroundColor = .clear
        host.safeAreaRegions = []
        addSubview(host.view)
        host.didMove(toParent: parent)
    }

    func showPage() { host.rootView = page }

    private var page: BrowserPage {
        BrowserPage(image: demo ? DemoBrowser.picture : image, css: demo ? DemoBrowser.size : css,
                    controlling: controlling, pointer: pointer, typing: typing, keyboard: keyboard,
                    accent: accent, input: { [weak self] in self?.send($0) },
                    touched: { [weak self] in self?.onPageTouch([:]) })
    }

    private func send(_ input: BrowserPageInput) {
        switch input {
        case .tap(let at, let count):
            onPageInput(["type": "tap", "x": at.x, "y": at.y, "clickCount": count])
        case .wheel(let at, let x, let y):
            onPageInput(["type": "wheel", "x": at.x, "y": at.y, "deltaX": x, "deltaY": y])
        case .key(let key):
            onPageInput(["type": "key", "key": key])
        case .text(let text):
            onPageInput(["type": "text", "text": text])
        }
    }
}
