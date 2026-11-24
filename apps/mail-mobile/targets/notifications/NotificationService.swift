import Foundation
import UserNotifications

final class NotificationService: UNNotificationServiceExtension, @unchecked Sendable {
    private var work: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var completion: NotificationCompletion<UNNotificationContent>?
    private var staged: StagedAlert?

    override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        serviceExtensionTimeWillExpire()
        let gate = NotificationCompletion(contentHandler)
        completion = gate
        staged = StagedAlert(request.content)
        if let info = request.content.userInfo["otter"] as? [String: Any], info["version"] as? Int == 2 {
            enrichVerified(request.content, metadata: info, gate: gate)
            return
        }
        gate.finish(request.content)
    }

    override func serviceExtensionTimeWillExpire() {
        work?.cancel()
        timeout?.cancel()
        if let staged { completion?.finish(staged.content) }
    }

    private func enrichVerified(_ fallback: UNNotificationContent, metadata: [String: Any], gate: NotificationCompletion<UNNotificationContent>) {
        guard let data = try? JSONSerialization.data(withJSONObject: metadata),
              let event = try? JSONDecoder().decode(VerifiedNotification.Metadata.self, from: data),
              PushState.permits(userId: event.userId, email: event.email) else { gate.finish(fallback); return }
        let staged = staged ?? StagedAlert(fallback)
        work = Task {
            do {
                let verified = try await PushState.locked("notification:" + event.email) { () async throws -> (UNMutableNotificationContent, String?, PushState.Configuration)? in
                    guard let config = PushState.configuration(), config.userId == event.userId else { return nil }
                    let message = try await VerifiedNotification.enrich(event, configuration: config)
                    try Task.checkCancellation()
                    guard PushState.configuration() == config, let message else { return nil }
                    let content = staged.original.mutableCopy() as! UNMutableNotificationContent
                    content.title = String(message.sender.prefix(200))
                    if content.title.isEmpty { content.title = "New mail" }
                    content.subtitle = PushState.subtitle(String(message.subject.prefix(300)), mailbox: config.name(event.email, alias: message.alias))
                    content.body = String(message.preview.prefix(500))
                    content.sound = .default
                    content.threadIdentifier = event.email + ":" + (message.threadId ?? message.id)
                    content.userInfo["mailbox"] = message.alias?.id ?? event.email
                    content.userInfo["message"] = message.id
                    if let thread = message.threadId { content.userInfo["thread"] = thread }
                    // Ready: the deadline delivers it from now on.
                    staged.stage(content, while: config)
                    return (content, message.address, config)
                }
                guard let (content, address, config) = verified else { gate.finish(staged.original); return }
                var shown: UNNotificationContent = content
                if let address, let fromSender = MailNotification.fromSender(content, name: content.title, address: address) {
                    shown = fromSender
                }
                gate.finish(PushState.configuration() == config ? shown : staged.original)
            } catch { gate.finish(staged.content) }
        }
        let running = work
        timeout = Task {
            do { try await Task.sleep(for: .seconds(22)) } catch { return }
            running?.cancel()
            gate.finish(staged.content)
        }
    }
}

/** The push's own alert, until a verified one is ready: shown while the mailbox's settings still allow it. */
private final class StagedAlert: @unchecked Sendable {
    let original: UNNotificationContent
    private let lock = NSLock()
    private var verified: (content: UNNotificationContent, config: PushState.Configuration)?

    init(_ original: UNNotificationContent) { self.original = original }

    func stage(_ content: UNNotificationContent, while config: PushState.Configuration) {
        lock.lock(); defer { lock.unlock() }
        verified = (content, config)
    }

    var content: UNNotificationContent {
        lock.lock()
        let verified = verified
        lock.unlock()
        guard let verified, PushState.configuration() == verified.config else { return original }
        return verified.content
    }
}
