import ExpoModulesCore

public final class OtterComposerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterComposer")

    View(OtterComposerView.self) {
      Events("onReady", "onChange", "onFocusChange")

      Prop("placeholder") { (view: OtterComposerView, text: String) in
        view.setPlaceholder(text)
      }

      AsyncFunction("setContent") { (view: OtterComposerView, html: String) in
        view.setContent(html)
      }

      AsyncFunction("focus") { (view: OtterComposerView, position: String) in
        view.focus(position)
      }

      AsyncFunction("command") { (view: OtterComposerView, name: String) in
        view.command(name)
      }
    }
  }
}
