import ExpoModulesCore
import WebKit

/**
 * The composer's body: the web's TipTap editor (composer.html, built by
 * scripts/build-composer.mts) in WebKit. It reports what's written and its
 * focus; the app sets content, focuses it and formats through it. The page
 * scrolls itself; the screen keeps it above the keyboard.
 */
public final class OtterComposerView: ExpoView, WKScriptMessageHandler, WKNavigationDelegate {
  let onReady = EventDispatcher()
  let onChange = EventDispatcher()
  let onFocusChange = EventDispatcher()

  private let webView: WKWebView
  private var ready = false
  private var pending: [String] = []

  public required init(appContext: AppContext? = nil) {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.dataDetectorTypes = []
    webView = WKWebView(frame: .zero, configuration: configuration)
    super.init(appContext: appContext)
    configuration.userContentController.add(self, name: "composer")
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.backgroundColor = .clear
    webView.scrollView.keyboardDismissMode = .interactive
    webView.navigationDelegate = self
    addSubview(webView)
    Self.hideFormAccessory(webView)
    if let url = Bundle(for: Self.self).url(forResource: "OtterComposer", withExtension: "bundle")
      .flatMap(Bundle.init(url:))?.url(forResource: "composer", withExtension: "html") {
      webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }
  }

  /**
   * WKWebView has no switches for two things the composer needs, so its content
   * view gets a subclass: no form bar (previous, next, done) over the keyboard,
   * the screen has its own formatting bar there; and the keyboard comes up when
   * the app focuses the editor, not only on a tap (as react-native-webview's
   * keyboardDisplayRequiresUserAction, through the same private selector; left
   * alone when WebKit no longer has it).
   */
  private static func hideFormAccessory(_ webView: WKWebView) {
    guard let content = webView.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
          let base = object_getClass(content) else { return }
    let name = "\(NSStringFromClass(base))_OtterComposer"
    var subclass: AnyClass? = NSClassFromString(name)
    if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
      let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
      class_addMethod(made, #selector(getter: UIResponder.inputAccessoryView), imp_implementationWithBlock(block), "@@:")
      let focus = NSSelectorFromString("_elementDidFocus:userIsInteracting:blurPreviousNode:activityStateChanges:userObject:")
      if let method = class_getInstanceMethod(base, focus) {
        typealias Focus = @convention(c) (AnyObject, Selector, UnsafeRawPointer, Bool, Bool, UInt64, AnyObject?) -> Void
        let original = unsafeBitCast(method_getImplementation(method), to: Focus.self)
        let override: @convention(block) (AnyObject, UnsafeRawPointer, Bool, Bool, UInt64, AnyObject?) -> Void = {
          view, node, _, blur, changes, object in original(view, focus, node, true, blur, changes, object)
        }
        class_addMethod(made, focus, imp_implementationWithBlock(override), method_getTypeEncoding(method))
      }
      objc_registerClassPair(made)
      subclass = made
    }
    if let subclass { object_setClass(content, subclass) }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    webView.frame = bounds
  }

  private func run(_ script: String) {
    guard ready else { return pending.append(script) }
    webView.evaluateJavaScript(script)
  }

  private static func literal(_ value: String) -> String {
    let data = (try? JSONSerialization.data(withJSONObject: [value])) ?? Data("[\"\"]".utf8)
    return String(data: data, encoding: .utf8).map { String($0.dropFirst().dropLast()) } ?? "\"\""
  }

  func setContent(_ html: String) { run("otterComposer.setContent(\(Self.literal(html)))") }
  func setPlaceholder(_ text: String) { run("otterComposer.setPlaceholder(\(Self.literal(text)))") }
  func focus(_ position: String) { run("otterComposer.focus(\(Self.literal(position)))") }
  func command(_ name: String) { run("otterComposer.command(\(Self.literal(name)))") }

  public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
    switch type {
    case "ready":
      ready = true
      for script in pending { webView.evaluateJavaScript(script) }
      pending = []
      onReady([:])
    case "change":
      onChange([
        "html": body["html"] as? String ?? "",
        "text": body["text"] as? String ?? "",
        "blank": body["blank"] as? Bool ?? true,
      ])
    case "focus":
      onFocusChange(["focused": body["focused"] as? Bool ?? false])
    default:
      break
    }
  }

  public func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
  ) {
    // Only the editor itself loads here; a pasted link never navigates it away.
    decisionHandler(action.request.url?.isFileURL == true ? .allow : .cancel)
  }
}
