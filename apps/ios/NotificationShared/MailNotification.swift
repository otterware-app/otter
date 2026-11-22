import Intents
import UIKit
import UserNotifications

/**
 * New mail, as a message from its sender (Messages' layout): their photo or initial, as the inbox
 * shows them (`SenderPhotos`, `SenderAvatar`), with the app's icon on it, and the subject as the
 * conversation. Nil when it can't be: the alert stays as it is.
 */
nonisolated enum MailNotification {
    /** How long the photo may take: the extension's time is for the mail first. */
    static let photoBudget: Duration = .seconds(4)

    static func fromSender(_ content: UNNotificationContent, name: String, address: String) async -> UNNotificationContent? {
        let photo = await within(photoBudget) { await SenderPhotos.shared.photo(for: address)?.pngData() }
        let picture = (photo.flatMap(UIImage.init(data:)).map(onWhite) ?? initial(name, address)).pngData().map(INImage.init(imageData:))
        let sender = INPerson(personHandle: INPersonHandle(value: address, type: .emailAddress), nameComponents: nil,
                              displayName: name, image: picture, contactIdentifier: nil, customIdentifier: address)
        // A message alone drops the subtitle: the subject is the conversation, a group of the sender and you.
        let subject = content.subtitle.isEmpty ? nil : content.subtitle
        let me = INPerson(personHandle: INPersonHandle(value: "me", type: .unknown), nameComponents: nil, displayName: nil,
                          image: nil, contactIdentifier: nil, customIdentifier: nil, isMe: true)
        let intent = INSendMessageIntent(recipients: subject == nil ? nil : [me, sender], outgoingMessageType: .outgoingMessageText,
                                         content: content.body, speakableGroupName: subject.map(INSpeakableString.init(spokenPhrase:)),
                                         conversationIdentifier: content.threadIdentifier, serviceName: nil, sender: sender, attachments: nil)
        if let picture { intent.setImage(picture, forParameterNamed: \.sender) }
        let interaction = INInteraction(intent: intent, response: nil)
        interaction.direction = .incoming
        do {
            try await interaction.donate()
            return try content.updating(from: intent)
        } catch {
            return nil
        }
    }

    private static let side: CGFloat = 256
    private static func format() -> UIGraphicsImageRendererFormat {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return format
    }

    /** Transparent logos need a white backing. */
    private static func onWhite(_ photo: UIImage) -> UIImage {
        let scale = max(side / photo.size.width, side / photo.size.height)
        let size = CGSize(width: photo.size.width * scale, height: photo.size.height * scale)
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format()).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
            photo.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
    }

    /** The name's initial on the address's color, as the inbox draws a sender without a photo. */
    private static func initial(_ name: String, _ address: String) -> UIImage {
        var hash: Int32 = 0
        for unit in address.trimmingCharacters(in: .whitespaces).lowercased().utf16 { hash = hash &* 31 &+ Int32(unit) }
        let hue = CGFloat(((Int(hash) % 360) + 360) % 360) / 360
        let letter = String(name.prefix(1)).uppercased() as NSString
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format()).image { context in
            UIColor(hue: hue, saturation: 0.614, brightness: 0.75, alpha: 1).setFill()
            context.fill(CGRect(x: 0, y: 0, width: side, height: side))
            let attributes: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: side * 0.42, weight: .medium),
                                                             .foregroundColor: UIColor.white]
            let size = letter.size(withAttributes: attributes)
            letter.draw(at: CGPoint(x: (side - size.width) / 2, y: (side - size.height) / 2), withAttributes: attributes)
        }
    }

    /** The work's answer, or nil once the time is up (the work goes on, unheard). */
    private static func within(_ limit: Duration, _ work: @escaping @Sendable () async -> Data?) async -> Data? {
        let first = First()
        return await withCheckedContinuation { continuation in
            first.continuation = continuation
            Task { first.resume(await work()) }
            Task {
                try? await Task.sleep(for: limit)
                first.resume(nil)
            }
        }
    }

    private final class First: @unchecked Sendable {
        private let lock = NSLock()
        var continuation: CheckedContinuation<Data?, Never>?

        func resume(_ value: Data?) {
            lock.lock()
            let pending = continuation
            continuation = nil
            lock.unlock()
            pending?.resume(returning: value)
        }
    }
}
