import ExpoModulesCore
import WebKit

/**
 * The Swift app's HTMLBody: a message's HTML in WebKit, as tall as its content so
 * it scrolls with the conversation. Its own scripts never run; inline images
 * come over `cid:` from the app (no base64 copies of the document), remote
 * ones only when allowed (a content rule blocks them otherwise), and links
 * and detected phone numbers, addresses and dates go to the app.
 */
public final class OtterHtmlView: ExpoView, WKNavigationDelegate, WKScriptMessageHandler {
  let onHeight = EventDispatcher()
  let onLink = EventDispatcher()
  let onInlineImage = EventDispatcher()

  private let webView: WKWebView
  private let images = InlineImages()
  private var html = ""
  private var remoteImages = false
  private var loaded: (html: String, remote: Bool)?
  private var lastHeight: CGFloat = 0

  public required init(appContext: AppContext? = nil) {
    let configuration = WKWebViewConfiguration()
    configuration.dataDetectorTypes = [.phoneNumber, .link, .address, .calendarEvent]
    configuration.defaultWebpagePreferences.allowsContentJavaScript = false
    configuration.setURLSchemeHandler(images, forURLScheme: "cid")
    configuration.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init(appContext: appContext)
    webView.navigationDelegate = self
    webView.scrollView.isScrollEnabled = false
    webView.isOpaque = false
    webView.backgroundColor = .clear
    images.view = self
    configuration.userContentController.add(WeakMessageHandler(self), contentWorld: .defaultClient, name: "messageHeight")
    configuration.userContentController.addUserScript(WKUserScript(
      source: """
        const report = () => window.webkit.messageHandlers.messageHeight.postMessage(document.documentElement.scrollHeight);
        new ResizeObserver(report).observe(document.body);
        report();
        """,
      injectionTime: .atDocumentEnd, forMainFrameOnly: true, in: .defaultClient))
    addSubview(webView)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    webView.frame = bounds
  }

  func setHtml(_ value: String) {
    html = value
    reload()
  }

  func setRemoteImages(_ allowed: Bool) {
    remoteImages = allowed
    reload()
  }

  func resolveImage(requestId: String, base64: String?, mimeType: String) {
    images.resolve(requestId: requestId, data: base64.flatMap { Data(base64Encoded: $0) }, mimeType: mimeType)
  }

  func requestImage(cid: String, requestId: String) {
    onInlineImage(["cid": cid, "requestId": requestId])
  }

  private func reload() {
    if let loaded, loaded.html == html, loaded.remote == remoteImages { return }
    loaded = (html, remoteImages)
    let document = Self.fitted(html)
    let controller = webView.configuration.userContentController
    if remoteImages {
      controller.removeAllContentRuleLists()
      webView.loadHTMLString(document, baseURL: URL(string: "about:blank"))
      return
    }
    RemoteImages.blockList { [weak self] list in
      guard let self else { return }
      if let list { controller.add(list) }
      self.webView.loadHTMLString(document, baseURL: URL(string: "about:blank"))
    }
  }

  private static func fitted(_ html: String) -> String {
    """
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      html, body { margin: 0; -webkit-text-size-adjust: 100%; word-wrap: break-word; }
      body { padding: 12px 14px; }
      body { font: -apple-system-body; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100% !important; }
      table[width], td[width] { width: auto !important; }
      pre { white-space: pre-wrap; }
    </style>
    \(html)
    """
  }

  public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let value = message.body as? Double, value.isFinite, value > 0 else { return }
    let height = ceil(value)
    guard abs(height - lastHeight) >= 1 else { return }
    lastHeight = height
    onHeight(["height": height])
  }

  public func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    guard action.navigationType == .linkActivated || action.navigationType == .other,
          let url = action.request.url, url.scheme != "about", url.scheme != "cid" else {
      return decisionHandler(.allow)
    }
    if action.navigationType == .other, action.targetFrame?.isMainFrame == true, url.scheme?.hasPrefix("http") == true {
      // A redirect or meta refresh the message tries on its own: never.
      return decisionHandler(.cancel)
    }
    onLink(["url": url.absoluteString])
    decisionHandler(.cancel)
  }
}

/** The content rule that keeps remote images (tracking pixels) from loading until allowed. */
enum RemoteImages {
  @MainActor private static var compiled: WKContentRuleList?

  @MainActor static func blockList(_ done: @escaping @MainActor (WKContentRuleList?) -> Void) {
    if let compiled { return done(compiled) }
    let rules = """
      [{"trigger":{"url-filter":"^https?://","resource-type":["image","style-sheet","font","media","raw","svg-document","fetch"]},
        "action":{"type":"block"}}]
      """
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "otter-remote-images", encodedContentRuleList: rules) { list, _ in
      MainActor.assumeIsolated {
        compiled = list
        done(list)
      }
    }
  }
}

/** `cid:` images, asked of the app as WebKit wants them; a slow one doesn't hold up the text. */
final class InlineImages: NSObject, WKURLSchemeHandler {
  weak var view: OtterHtmlView?
  private var tasks: [String: WKURLSchemeTask] = [:]

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url,
          let cid = String(url.absoluteString.dropFirst(4)).removingPercentEncoding else {
      return task.didFailWithError(URLError(.badURL))
    }
    let requestId = UUID().uuidString
    tasks[requestId] = task
    view?.requestImage(cid: cid, requestId: requestId)
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
    tasks = tasks.filter { $0.value !== task }
  }

  func resolve(requestId: String, data: Data?, mimeType: String) {
    guard let task = tasks.removeValue(forKey: requestId), let url = task.request.url else { return }
    guard let data else { return task.didFailWithError(URLError(.resourceUnavailable)) }
    task.didReceive(URLResponse(url: url, mimeType: mimeType, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }
}

/** The content controller keeps its handlers; through this one it doesn't keep the view. */
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: WKScriptMessageHandler?
  init(_ target: WKScriptMessageHandler) { self.target = target }
  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.userContentController(controller, didReceive: message)
  }
}
