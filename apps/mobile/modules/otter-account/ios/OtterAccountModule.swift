import AuthenticationServices
import ExpoModulesCore
import StoreKit

/**
 * apps/ios's WelcomeView's AppTransaction check (the demo is offered outside
 * the App Store) and its NotificationAuthorization: the limited provider
 * consent for background notifications, back on a custom scheme.
 */
public final class OtterAccountModule: Module {
  private var session: ASWebAuthenticationSession?
  private let anchor = Anchor()

  public func definition() -> ModuleDefinition {
    Name("OtterAccount")

    AsyncFunction("storeEnvironment") { () async -> String in
      guard let result = try? await AppTransaction.shared else { return "unknown" }
      let environment = switch result {
      case .verified(let transaction), .unverified(let transaction, _): transaction.environment
      }
      return environment.rawValue
    }

    AsyncFunction("authorize") { (url: URL, scheme: String, promise: Promise) in
      let session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme)) { [weak self] callback, error in
        self?.session = nil
        if let callback { promise.resolve(callback.absoluteString) }
        else if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin { promise.resolve(nil) }
        else { promise.reject("ERR_AUTHORIZE", error?.localizedDescription ?? "Notification setup was cancelled.") }
      }
      session.presentationContextProvider = anchor
      self.session = session
      session.start()
    }.runOnQueue(.main)
  }
}

private final class Anchor: NSObject, ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor(windowScene: scenes[0])
  }
}
