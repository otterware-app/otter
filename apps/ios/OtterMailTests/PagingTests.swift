import Foundation
import Testing
@testable import Otter_Mail

struct PagingTests {
    private let day: TimeInterval = 86_400
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func thread(_ id: String, daysAgo: Double) -> MailThread {
        let message = Message(
            id: id,
            from: Person(name: "", email: "a@example.com"),
            to: [],
            cc: [],
            date: now.addingTimeInterval(-daysAgo * day),
            text: "",
            html: nil,
            attachments: [],
            unread: false,
            starred: false,
            draft: false,
            headers: [:]
        )
        return MailThread(id: id, mailbox: "me@example.com", subject: id, labels: [], messages: [message])
    }

    @Test func listStopsWherePagesReached() {
        var state = MailboxState()
        let page = [thread("a", daysAgo: 1), thread("b", daysAgo: 5)]
        state.paged("All Mail", next: "token-2", oldest: page.map(\.latest.date).min())

        #expect(state.pages["All Mail"] == "token-2")
        #expect(state.lists(thread("new", daysAgo: 0), in: "All Mail"))
        #expect(state.lists(thread("edge", daysAgo: 5), in: "All Mail"))
        #expect(!state.lists(thread("old", daysAgo: 90), in: "All Mail"))
        #expect(!state.unbounded("All Mail"))
    }

    @Test func nextPageAddsOlderMailToTheBottom() {
        var state = MailboxState()
        state.paged("All Mail", next: "token-2", oldest: now.addingTimeInterval(-5 * day))
        state.paged("All Mail", next: "token-3", oldest: now.addingTimeInterval(-30 * day))

        #expect(state.pages["All Mail"] == "token-3")
        #expect(state.lists(thread("older", daysAgo: 20), in: "All Mail"))
        #expect(!state.lists(thread("oldest", daysAgo: 90), in: "All Mail"))
    }

    @Test func listNeverShrinks() {
        var state = MailboxState()
        state.paged("Inbox", next: "token-2", oldest: now.addingTimeInterval(-30 * day))
        state.paged("Inbox", next: "token-3", oldest: now.addingTimeInterval(-2 * day))

        #expect(state.lists(thread("t", daysAgo: 20), in: "Inbox"))
    }

    @Test func everythingListsOnceThePagesEnd() {
        var state = MailboxState()
        state.paged("Inbox", next: "token-2", oldest: now.addingTimeInterval(-5 * day))
        state.paged("Inbox", next: nil, oldest: now.addingTimeInterval(-10 * day))

        #expect(state.pages["Inbox"] == "")
        #expect(state.lists(thread("ancient", daysAgo: 900), in: "Inbox"))
        #expect(!state.unbounded("Inbox"))
    }

    @Test func unpagedFolderShowsItsCacheUntilAPageSaysWhereItEnds() {
        var state = MailboxState()
        #expect(state.unbounded("Starred"))
        #expect(state.lists(thread("cached", daysAgo: 90), in: "Starred"))

        // An empty page moves the cursor on (so the list asks for the next) but can't bound it.
        state.paged("Starred", next: "token-2", oldest: nil)
        #expect(state.pages["Starred"] == "token-2")
        #expect(state.unbounded("Starred"))
        #expect(state.lists(thread("cached", daysAgo: 90), in: "Starred"))
    }

    @Test func foldersPageSeparately() {
        var state = MailboxState()
        state.paged("Inbox", next: "token-2", oldest: now.addingTimeInterval(-5 * day))

        #expect(state.unbounded("All Mail"))
        #expect(state.lists(thread("old", daysAgo: 90), in: "All Mail"))
        #expect(!state.lists(thread("old", daysAgo: 90), in: "Inbox"))
    }

    @Test func cacheFromBeforeDecodes() throws {
        let saved = Data(#"{"draftIDs":{},"pages":{"Inbox":"token-2"},"historyID":"42"}"#.utf8)
        let state = try JSONDecoder().decode(MailboxState.self, from: saved)

        #expect(state.pages["Inbox"] == "token-2")
        #expect(state.reached == nil)
        #expect(state.unbounded("Inbox"))
    }
}
