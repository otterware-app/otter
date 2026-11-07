import ExpoModulesCore

public final class OtterHtmlViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterHtmlView")

    View(OtterHtmlView.self) {
      Events("onHeight", "onLink", "onInlineImage")

      Prop("html") { (view: OtterHtmlView, html: String) in
        view.setHtml(html)
      }

      Prop("remoteImages") { (view: OtterHtmlView, allowed: Bool) in
        view.setRemoteImages(allowed)
      }

      AsyncFunction("resolveImage") { (view: OtterHtmlView, requestId: String, base64: String?, mimeType: String) in
        view.resolveImage(requestId: requestId, base64: base64, mimeType: mimeType)
      }
    }
  }
}
