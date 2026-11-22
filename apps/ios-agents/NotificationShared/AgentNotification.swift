import Intents
import UserNotifications

/**
 * An agent's alert, as a message from the agent (Messages' layout): its picture, which the app
 * left in the app group (`AgentFaces`), with the app's icon on it, and the chat as the
 * conversation. Nil when the push doesn't say who it's from: the relay's alert stays.
 */
nonisolated enum AgentNotification {
    static func fromAgent(_ content: UNNotificationContent) async -> UNNotificationContent? {
        guard let otter = content.userInfo["otter"] as? [String: Any], otter["kind"] as? String == "agent",
              let pointer = otter["pointer"] as? [String: Any], let agentId = pointer["agentId"] as? String,
              let name = pointer["agentName"] as? String, !name.isEmpty else { return nil }
        let session = pointer["sessionKey"] as? String
        let key = AgentFaces.keys(agentId: agentId, sessionKey: session)
            .first { $0 == AgentFaces.hermes || AgentFaces.file($0).map { FileManager.default.fileExists(atPath: $0.path(percentEncoded: false)) } == true }
        let picture = key.flatMap(AgentFaces.file).flatMap { try? Data(contentsOf: $0) }.map(INImage.init(imageData:))
        let sender = INPerson(personHandle: INPersonHandle(value: key ?? agentId, type: .unknown), nameComponents: nil,
                              displayName: name, image: picture, contactIdentifier: nil, customIdentifier: key ?? agentId)
        // A named conversation is a group: the agent and you.
        let chat = (pointer["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let me = INPerson(personHandle: INPersonHandle(value: "me", type: .unknown), nameComponents: nil, displayName: nil,
                          image: nil, contactIdentifier: nil, customIdentifier: nil, isMe: true)
        let intent = INSendMessageIntent(recipients: chat == nil ? nil : [me, sender], outgoingMessageType: .outgoingMessageText,
                                         content: content.body, speakableGroupName: chat.map(INSpeakableString.init(spokenPhrase:)),
                                         conversationIdentifier: session, serviceName: nil, sender: sender, attachments: nil)
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
}
