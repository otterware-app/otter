import UserNotifications

/** An agent's alert, as a message from the agent (`AgentNotification`). */
nonisolated final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        // The system calls it once, from no particular thread.
        nonisolated(unsafe) let handler = contentHandler
        nonisolated(unsafe) let content = request.content
        Task { handler(await AgentNotification.fromAgent(content) ?? content) }
    }
}
