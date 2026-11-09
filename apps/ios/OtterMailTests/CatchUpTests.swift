import Foundation
import Testing
@testable import Otter_Mail

struct CatchUpTests {
    private func thread(_ id: String, unread: Bool = true, starred: Bool = false, labels: Set<String> = ["INBOX"],
                        mailbox: String = "me@example.com", date: Date = .now) -> MailThread {
        let message = Message(id: "\(id)-m", from: Person(name: "Ann", email: "ann@example.com"), to: [], cc: [], date: date,
                              text: "", html: nil, attachments: [], unread: unread, starred: starred, draft: false, headers: [:])
        return MailThread(id: id, mailbox: mailbox, subject: id, labels: labels, messages: [message])
    }

    @Test func queuesTheUnreadInTheListsOrder() {
        let inbox = [thread("c"), thread("b", unread: false), thread("a")]
        #expect(CatchUp.queue(inbox).map(\.id) == ["c", "a"])
        #expect(CatchUp.queue(inbox, passed: ["c"]).map(\.id) == ["a"])
        #expect(CatchUp.queue([thread("b", unread: false)]).isEmpty)
    }

    @Test func putsInvitationsBeforeTheMail() {
        let invite = CalendarEvent(eventId: "e", calendar: EventCalendar(id: "primary", name: "Me"), title: "Lunch",
                                   start: .now, end: .now, response: .needsAction)
        let items = CatchUp.items(invites: [invite], mail: [thread("a"), thread("b")])
        #expect(items.map(\.id) == ["invite/\(invite.id)", "mail/a", "mail/b"])
    }

    @Test func mapsTheAnswersToGooglesResponses() {
        #expect(CatchUp.Answer.allCases.map(\.title) == ["Accept", "Decline", "Maybe"])
        #expect(CatchUp.Answer.accept.response.rawValue == "accepted")
        #expect(CatchUp.Answer.decline.response.rawValue == "declined")
        #expect(CatchUp.Answer.maybe.response.rawValue == "tentative")
    }

}
