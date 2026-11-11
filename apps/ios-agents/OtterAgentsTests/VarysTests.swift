import Foundation
import Testing
@testable import Otter_Agents

@MainActor
struct VarysTests {
    @Test func readsThePairingLinkAndTakesOnlyHTTPSOrThisDevice() throws {
        let link = try #require(Varys.pairingLink(" https://mac.tail1234.ts.net/pair#code=ABCD-EFGH&agent=a1 \n"))
        #expect(link.address == "https://mac.tail1234.ts.net")
        #expect(link.code == "ABCD-EFGH")
        #expect(link.agentId == "a1")
        #expect(Varys.pairingLink("https://mac.tail1234.ts.net/settings#code=A&agent=a1") == nil)
        #expect(Varys.pairingLink("https://mac.tail1234.ts.net/pair#code=A") == nil)
        #expect(Varys.origin("http://localhost:8291/") == "http://localhost:8291")
        #expect(Varys.origin("http://mac.tail1234.ts.net") == nil)
        #expect(Varys.origin("https://mac.tail1234.ts.net/anything") == "https://mac.tail1234.ts.net")
    }

    @Test func showsAThreadsMessagesRepliesAndReportsButNotWhatTheAgentWasToldAside() {
        let items: [Varys.JSON] = [
            .object(["type": .string("message"), "id": .string("1"), "text": .string("Find a venue")]),
            .object(["type": .string("answer"), "id": .string("2"), "text": .string("Cedar Hall is free."),
                     "calls": .array([.object(["id": .string("c1"), "tool": .string("web_search"), "summary": .string("")])])]),
            .object(["type": .string("result"), "id": .string("3"), "callId": .string("c1"), "text": .string("[]")]),
            .object(["type": .string("note"), "id": .string("4"), "text": .string("The owner answered: Friday")]),
            .object(["type": .string("note"), "id": .string("5"), "text": .string("Invoices: 2 new"), "from": .object(["threadId": .string("t2")])]),
        ]
        let messages = Varys.messages(items)
        #expect(messages.map(\.role) == ["user", "assistant", "assistant"])
        #expect(messages[1].tools == ["Web search"])
        #expect(messages[2].text == "Invoices: 2 new")
    }

    @Test func handsVarysPointersToTheMailNeverTheMail() {
        let mail = MailContext(account: "me@example.com", threadID: "t1", subject: "Dinner Saturday?", from: "maya@example.com", messageIDs: ["m1"])
        let sent = MailContext.handoff("Draft a reply", [mail], reader: "your mail connection")
        #expect(sent.hasPrefix("Draft a reply\n\n— context from Otter Mail —"))
        #expect(sent.contains("[me@example.com] \"Dinner Saturday?\" — from maya@example.com (threadId t1, message m1)"))
        #expect(sent.hasSuffix("Fetch full content with your mail connection if needed."))
    }
}
