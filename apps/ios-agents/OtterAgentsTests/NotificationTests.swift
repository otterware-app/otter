import Foundation
import Testing
@testable import Otter_Agents

@MainActor
struct NotificationTests {
    private let session = "agent:scout:otter-mail:plan"

    private var configuration: AgentNotificationState.Configuration {
        .init(userId: "demo-user", titles: [session: "Plan the Lisbon offsite"], agentNames: ["scout": "Scout"])
    }

    private func pointer(_ kind: String = "finished", session: String? = nil, id: String = "ask-1") -> AgentPointer {
        AgentPointer(["kind": kind, "agentId": "scout", "sessionKey": session ?? self.session, "approvalId": id, "questionId": id])!
    }

    @Test func completionNamesTheChatAndPreviewsTheAnswer() async throws {
        let detail = try await AgentNotification.openClaw(pointer()) { method, params in
            #expect(method == "chat.history")
            #expect(params["sessionKey"] as? String == session)
            return ["messages": [
                ["role": "user", "content": "Compare the venues."],
                ["role": "assistant", "content": [["type": "thinking", "thinking": "Private reasoning"], ["type": "text", "text": "## Recommendation\nBook **Casa do Pátio**. It fits the team and is €240 under budget."]]],
            ]]
        }
        let preview = AgentNotification.preview(pointer(), configuration: configuration, detail: detail)
        #expect(preview.title == "Plan the Lisbon offsite")
        #expect(preview.subtitle == "Scout · Finished")
        #expect(preview.body == "Recommendation Book Casa do Pátio. It fits the team and is €240 under budget.")
    }

    @Test func anUnreachableAgentStillNamesTheChatAndStatus() {
        let preview = AgentNotification.preview(pointer(), configuration: configuration)
        #expect(preview.title == "Plan the Lisbon offsite")
        #expect(preview.subtitle == "Scout · Finished")
        #expect(preview.body == "Open the chat to read the reply.")
        let newChat = AgentNotification.preview(pointer(session: "agent:scout:new"), configuration: configuration, detail: .init(title: "Morning brief", text: "Your day is clear."))
        #expect(newChat.title == "Morning brief")
        #expect(newChat.subtitle == "Scout · Finished")
    }

    @Test func questionsMatchBothTheRequestAndTheSession() async throws {
        let p = pointer("question")
        let question: [String: Any] = ["id": "ask-1", "sessionKey": session, "status": "pending", "questions": [["question": "Which dates work for the team?"]]]
        let detail = try await AgentNotification.openClaw(p) { method, _ in
            #expect(method == "question.list")
            return ["questions": [question]]
        }
        #expect(AgentNotification.preview(p, configuration: configuration, detail: detail).body == "Which dates work for the team?")
        let wrong = try await AgentNotification.openClaw(pointer("question", id: "other")) { _, _ in ["questions": [question]] }
        #expect(wrong?.text == nil)
        let anotherChat = try await AgentNotification.openClaw(pointer("question", session: "agent:scout:other")) { _, _ in ["questions": [question]] }
        #expect(anotherChat?.text == nil)
    }

    @Test func approvalsShowTheMatchingProposedAction() async throws {
        let p = pointer("approval")
        let detail = try await AgentNotification.openClaw(p) { method, _ in
            #expect(method == "sessions.messages.subscribe")
            return ["approvalReplay": ["approvals": [
                ["id": "other", "status": "pending", "presentation": ["commandText": "A different command"]],
                ["id": "ask-1", "status": "pending", "presentation": ["kind": "plugin", "description": "Send the venue booking request to Maria."]],
            ]]]
        }
        let preview = AgentNotification.preview(p, configuration: configuration, detail: detail)
        #expect(preview.subtitle == "Scout · Approval needed")
        #expect(preview.body == "Send the venue booking request to Maria.")
    }

    @Test func olderGatewaysUseTheExecApprovalList() async throws {
        let detail = try await AgentNotification.openClaw(pointer("approval")) { method, _ in
            if method == "sessions.messages.subscribe" { throw URLError(.unsupportedURL) }
            #expect(method == "exec.approval.list")
            return [["id": "ask-1", "request": ["sessionKey": session, "command": "pnpm test"]]]
        }
        #expect(detail?.text == "pnpm test")
    }

    @Test func anotherAccountOrAnInvalidPointerCannotReadAPreview() {
        let metadata: [String: Any] = ["version": 1, "kind": "agent", "userId": "demo-user", "pointer": ["kind": "finished", "agentId": "scout", "sessionKey": session]]
        #expect(AgentNotification.pointer(metadata, configuration: configuration) != nil)
        #expect(AgentNotification.pointer(metadata, configuration: .init(userId: "another-user")) == nil)
        #expect(AgentNotification.pointer(metadata, configuration: nil) == nil)
        var invalid = metadata
        invalid["pointer"] = ["kind": "finished", "agentId": "scout"]
        #expect(AgentNotification.pointer(invalid, configuration: configuration) == nil)
        #expect(AgentPointer(["kind": "unknown", "agentId": "scout"]) == nil)
    }

    @Test func varysReadsTheTitleFromTheThreadView() throws {
        let p = pointer(session: "thread-1")
        let view = try Varys.JSON(parsing: Data(#"{"id":"thread-1","title":"Morning brief","conversation":{"items":[{"type":"answer","text":"Your day is clear."}]}}"#.utf8))
        let detail = AgentNotification.varys(p, view: view)
        let preview = AgentNotification.preview(p, configuration: .init(userId: "demo-user", varysAgentId: "scout"), detail: detail)
        #expect(preview.title == "Morning brief")
        #expect(preview.subtitle == "varys · Finished")
        #expect(preview.body == "Your day is clear.")
    }

    @Test func previewsAreReadableAndBoundedAndCompleteOnlyOnce() {
        #expect(AgentNotification.plain("Read [the plan](https://example.test).\n- **Ready**", limit: 500) == "Read the plan. Ready")
        let long = AgentNotification.preview(pointer(), configuration: configuration, detail: .init(text: String(repeating: "👩🏽‍💻", count: 600)))
        #expect(long.body.count == 500)
        #expect(long.body.hasSuffix("…"))
        #expect(AgentNotification.preview(pointer(), configuration: configuration, detail: .init(text: "NO_REPLY")).body == "Open the chat to read the reply.")
        var finished: [String] = []
        let completion = NotificationCompletion<String> { finished.append($0) }
        completion.finish("reply")
        completion.finish("timeout")
        #expect(finished == ["reply"])
    }
}
