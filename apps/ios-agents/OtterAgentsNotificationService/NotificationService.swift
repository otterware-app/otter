import Foundation
import UserNotifications

nonisolated final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private var work: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var completion: NotificationCompletion<UNNotificationContent>?
    private var fallback: UNNotificationContent?
    private var original: UNNotificationContent?
    private var configuration: AgentNotificationState.Configuration?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        serviceExtensionTimeWillExpire()
        let gate = NotificationCompletion(contentHandler)
        completion = gate
        fallback = request.content
        original = request.content
        configuration = nil
        guard let metadata = request.content.userInfo["otter"] as? [String: Any],
              let configuration = AgentNotificationState.configuration(),
              let pointer = AgentNotification.pointer(metadata, configuration: configuration),
              let session = pointer.sessionKey else { gate.finish(request.content); return }
        self.configuration = configuration
        let content = request.content.mutableCopy() as! UNMutableNotificationContent
        Self.apply(AgentNotification.preview(pointer, configuration: configuration), to: content)
        content.threadIdentifier = configuration.userId + ":" + session
        fallback = content.copy() as? UNNotificationContent
        let original = NotificationOriginal(content)
        let unmodified = NotificationOriginal(request.content)
        work = Task { @MainActor in
            let detail = try? await AgentNotification.read(pointer, configuration: configuration)
            guard !Task.isCancelled, AgentNotificationState.configuration() == configuration else { gate.finish(unmodified.content); return }
            let enriched = original.content.mutableCopy() as! UNMutableNotificationContent
            Self.apply(AgentNotification.preview(pointer, configuration: configuration, detail: detail), to: enriched)
            gate.finish(enriched)
        }
        let running = work
        timeout = Task {
            do { try await Task.sleep(for: .seconds(22)) } catch { return }
            running?.cancel()
            gate.finish(AgentNotificationState.configuration() == configuration ? original.content : unmodified.content)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        work?.cancel()
        timeout?.cancel()
        if let fallback, let original {
            completion?.finish(configuration == nil || AgentNotificationState.configuration() == configuration ? fallback : original)
        }
    }

    private static func apply(_ preview: AgentNotification.Preview, to content: UNMutableNotificationContent) {
        content.title = preview.title
        content.subtitle = preview.subtitle
        content.body = preview.body
    }
}

nonisolated private final class NotificationOriginal: @unchecked Sendable {
    let content: UNNotificationContent
    init(_ content: UNNotificationContent) { self.content = content }
}
