import ExpoModulesCore

public final class OtterComposerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterComposer")

    View(OtterComposerView.self) {
      Events("onReady", "onEdit", "onFocusChange")

      Prop("placeholder") { (view: OtterComposerView, text: String) in
        view.setPlaceholder(text)
      }

      AsyncFunction("setContent") { (view: OtterComposerView, html: String) in
        view.setContent(html)
      }

      AsyncFunction("focus") { (view: OtterComposerView, position: String) in
        view.focus(position)
      }

      AsyncFunction("setSignature") { (view: OtterComposerView, html: String?) in
        view.setSignature(html)
      }
      AsyncFunction("command") { (view: OtterComposerView, name: String) in
        view.command(name)
      }

      AsyncFunction("snapshot") { (view: OtterComposerView, promise: Promise) in
        view.snapshot(promise)
      }
    }
  }
}
