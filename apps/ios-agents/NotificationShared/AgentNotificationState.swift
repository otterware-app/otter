import Foundation

nonisolated enum AgentNotificationState {
    struct Configuration: Codable, Equatable, Sendable {
        var userId: String
        var hermesURL: String?
        var openClawURL: String?
        var varysAddress: String?
        var varysAgentId: String?
        var titles: [String: String] = [:]
        var agentNames: [String: String] = [:]
    }

    static func configuration() -> Configuration? {
        guard let value = Keychain.get("notification-configuration") else { return nil }
        return try? JSONDecoder().decode(Configuration.self, from: Data(value.utf8))
    }

    static func configure(_ configuration: Configuration?) {
        let value = configuration.flatMap { try? JSONEncoder().encode($0) }.flatMap { String(data: $0, encoding: .utf8) }
        Keychain.set("notification-configuration", value, thisDeviceOnly: true)
    }
}
