import ExpoModulesCore
import UIKit

public final class ScreenTransitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterScreenTransition")

    View(ScreenTransitionView.self) {
      Prop("zoomId") { (view: ScreenTransitionView, id: String?) in
        MainActor.assumeIsolated {
          view.zoomId = id
          view.apply()
        }
      }
      Prop("minimizeBar") { (view: ScreenTransitionView, on: Bool) in
        MainActor.assumeIsolated {
          view.minimizeBar = on
          view.apply()
        }
      }
    }
  }
}

/** Sets its screen's transition and bar; it shows nothing. */
public final class ScreenTransitionView: ExpoView {
  var zoomId: String?
  var minimizeBar = false

  public override func didMoveToSuperview() {
    super.didMoveToSuperview()
    apply()
  }

  public override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    apply()
  }

  /** The screen's view controller: react-native-screens' RNSScreen, whose view holds this one. */
  private var screen: UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  func apply() {
    guard let screen else { return }
    if let id = zoomId, !UIAccessibility.isReduceMotionEnabled {
      if #available(iOS 18.0, *) {
        screen.preferredTransition = .zoom { _ in ZoomSources.view(id) }
      }
    }
    if #available(iOS 27.0, *) {
      screen.navigationItem.navigationBarMinimization.minimizationBehavior = minimizeBar ? .onScrollDown : .never
    }
  }
}
