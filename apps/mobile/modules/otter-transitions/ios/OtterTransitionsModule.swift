import ExpoModulesCore
import UIKit

/**
 * apps/ios's `.navigationTransition(.zoom(sourceID:in:))` and
 * `.minimizingNavigationBar()` for react-native-screens' screens: a row
 * marks itself a zoom source by id (ZoomSource); a screen's ScreenTransition
 * finds its view controller and zooms from the source with its id, and
 * minimizes its navigation bar on scrolling down (iOS 27).
 */
public final class OtterTransitionsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterTransitions")

    View(ZoomSourceView.self) {
      Prop("zoomId") { (view: ZoomSourceView, id: String) in
        MainActor.assumeIsolated { view.zoomId = id }
      }
    }
  }
}

/** The rows on screen by id; weak, so a recycled or unmounted row drops out. */
@MainActor
enum ZoomSources {
  static let views = NSMapTable<NSString, UIView>.strongToWeakObjects()

  static func view(_ id: String) -> UIView? {
    guard let view = views.object(forKey: id as NSString), view.window != nil else { return nil }
    return view
  }
}

public final class ZoomSourceView: ExpoView {
  var zoomId: String? {
    didSet {
      if let oldValue, ZoomSources.views.object(forKey: oldValue as NSString) === self {
        ZoomSources.views.removeObject(forKey: oldValue as NSString)
      }
      if let zoomId { ZoomSources.views.setObject(self, forKey: zoomId as NSString) }
    }
  }
}
