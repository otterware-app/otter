import ExpoModulesCore
import UIKit
import UserNotifications

struct AgentNotificationFace: Record {
  @Field var key: String = ""
  @Field var mark: String = ""
  @Field var avatar: String?
  @Field var emoji: String?
}

private func agentsTopic() -> String? {
  guard let topic = Bundle.main.bundleIdentifier,
        topic == "dev.otterware.agents" || topic == "dev.otterware.agents.dev",
        Bundle.main.object(forInfoDictionaryKey: "NotificationAppGroup") as? String == "group.\(topic)" else { return nil }
  return topic
}

public final class OtterAgentNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterAgentNotifications")

    Function("pushConfig") { () -> [String: String]? in
      guard let topic = agentsTopic(),
            let environment = Bundle.main.object(forInfoDictionaryKey: "APNsEnvironment") as? String else { return nil }
      return ["topic": topic, "environment": environment == "development" ? "sandbox" : "production"]
    }

    AsyncFunction("setUser") { (id: String?) in
      await AgentPushNotifications.setUser(id)
    }

    AsyncFunction("clearSession") { (session: String) in
      await AgentPushNotifications.clear(session)
    }

    AsyncFunction("saveFaces") { (user: String, faces: [AgentNotificationFace]) in
      await AgentPushNotifications.saveFaces(faces, for: user)
    }
  }
}

@MainActor
private enum AgentPushNotifications {
  static let accountKey = "agent-notifications:user"

  static func setUser(_ id: String?) async {
    let preferences = UserDefaults.standard
    guard preferences.string(forKey: accountKey) != id else { return }
    preferences.set(id, forKey: accountKey)
    AgentFaceWriter.save([])
    let center = UNUserNotificationCenter.current()
    let stale = await center.deliveredNotifications().filter {
      let data = $0.request.content.userInfo
      let otter = data["otter"] as? [String: Any]
      if otter?["kind"] as? String == "agent" { return otter?["userId"] as? String != id }
      return data["agentNotification"] as? Bool == true && data["userId"] as? String != id
    }
    center.removeDeliveredNotifications(withIdentifiers: stale.map(\.request.identifier))
  }

  static func saveFaces(_ faces: [AgentNotificationFace], for id: String) {
    guard UserDefaults.standard.string(forKey: accountKey) == id else { return }
    AgentFaceWriter.save(faces.map {
      AgentFaceWriter.Face(key: $0.key, avatar: $0.avatar, emoji: $0.emoji, mark: $0.mark)
    })
  }

  static func clear(_ session: String) async {
    let center = UNUserNotificationCenter.current()
    let ids = await center.deliveredNotifications()
      .filter { $0.request.content.threadIdentifier == session }
      .map(\.request.identifier)
    if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
  }
}

public final class OtterAgentNotificationsSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completion: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard agentsTopic() != nil,
          let otter = userInfo["otter"] as? [String: Any], otter["kind"] as? String == "agent-clear",
          let user = otter["userId"] as? String, let session = otter["sessionKey"] as? String,
          user == UserDefaults.standard.string(forKey: AgentPushNotifications.accountKey) else {
      return completion(.noData)
    }
    Task { @MainActor in
      await AgentPushNotifications.clear(session)
      completion(.newData)
    }
  }
}
