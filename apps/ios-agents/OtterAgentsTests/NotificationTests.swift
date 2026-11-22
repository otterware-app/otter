import Foundation
import Testing
import UIKit
import UserNotifications
@testable import Otter_Agents

struct NotificationTests {
    @Test func whatAgentsNotifyAboutMatchesTheMac() {
        #expect(Account.AgentNotifications(rawValue: "needs-you") == .needsYou)
        #expect(Account.AgentNotifications.all.shows("finished"))
        #expect(!Account.AgentNotifications.needsYou.shows("finished"))
        #expect(Account.AgentNotifications.needsYou.shows("approval"))
        #expect(Account.AgentNotifications.needsYou.shows("message"))
        #expect(!Account.AgentNotifications.off.shows("question"))
    }

    @Test func theRelaysSilentPushClearsTheChatsAlertsOnly() async throws {
        let center = UNUserNotificationCenter.current()
        guard await center.notificationSettings().authorizationStatus == .authorized else { return }
        // In front, the app's delegate shows no alert of its own making: these are listed, as in the background.
        let delegate = center.delegate
        let listing = Listing()
        center.delegate = listing
        defer { center.delegate = delegate }
        for session in ["agent:main:otter:read", "agent:main:otter:unread"] {
            let content = UNMutableNotificationContent()
            content.title = "brokk"
            content.threadIdentifier = session
            try await center.add(UNNotificationRequest(identifier: "clear-test-\(session)", content: content, trigger: nil))
        }
        try await Task.sleep(for: .seconds(1))
        let ours = { await center.deliveredNotifications().map(\.request.identifier).filter { $0.hasPrefix("clear-test-") } }
        #expect(await ours().count == 2)
        let push: [AnyHashable: Any] = ["aps": ["content-available": 1],
                                        "otter": ["version": 1, "kind": "agent-clear", "userId": "u", "sessionKey": "agent:main:otter:read"]]
        let result = await AppDelegate().application(UIApplication.shared, didReceiveRemoteNotification: push)
        #expect(result == .newData)
        try await Task.sleep(for: .seconds(1))
        #expect(await ours() == ["clear-test-agent:main:otter:unread"])
        center.removeDeliveredNotifications(withIdentifiers: ["clear-test-agent:main:otter:unread"])
    }

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
        // Unsigned builds (CI) lack the entitlement, and iOS keeps the alert; signed, a tap reads the chat from it.
        if let message = await AgentNotification.fromAgent(push(named)) {
            #expect(message.userInfo["otter"] != nil)
        }
        #expect(AgentFaces.keys(agentId: "research", sessionKey: "agent:research:otter-mail:plan") == ["openclaw-research"])
        #expect(AgentFaces.keys(agentId: "varys", sessionKey: "varys:abc") == ["varys-varys", "hermes"])
    }
}

private final class Listing: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.list]
    }
}
