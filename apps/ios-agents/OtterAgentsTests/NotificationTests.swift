import Testing
@testable import Otter_Agents

struct NotificationTests {
    @Test func aPushPointsAtTheChatItOpens() {
        let pointer = AgentPointer(["kind": "approval", "agentId": "scout", "sessionKey": "agent:scout:otter-mail:plan", "approvalId": "ap-1"])
        #expect(pointer?.sessionKey == "agent:scout:otter-mail:plan")
        #expect(pointer?.approvalId == "ap-1")
        #expect(AgentPointer(["kind": "unknown", "agentId": "scout"]) == nil)
        #expect(AgentPointer(["kind": "message", "agentId": ""]) == nil)
    }
}
