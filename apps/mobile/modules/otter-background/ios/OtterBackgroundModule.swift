import BackgroundTasks
import ExpoModulesCore
import os

/**
 * The Swift app's `.backgroundTask(.appRefresh(…))`: iOS wakes the app every so
 * often (it picks the moment) and JS gets `onRefresh` to catch mail up; it
 * calls `complete` when done, or `onExpire` comes first when iOS wants the
 * time back. Registered at launch, as BGTaskScheduler requires.
 */
final class BackgroundRefresh {
  static let shared = BackgroundRefresh()
  static let log = Logger(subsystem: "dev.otterware.mail", category: "background")

  static var identifier: String? {
    (Bundle.main.object(forInfoDictionaryKey: "BGTaskSchedulerPermittedIdentifiers") as? [String])?.first
  }

  private let lock = NSLock()
  private var task: BGAppRefreshTask?
  private var delivered = false
  var emit: ((String, [String: Any]) -> Void)?

  func register() {
    guard let identifier = Self.identifier else { return }
    BGTaskScheduler.shared.register(forTaskWithIdentifier: identifier, using: .main) { task in
      guard let refresh = task as? BGAppRefreshTask else { task.setTaskCompleted(success: false); return }
      self.run(refresh)
    }
  }

  func schedule() {
    guard let identifier = Self.identifier else { return }
    let request = BGAppRefreshTaskRequest(identifier: identifier)
    request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
    do { try BGTaskScheduler.shared.submit(request) } catch {
      Self.log.error("Couldn't schedule the refresh: \(error.localizedDescription, privacy: .public)")
    }
  }

  private func run(_ refresh: BGAppRefreshTask) {
    Self.log.info("Background refresh started")
    schedule()
    lock.lock()
    task?.setTaskCompleted(success: false)
    task = refresh
    delivered = false
    lock.unlock()
    refresh.expirationHandler = { [weak self] in
      Self.log.info("Background refresh expired")
      self?.emit?("onExpire", [:])
      self?.complete(success: false)
    }
    deliver()
  }

  /** Hands a waiting task to JS once something listens. */
  func deliver() {
    lock.lock()
    let send = task != nil && !delivered && emit != nil
    if send { delivered = true }
    lock.unlock()
    if send { emit?("onRefresh", [:]) }
  }

  func complete(success: Bool) {
    lock.lock()
    let finished = task
    task = nil
    lock.unlock()
    guard let finished else { return }
    Self.log.info("Background refresh finished: \(success ? "ok" : "failed", privacy: .public)")
    finished.setTaskCompleted(success: success)
  }
}

public final class OtterBackgroundAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    BackgroundRefresh.shared.register()
    return true
  }

  public func applicationDidEnterBackground(_ application: UIApplication) {
    BackgroundRefresh.shared.schedule()
  }
}

public final class OtterBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterBackground")

    Events("onRefresh", "onExpire")

    OnStartObserving {
      BackgroundRefresh.shared.emit = { [weak self] name, body in self?.sendEvent(name, body) }
      BackgroundRefresh.shared.deliver()
    }

    OnStopObserving {
      BackgroundRefresh.shared.emit = nil
    }

    Function("schedule") {
      BackgroundRefresh.shared.schedule()
    }

    Function("complete") { (success: Bool) in
      BackgroundRefresh.shared.complete(success: success)
    }

    // What the Swift app kept in UserDefaults as JSON data, for the Expo app's first launch.
    Function("legacyDefaults") { (keys: [String]) -> [String: String] in
      var found: [String: String] = [:]
      for key in keys {
        if let data = UserDefaults.standard.data(forKey: key), let text = String(data: data, encoding: .utf8) {
          found[key] = text
        }
      }
      return found
    }
  }
}
