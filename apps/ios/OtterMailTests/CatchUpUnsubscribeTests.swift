import Foundation
import Testing
@testable import Otter_Mail

/**
 * Unsubscribing from a Catch up card: the conversation is archived and read,
 * so it stays gone after Catch up is opened again; a cleanup the server
 * refuses puts it back and keeps the card. No network: the demo store, or a
 * provider that answers (or refuses) here.
 */
@MainActor
struct CatchUpUnsubscribeTests {
    private let me = "me@gmail.com"

    private func thread(_ id: String, from sender: String = "news@list.example") -> MailThread {
        let message = Message(id: "\(id)-m", from: Person(name: "News", email: sender), to: [], cc: [], date: .now,
                              text: "", html: nil, attachments: [], unread: true, starred: false, draft: false,
                              headers: ["List-Unsubscribe": "<mailto:leave@list.example>"])
        return MailThread(id: id, mailbox: me, subject: id, labels: ["INBOX", "CATEGORY_UPDATES"], messages: [message])
    }

    /** Without a provider, the demo's store: no sync, nothing leaves. */
    private func makeStore(_ threads: [MailThread], provider: ChangeProvider? = nil) -> MailStore {
        let mailbox = Mailbox(email: me, name: "Me", displayName: "Personal", color: "#336699", signature: "", labels: [])
        let store = MailStore(preferences: Preferences(), mailboxes: [mailbox], threads: threads)
        if let provider {
            let cache = MailCache(folder: URL.temporaryDirectory.appending(path: "CatchUpUnsubscribe-\(UUID())"))
            store.sync = MailSync(store: store, google: GoogleAuth(), cache: cache, providers: [me: provider])
        }
        return store
    }

    /** The inbox's pill and Catch up count the same cards: the mailbox in front's unread mail and invitations, none passed. */
    @Test func thePillAndCatchUpCountTheInboxInFront() async throws {
        let other = "other@gmail.com"
        let mine = Mailbox(email: me, name: "Me", displayName: "Personal", color: "#336699", signature: "", labels: [])
        let theirs = Mailbox(email: other, name: "Other", displayName: "Work", color: "#993366", signature: "", labels: [])
        var elsewhere = thread("x")
        elsewhere.mailbox = other
        let store = MailStore(preferences: Preferences(), mailboxes: [mine, theirs], threads: [thread("a"), thread("b"), elsewhere])
        let calendar = CalendarStore()
        let dates = CalendarDates()
        await calendar.load(CatchUp.window(dates), sources: [mine, theirs], demo: true, google: GoogleAuth(), dates: dates)
        let state = CatchUpState()

        let items = state.items(scope: me, store: store, calendar: calendar, shown: [:], dates: dates)
        let invites = items.compactMap { if case .invite(let event) = $0 { event } else { nil } }
        #expect(!invites.isEmpty)
        #expect(invites.allSatisfy { $0.calendar.account == me })
        #expect(Set(items.compactMap { if case .mail(let thread) = $0 { thread.id } else { nil } }) == ["a", "b"])

        state.passed.insert("a")
        state.passed.insert(invites[0].id)
        #expect(state.items(scope: me, store: store, calendar: calendar, shown: [:], dates: dates).count == items.count - 2)
    }

    private func inbox(_ store: MailStore) -> [String] {
        CatchUp.queue(store.threads(in: .inbox, scope: me)).map(\.id)
    }

    @Test func aDoneUnsubscribeArchivesAndReadsTheConversation() async {
        let store = makeStore([thread("a"), thread("b")])
        let state = CatchUpState()
        let result = await state.unsubscribe(thread("a"), store: store) { .done }
        #expect(result.ok)
        #expect(result.text == "Unsubscribed from News")
        #expect(store.thread("a")?.labels.contains("INBOX") == false)
        #expect(store.thread("a")?.unread == false)
        #expect(state.passed.contains("a"))
        #expect(state.unsubscribing.isEmpty)
        // A fresh state, as a rebuilt tab would have, still leaves it out: the mail itself changed.
        #expect(CatchUp.queue(store.threads(in: .inbox, scope: me), passed: CatchUpState().passed).map(\.id) == ["b"])
    }

    @Test func aHandedOffUnsubscribeCleansUpToo() async {
        let store = makeStore([thread("a")])
        let result = await CatchUpState().unsubscribe(thread("a"), store: store) { .openedPage }
        #expect(result.ok)
        #expect(inbox(store).isEmpty)
    }

