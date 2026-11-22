import UserNotifications

/** An agent's alert, as a message from the agent (`AgentNotification`). */
nonisolated final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        contentHandler(AgentNotification.fromAgent(request.content) ?? request.content)
    }
}
