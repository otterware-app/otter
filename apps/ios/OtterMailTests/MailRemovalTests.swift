import Foundation
import Testing
@testable import Otter_Mail

/**
 * Which conversations the store remembers as gone (`removedThreads`): those
 * deleted here or reported deleted by their provider, kept across restarts,
 * and not those only dropped from the cache when Gmail's history ran out.
 */
@MainActor
struct MailRemovalTests {
    private let mailbox = Mailbox(email: "robin@otter.example", name: "Robin", displayName: "Robin", color: "#336699", signature: "", labels: [])

    private func thread(_ id: String, labels: Set<String> = ["INBOX"]) -> MailThread {
        let message = Message(id: "m-\(id)", from: Person(name: "Ann", email: "ann@example.com"), to: [], cc: [], date: .now,
                              text: "", html: nil, attachments: [], unread: false, starred: false, draft: false, headers: [:])
        return MailThread(id: id, mailbox: mailbox.email, subject: "Dinner?", labels: labels, messages: [message])
    }

    private func defaults() throws -> UserDefaults {
        let suite = "MailRemovalTests-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defaults.removePersistentDomain(forName: suite)
        return defaults
    }

    @Test func remembersADeletedConversationAcrossARestartUntilItComesBack() throws {
        let defaults = try defaults()
        let store = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], threads: [thread("t1")], defaults: defaults)
        store.remove(threadIDs: ["t1"])
        #expect(store.removedThreads == ["t1"])

        let reopened = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], defaults: defaults)
        #expect(reopened.removedThreads == ["t1"])
        reopened.upsert(threads: [thread("t1")])
        #expect(reopened.removedThreads.isEmpty)
    }

    /** Gmail's history ran out: the cache starts over from the inbox, and what it left out isn't gone. */
    @Test func aConversationOnlyDroppedFromTheCacheIsntGone() async throws {
        let defaults = try defaults()
        let store = MailStore(preferences: Preferences(defaults: defaults), mailboxes: [mailbox], threads: [thread("t1", labels: [])], defaults: defaults)
        let folder = URL.temporaryDirectory.appending(path: "MailRemovalTests-\(UUID())")
        defer { try? FileManager.default.removeItem(at: folder) }
        let sync = MailSync(store: store, google: GoogleAuth(), cache: MailCache(folder: folder), providers: [mailbox.email: StartOverProvider()])

        await sync.sync(mailbox.email)
        #expect(store.thread("t1") == nil)
        #expect(store.removedThreads.isEmpty)
    }
}

/** Gmail once its history has run out: what was cached is dropped, and nothing comes back but an empty inbox. */
@MainActor
final class StartOverProvider: MailProvider {
    var capabilities: MailCapabilities { .gmail }
    var takesTurns: Bool { false }
    var hasArchive: Bool { false }

    func sync(_ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta(dropped: Set(known.map(\.id))) }
    func loadMore(_ folder: Folder, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func search(_ query: String, known: [MailThread]) async throws -> (ids: [String], threads: [MailThread]) { ([], []) }
    func labels() async throws -> [MailLabel] { [] }
    func signature() async throws -> String? { nil }
    func setSignature(_ html: String) async throws -> String { html }
    func apply(_ change: MailStore.Change, to thread: MailThread, _ state: inout MailboxState) async throws -> MailDelta { MailDelta() }
    func refresh(_ thread: MailThread, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func send(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func saveDraft(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta { MailDelta() }
    func deleteDraft(_ messageID: String, _ state: inout MailboxState) async throws {}
    func attachment(_ attachment: Otter_Mail.Attachment, of message: Message) async throws -> Data { Data() }
    func watch(pushTopic: String?, _ state: inout MailboxState, onChange: @escaping () -> Void) async -> Task<Void, Never>? { nil }
}

