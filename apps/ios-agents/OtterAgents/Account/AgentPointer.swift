import Foundation

nonisolated struct AgentPointer: Equatable, Sendable {
    var kind: String
    var agentId: String
    var sessionKey: String?
    var approvalId: String?
    var questionId: String?

    init?(_ object: [String: Any]) {
        guard let agentId = object["agentId"] as? String, !agentId.isEmpty,
              let kind = object["kind"] as? String,
              ["message", "finished", "approval", "question"].contains(kind) else { return nil }
        self.kind = kind
        self.agentId = agentId
        sessionKey = object["sessionKey"] as? String
        approvalId = object["approvalId"] as? String
        questionId = object["questionId"] as? String
    }
}
