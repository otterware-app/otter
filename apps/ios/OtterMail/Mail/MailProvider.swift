import Foundation

protocol MailProvider: AnyObject {
    var capabilities: MailCapabilities { get }
    /**
     * Calls on a mailbox must run one at a time: they rewrite the copy (IMAP
     * moves change message ids), so each has to start from what the last left.
     */
    var takesTurns: Bool { get }

    func sync(_ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta
    func loadMore(_ folder: Folder, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta
    func search(_ query: String, known: [MailThread]) async throws -> (ids: [String], threads: [MailThread])
    func labels() async throws -> [MailLabel]
    var hasArchive: Bool { get }
    func signature() async throws -> String?
    func setSignature(_ html: String) async throws -> String

    func apply(_ change: MailStore.Change, to thread: MailThread, _ state: inout MailboxState) async throws -> MailDelta
    func refresh(_ thread: MailThread, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta
    func send(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta
    func saveDraft(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta
    func deleteDraft(_ messageID: String, _ state: inout MailboxState) async throws
    func attachment(_ attachment: Attachment, of message: Message) async throws -> Data

    func watch(pushTopic: String?, _ state: inout MailboxState, onChange: @escaping () -> Void) async -> Task<Void, Never>?
}

nonisolated struct MailDelta {
    var threads: [MailThread] = []
    var removed: Set<String> = []
    /** Cached conversations to forget without their being gone: Gmail's history ran out and the cache starts over. */
    var dropped: Set<String> = []
}

/** A message to send or keep in Drafts, as RFC 5322 (MIME.message) with its envelope. */
nonisolated struct Outgoing {
    var raw: Data
    var from: String
    var recipients: [String]
    var threadID: String?
    var draft: String?

    // The same message as the composer has it, for Outlook, which writes it through Graph rather than as MIME.
    var subject = ""
    var html = ""
    var to: [Person] = []
    var cc: [Person] = []
    var bcc: [Person] = []
    var files: [MIME.File] = []
    /** The message it answers (Outlook makes the reply from it, so it stays in the conversation). */
    var replyTo: String? = nil
}

nonisolated struct MailboxState: Codable {
    var historyID: String?
    var draftIDs: [String: String] = [:]
    var pages: [String: String] = [:]
    var watchedAt: Date?
    var watchExpiresAt: Date?
    var watchTopic: String?
    var folders: [String: ImapFolderState]? = nil
    var trashedFrom: [String: String]? = nil
    /** Folder key → the oldest date its pages reached: its list stops there, so the next page adds to the bottom. */
    var reached: [String: Date]? = nil
    var deltas: [String: String]? = nil
    var subscription: String? = nil
    /** Outlook and IMAP: cached mail from the Archive carries `ARCHIVE` (mail cached before it did is labeled again once). */
    var archiveLabeled: Bool? = nil

    mutating func paged(_ key: String, next: String?, oldest: Date?) {
        pages[key] = next ?? ""
        guard let oldest else { return }
        reached = (reached ?? [:]).merging([key: oldest], uniquingKeysWith: min)
    }

    /**
     * Whether the folder's list goes down to `thread`. Mail cached from other
     * folders can be older than the pages loaded here, and a page would land
     * above it; so until every page is in, the list ends where they reached.
     */
    func lists(_ thread: MailThread, in key: String) -> Bool {
        guard pages[key] != "", let reached = reached?[key] else { return true }
        return thread.latest.date >= reached
    }

    func unbounded(_ key: String) -> Bool {
        pages[key] != "" && reached?[key] == nil
    }
}

/** Where an IMAP folder's copy got to (RFC 3501, CONDSTORE). */
nonisolated struct ImapFolderState: Codable, Equatable {
    var uidValidity: UInt32
    var uidNext: UInt32
    var highestModSeq: UInt64?
    var oldest: UInt32
}
