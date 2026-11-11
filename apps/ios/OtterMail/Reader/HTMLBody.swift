import SwiftUI
import WebKit

/** An HTML message in WebKit, as tall as its content so it scrolls with the conversation. */
struct HTMLBody: View {
    let html: String
    var inline: [Attachment] = []
    var cornerRadius: CGFloat = 14
    var onSelect: (String) -> Void = { _ in }
    var load: @MainActor @Sendable (Attachment) async -> Data? = { _ in nil }

    @State private var page: WebPage?
    @State private var height: CGFloat = 200

    var body: some View {
        Group {
            if let page {
                WebView(page).scrollDisabled(true)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        }
        .frame(height: height)
        .clipShape(.rect(cornerRadius: cornerRadius))
        .task(id: html) {
            var configuration = WebPage.Configuration()
            configuration.dataDetectorTypes = [.phoneNumber]
            configuration.urlSchemeHandlers[URLScheme("cid")!] = InlineImages(images: inline, load: load)
            let binding = $height
            configuration.userContentController.add(HeightObserver { value in
                if abs(binding.wrappedValue - value) >= 1 { binding.wrappedValue = value }
            }, name: "messageHeight")
            configuration.userContentController.add(SelectionObserver(update: onSelect), name: "selection")
            configuration.userContentController.addUserScript(WKUserScript(source: """
                document.addEventListener("selectionchange", () => window.webkit.messageHandlers.selection.postMessage(String(getSelection())));
                const report = () => window.webkit.messageHandlers.messageHeight.postMessage(document.documentElement.scrollHeight);
                new ResizeObserver(report).observe(document.body);
                report();
                """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
            let next = WebPage(configuration: configuration, navigationDecider: OpenLinksOutside())
            page = next
            do {
                for try await _ in next.load(html: Self.fitted(html), baseURL: URL(string: "about:blank")!) {
                    try Task.checkCancellation()
                }
            } catch {}
        }
    }

    private static func fitted(_ html: String) -> String {
        """
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          html, body { margin: 0; -webkit-text-size-adjust: 100%; }
          img { max-width: 100%; height: auto; }
          table { max-width: 100% !important; }
          table[width], td[width] { width: auto !important; }
        </style>
        \(html)
        """
    }

    private final class HeightObserver: NSObject, WKScriptMessageHandler {
        let update: (CGFloat) -> Void
        init(update: @escaping (CGFloat) -> Void) { self.update = update }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let value = message.body as? Double, value.isFinite, value > 0 else { return }
            update(ceil(value))
        }
    }

    private final class SelectionObserver: NSObject, WKScriptMessageHandler {
        let update: (String) -> Void
        init(update: @escaping (String) -> Void) { self.update = update }
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            update(message.body as? String ?? "")
        }
    }

    private struct OpenLinksOutside: WebPage.NavigationDeciding {
        func decidePolicy(
            for action: WebPage.NavigationAction,
            preferences: inout WebPage.NavigationPreferences
        ) async -> WKNavigationActionPolicy {
            guard action.navigationType == .linkActivated, let url = action.request.url else { return .allow }
            await UIApplication.shared.open(url)
            return .cancel
        }
    }
}

/** No base64 copies of the whole document, and a slow attachment doesn't delay the text. */
nonisolated struct InlineImages: URLSchemeHandler {
    let images: [Attachment]
    let load: @MainActor @Sendable (Attachment) async -> Data?

    func reply(for request: URLRequest) -> AsyncThrowingStream<URLSchemeTaskResult, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                guard let url = request.url,
                      let cid = String(url.absoluteString.dropFirst(4)).removingPercentEncoding,
                      let image = images.first(where: { $0.contentID == cid }),
                      let data = await load(image), !Task.isCancelled else {
                    continuation.finish(throwing: URLError(.resourceUnavailable))
                    return
                }
                continuation.yield(.response(URLResponse(url: url, mimeType: image.mimeType, expectedContentLength: data.count, textEncodingName: nil)))
                continuation.yield(.data(data))
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
