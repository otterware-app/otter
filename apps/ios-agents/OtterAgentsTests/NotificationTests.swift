import Foundation
import Testing
import UserNotifications
@testable import Otter_Agents

struct NotificationTests {
    @Test func aPushPointsAtTheChatItOpens() {
        let pointer = AgentPointer(["kind": "approval", "agentId": "scout", "sessionKey": "agent:scout:otter-mail:plan", "approvalId": "ap-1"])
        #expect(pointer?.sessionKey == "agent:scout:otter-mail:plan")
        #expect(pointer?.approvalId == "ap-1")
        #expect(pointer?.resolved == false)
        let resolved = AgentPointer(["kind": "approval", "agentId": "scout", "sessionKey": "agent:scout:otter-mail:plan", "approvalId": "ap-1", "resolved": true])
        #expect(resolved?.resolved == true)
        #expect(AgentPointer(["kind": "unknown", "agentId": "scout"]) == nil)
        #expect(AgentPointer(["kind": "message", "agentId": ""]) == nil)
    }

    @Test func presenceAndSentOriginMessagesIdentifyIos() throws {
        let watching = try #require(Relay.watchingMessage("agent:scout:otter-mail:plan"))
        let watchJson = try #require(try JSONSerialization.jsonObject(with: Data(watching.utf8)) as? [String: Any])
        #expect(watchJson["type"] as? String == "watching")
        #expect(watchJson["session"] as? String == "agent:scout:otter-mail:plan")
        #expect(watchJson["device"] as? String == "ios")

        let sent = try #require(Relay.sentMessage("agent:scout:otter-mail:plan", at: 1_700_000_000_000))
        let sentJson = try #require(try JSONSerialization.jsonObject(with: Data(sent.utf8)) as? [String: Any])
        #expect(sentJson["type"] as? String == "sent")
        #expect(sentJson["session"] as? String == "agent:scout:otter-mail:plan")
        #expect(sentJson["device"] as? String == "ios")
        #expect(sentJson["at"] as? Int == 1_700_000_000_000)
        #expect(Relay.sentMessage("") == nil)
    }

    private func push(_ pointer: [String: Any]) -> UNNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = "Scout · Plan the Lisbon offsite"
        content.body = "Asks a question"
        content.userInfo = ["otter": ["version": 1, "kind": "agent", "userId": "u", "pointer": pointer]]
        return content
    }

    @Test func anAgentsAlertComesFromTheAgentWhenThePushNamesIt() async {
        let pointer: [String: Any] = ["kind": "question", "agentId": "research", "sessionKey": "agent:research:otter-mail:plan", "title": "Plan the Lisbon offsite"]
        #expect(await AgentNotification.fromAgent(push(pointer)) == nil)
        var named = pointer
        named["agentName"] = "Scout"
        let message = await AgentNotification.fromAgent(push(named))
        // A tap reads the chat from it.
        #expect(message?.userInfo["otter"] != nil)
        #expect(AgentFaces.keys(agentId: "research", sessionKey: "agent:research:otter-mail:plan") == ["openclaw-research"])
        #expect(AgentFaces.keys(agentId: "varys", sessionKey: "varys:abc") == ["varys-varys", "hermes"])
    }
}