    @Test func aFailedUnsubscribeLeavesTheMailAndTheCard() async {
        let store = makeStore([thread("a")])
        let state = CatchUpState()
        let result = await state.unsubscribe(thread("a"), store: store) { .failed("No network") }
        #expect(!result.ok)
        #expect(result.text == "Couldn't unsubscribe: No network")
        #expect(inbox(store) == ["a"])
        #expect(!state.passed.contains("a"))
        #expect(state.offersUnsubscribe(thread("a")))
    }

    @Test func theSendersOtherMailNoLongerOffersUnsubscribe() async {
        let store = makeStore([thread("a"), thread("b"), thread("c", from: "other@list.example")])
        let state = CatchUpState()
        _ = await state.unsubscribe(thread("a"), store: store) { .done }
        #expect(!state.offersUnsubscribe(thread("b")))
        #expect(!state.offersUnsubscribe(thread("b", from: "NEWS@list.example")))
        #expect(state.offersUnsubscribe(thread("c", from: "other@list.example")))
    }

    @Test func theCleanupIsOneChangeTheServerWaitsOn() async {
        let provider = ChangeProvider()
        let store = makeStore([thread("a")], provider: provider)
        let result = await CatchUpState().unsubscribe(thread("a"), store: store) { .done }
        #expect(result.ok)
        #expect(provider.removed == [["INBOX", "UNREAD"]])
        #expect(inbox(store).isEmpty)
    }

    @Test func aRefusedCleanupPutsTheConversationBackAndKeepsTheCard() async {
        let provider = ChangeProvider(refuses: true)
        let store = makeStore([thread("a")], provider: provider)
        let state = CatchUpState()
        let result = await state.unsubscribe(thread("a"), store: store) { .done }
        #expect(!result.ok)
        #expect(result.text.hasPrefix("Unsubscribed, but couldn't archive “a”"))
        #expect(store.thread("a")?.labels == ["INBOX", "CATEGORY_UPDATES"])
        #expect(store.thread("a")?.unread == true)
        #expect(!state.passed.contains("a"))
        #expect(inbox(store) == ["a"])
        #expect(state.unsubscribing.isEmpty)
    }

    @Test func archiveReadRollsBackOnlyWhatItChanged() async {
        var read = thread("a")
        read.messages.append(Message(id: "a-old", from: Person(name: "News", email: "news@list.example"), to: [], cc: [],
                                     date: .distantPast, text: "", html: nil, attachments: [], unread: false, starred: true,
                                     draft: false, headers: [:]))
        read.labels.insert("Label_1")
        let store = makeStore([read], provider: ChangeProvider(refuses: true))
        await #expect(throws: ChangeProvider.Refused.self) { try await store.archiveRead("a") }
        let back = store.thread("a")
        #expect(back?.labels == ["INBOX", "CATEGORY_UPDATES", "Label_1"])
        #expect(back?.messages.map(\.unread) == [true, false])
        #expect(back?.starred == true)
    }

    @Test func demoUnsubscribesSendNothing() async {
        let store = makeStore([thread("a")])
        let unsubscribe = Unsubscribe(thread("a").latest.headers)!
        let mailbox = store.mailbox(me)!
        let before = store.threads.count
        #expect(await unsubscribe.run(from: mailbox, store: store) == .done)
        #expect(store.threads.count == before)
    }
}

/** Takes or refuses label changes, writing down what it was asked to remove. */
@MainActor
private final class ChangeProvider: MailProvider {
    struct Refused: Error {}
    let refuses: Bool
    private(set) var removed: [[String]] = []
    init(refuses: Bool = false) { self.refuses = refuses }

    var capabilities: MailCapabilities { .gmail }
    var takesTurns: Bool { false }
    var hasArchive: Bool { false }

    func apply(_ change: MailStore.Change, to thread: MailThread, _ state: inout MailboxState) async throws -> MailDelta {
        if case .modify(_, let remove) = change { removed.append(remove) }
        if refuses { throw Refused() }
        return MailDelta()
    }

    func sync(_ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func loadMore(_ folder: Folder, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func search(_ query: String, known: [MailThread]) async throws -> (ids: [String], threads: [MailThread]) { ([], []) }
    func labels() async throws -> [MailLabel] { [] }
    func signature() async throws -> String? { nil }
    func setSignature(_ html: String) async throws -> String { html }
    func refresh(_ thread: MailThread, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func send(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func saveDraft(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func deleteDraft(_ messageID: String, _ state: inout MailboxState) async throws {}
    func attachment(_ attachment: Otter_Mail.Attachment, of message: Message) async throws -> Data { Data() }
    func watch(pushTopic: String?, _ state: inout MailboxState, onChange: @escaping () -> Void) async -> Task<Void, Never>? { nil }
}
