import Foundation

/**
 * Where the app leaves each agent's picture for its notifications, a PNG per agent a push can
 * come from, keyed as the app finds a push's agent (`Account.candidates`): an OpenClaw session's
 * own agent, varys by its id, else Hermes.
 */
nonisolated enum AgentFaces {
    static var directory: URL? {
        let group = Bundle.main.object(forInfoDictionaryKey: "NotificationAppGroup") as? String ?? ""
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?
            .appending(path: "AgentFaces", directoryHint: .isDirectory)
    }

    static func openClaw(_ gatewayAgent: String) -> String { "openclaw-" + gatewayAgent }
    static func varys(_ agentId: String) -> String { "varys-" + agentId }
    static let hermes = "hermes"

    /** The pictures a push's agent may have, the likeliest first. */
    static func keys(agentId: String, sessionKey: String?) -> [String] {
        if sessionKey?.hasPrefix("agent:") == true { return [openClaw(agentId)] }
        return [varys(agentId), hermes]
    }

    static func file(_ key: String) -> URL? {
        directory?.appending(path: key.replacingOccurrences(of: "/", with: "_") + ".png", directoryHint: .notDirectory)
    }
}
