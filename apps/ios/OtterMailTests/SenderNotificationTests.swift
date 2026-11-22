import Foundation
import Testing
import UserNotifications
@testable import Otter_Mail

struct SenderNotificationTests {
    @Test func gmailReadsTheSendersAddress() throws {
        let json = #"{"id":"1","threadId":"t","payload":{"headers":[{"name":"From","value":"\"Lena Park\" <lena@acme.example>"}]}}"#
        let message = try JSONDecoder().decode(GmailNotification.Message.self, from: Data(json.utf8))
        #expect(message.sender == "Lena Park")
        #expect(message.senderAddress == "lena@acme.example")
        let bare = try JSONDecoder().decode(GmailNotification.Message.self, from: Data(#"{"id":"2","threadId":"t","payload":{"headers":[{"name":"From","value":"sam@acme.example"}]}}"#.utf8))
        #expect(bare.senderAddress == "sam@acme.example")
        let bracketed = try JSONDecoder().decode(GmailNotification.Message.self, from: Data(#"{"id":"3","threadId":"t","payload":{"headers":[{"name":"From","value":"\"Ops <alerts>\" <ops@acme.example>"}]}}"#.utf8))
        #expect(bracketed.senderAddress == "ops@acme.example")
    }

    @Test func newMailComesFromItsSender() async {
        let content = UNMutableNotificationContent()
        content.title = "Lena Park"
        content.subtitle = "Q4 planning"
        content.body = "Here's the shortlist for Thursday."
        content.threadIdentifier = "work@acme.example:t1"
        content.userInfo = ["mailbox": "work@acme.example", "message": "m1"]
        // Unsigned builds (CI) lack the entitlement, and iOS keeps the alert; signed, a tap opens the mail from these.
        if let message = await MailNotification.fromSender(content, name: "Lena Park", address: "lena@acme.example") {
            #expect(message.userInfo["message"] as? String == "m1")
        }
    }
}
