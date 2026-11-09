import Foundation
import Observation
import SwiftUI

/**
 * Everything the app shows and does with mail. Local-first, as on the Mac:
 * screens render from here and never wait on the network. Changes show at
 * once and are handed to `sync`, which writes them to Gmail; in the demo
 * there's no sync and the pretend mail just changes.
 */
@Observable
final class MailStore {
    private(set) var mailboxes: [Mailbox] {
        // Alias mailboxes' lists depend on their parents.
        didSet { folderThreads.removeAll(); unreadCounts.removeAll() }
    }
    private(set) var threads: [MailThread] {
        didSet { folderThreads.removeAll(); unreadCounts.removeAll() }
    }
    @ObservationIgnored private var folderThreads: [Place: [MailThread]] = [:]
    @ObservationIgnored private var unreadCounts: [Place: Int] = [:]
    @ObservationIgnored private var cachedFor: [String] = []
    var otherAddresses = MailAddresses() {
        didSet { if otherAddresses != oldValue { folderThreads.removeAll(); unreadCounts.removeAll() } }
    }
    let preferences: Preferences
    private(set) var recoveredDrafts: [RecoveredDraft] = []
    @ObservationIgnored private var recoveryDirectory: URL?
    private(set) var undoAction: PendingAction?
    @ObservationIgnored private var undoTask: Task<Void, Never>?

    struct PendingAction {
        let id = UUID()
        let trash: Bool
        let threads: [MailThread]
        var title: String { "\(threads.count == 1 ? "Conversation" : "\(threads.count) conversations") \(trash ? "trashed" : "archived")" }
    }
    @ObservationIgnored var sync: MailSync?

    init(preferences: Preferences, mailboxes: [Mailbox] = [], threads: [MailThread] = []) {
        self.preferences = preferences
        self.mailboxes = mailboxes
        self.threads = threads
    }

    static func demo(preferences: Preferences) -> MailStore {
        let demo = DemoMail.load()
        let store = MailStore(preferences: preferences, mailboxes: demo.mailboxes, threads: demo.threads)
        store.otherAddresses = demo.addresses
        store.configureRecovery(namespace: "demo")
        return store
    }

    var isDemo: Bool { sync == nil }

    var arrangedMailboxes: [Mailbox] {
        let order = preferences.arrangement.order
        let rank = { (m: Mailbox) in order.firstIndex(of: m.email) ?? order.count }
        return mailboxes.enumerated()
            .sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }
            .map(\.element)
    }

    var shownMailboxes: [Mailbox] {
        arrangedMailboxes.filter { !preferences.arrangement.off.contains($0.email) }
    }

    /**
     * As on the Mac and the web: `mail:mailboxes` orders every mailbox, alias mailboxes among the rest.
     * One not in it yet follows the one before it in the default order (each mailbox, then its alias
     * mailboxes), so a new alias mailbox starts beside its parent.
     */
    var arrangedScopes: [Mailbox] {
        let order = preferences.arrangement.order
        let rank = Dictionary(order.enumerated().map { ($1, $0) }) { a, _ in a }
        let byDefault = arrangedMailboxes.flatMap { mailbox in
            [mailbox] + aliases(of: mailbox).enumerated()
                .sorted { (rank[$0.element.email] ?? order.count, $0.offset) < (rank[$1.element.email] ?? order.count, $1.offset) }
                .map(\.element)
        }
        var previous = -1
        return byDefault.enumerated()
            .map { offset, mailbox in
                if let at = rank[mailbox.email] { previous = at }
                return (mailbox: mailbox, rank: previous, offset: offset)
            }
            .sorted { ($0.rank, $0.offset) < ($1.rank, $1.offset) }
            .map(\.mailbox)
    }

    /** `arrangedScopes` with each mailbox's alias mailboxes under it, as Settings lists them. */
    var groupedScopes: [Mailbox] {
        let scopes = arrangedScopes
        return scopes.filter { $0.parent == nil }.flatMap { mailbox in [mailbox] + scopes.filter { $0.parent == mailbox.email } }
    }

    var shownScopes: [Mailbox] {
        let off = Set(preferences.arrangement.off)
        return arrangedScopes.filter { !off.contains($0.email) && !off.contains($0.source) }
    }

    func mailbox(_ email: String) -> Mailbox? { mailboxes.first { $0.email == email } }

    func mailbox(for scope: String) -> Mailbox? { mailbox(scope) ?? alias(scope) }

    /** As core's validAliasMailboxes: still in its Send from, not a mailbox, and not an earlier mailbox's. */
    private func aliasEntries(of mailbox: Mailbox) -> [AliasMailbox] {
        guard mailbox.parent == nil, mailbox.provider == .imap else { return [] }
        let key = mailbox.email.lowercased()
        let sendAs = Set((otherAddresses.sendAs[key] ?? []).map { $0.lowercased() })
        var seen = Set(mailboxes.map { $0.email.lowercased() })
        return (otherAddresses.aliasMailboxes[key] ?? []).filter { sendAs.contains($0.id) && seen.insert($0.id).inserted }
    }

    /** Dressed as mailboxes for the screens: the parent's folders and server under the alias's own address, name, color and signature. */
    func aliases(of mailbox: Mailbox) -> [Mailbox] {
        let earlier = Set(mailboxes.prefix { $0.email != mailbox.email }.flatMap(aliasEntries).map(\.id))
        return aliasEntries(of: mailbox).filter { !earlier.contains($0.id) }.map { entry in
            var alias = mailbox
            alias.email = entry.id
            alias.displayName = entry.title
            alias.color = entry.color ?? Session.defaultColor(entry.id)
            alias.signature = entry.signature ?? mailbox.signature
            alias.picture = nil
            alias.customPicture = mailbox.aliasPictures?[entry.id]
            alias.aliasPictures = nil
            alias.parent = mailbox.email
            return alias
        }
    }

    private func aliasScope(_ scope: String) -> Mailbox? {
        mailbox(scope) == nil ? alias(scope) : nil
    }

    func alias(_ id: String) -> Mailbox? {
        let id = id.lowercased()
        for mailbox in mailboxes {
            if let alias = aliases(of: mailbox).first(where: { $0.email == id }) { return alias }
        }
        return nil
    }

    func shownAliases(of email: String) -> [AliasMailbox] {
        let shown = Set(shownScopes.filter { $0.parent == email }.map(\.email))
        return (otherAddresses.aliasMailboxes[email.lowercased()] ?? []).filter { shown.contains($0.id) }
    }

    /** Lower-cased, the mailbox's own first. */
    func addresses(of email: String) -> [String] {
        let key = email.lowercased()
        var all = [key]
        // Gmail and Outlook send only from addresses they verified; the synced Send from is IMAP's.
        guard mailboxes.first(where: { $0.email.lowercased() == key })?.provider == .imap else { return all }
        for address in otherAddresses.sendAs[key] ?? [] {
            let address = address.trimmingCharacters(in: .whitespaces).lowercased()
            if address.contains("@") && !all.contains(address) { all.append(address) }
        }
        return all
    }

    func isMine(_ person: Person, in email: String) -> Bool {
        addresses(of: email).contains(person.email.lowercased())
    }

    func sender(_ address: String, of mailbox: Mailbox) -> Mailbox {
        aliases(of: mailbox).first { $0.email == address.lowercased() } ?? mailbox
    }

    private func replyAddress(_ thread: MailThread, in scope: String, of mailbox: Mailbox) -> String {
        if let alias = alias(scope), alias.source == mailbox.email { return alias.email }
        return Draft.replyAddress(thread.sent.last ?? thread.latest, addresses(of: mailbox.email)) ?? mailbox.email
    }

    func reply(to thread: MailThread, in scope: String, all: Bool) -> Draft? {
        guard let mailbox = mailbox(thread.mailbox) else { return nil }
        let address = replyAddress(thread, in: scope, of: mailbox)
        return .reply(to: thread, in: sender(address, of: mailbox), address: address, mine: Set(addresses(of: mailbox.email)), all: all)
    }

    func forward(_ thread: MailThread, in scope: String) -> Draft? {
        guard let mailbox = mailbox(thread.mailbox) else { return nil }
        let address = replyAddress(thread, in: scope, of: mailbox)
        return .forward(thread, in: sender(address, of: mailbox), address: address)
    }

    func signature(of draft: Draft) -> String {
        guard let mailbox = mailbox(draft.from) else { return "" }
        return sender(sendingAddress(draft, of: mailbox), of: mailbox).signature
    }

    /** Alias mailboxes' mail is their parents', so only mailboxes count. */
    /** Each mailbox's Inbox with its alias mailboxes' mail, even when its list leaves that out. */
    var appBadge: Int {
        shownMailboxes.reduce(0) { total, mailbox in
            total + (aliasesApart(from: mailbox.email).isEmpty
                ? unreadCount(in: .inbox, scope: mailbox.email)
                : threads(of: mailbox.email, in: .inbox, whole: true).count(where: \.unread))
        }
    }

    func upsert(mailbox: Mailbox) {
        if let i = mailboxes.firstIndex(where: { $0.email == mailbox.email }) {
            if mailboxes[i] != mailbox { mailboxes[i] = mailbox }
        } else {
            mailboxes.append(mailbox)
        }
    }

    func remove(mailbox email: String) {
        commitPendingAction()
        for recovery in recoveredDrafts where recovery.draft.from == email { removeRecovery(recovery.draft, deletingFiles: true) }
        mailboxes.removeAll { $0.email == email }
        threads.removeAll { $0.mailbox == email }
        preferences.arrangement.order.removeAll { $0 == email }
        preferences.arrangement.off.removeAll { $0 == email }
    }

    func setSignedOut(_ signedOut: Bool, _ email: String) {
        if !signedOut { setLostSignIn(false, email) }
        guard var mailbox = mailbox(email), mailbox.signedOut != signedOut else { return }
        mailbox.signedOut = signedOut
        upsert(mailbox: mailbox)
    }

    struct SyncHealth: Equatable {
        var syncedAt: Date?
        /** Why the last sync failed ("Can't connect"); nil when it worked. */
        var failure: String?
    }
    private(set) var health: [String: SyncHealth] = [:]

    func recordSync(_ email: String, failure: String?) {
        var entry = health[email] ?? SyncHealth()
        if failure == nil { entry.syncedAt = .now }
        entry.failure = failure
        health[email] = entry
    }

    private(set) var lostSignIn = Set(UserDefaults.standard.stringArray(forKey: "mail.lostSignIn") ?? [])

    func setLostSignIn(_ lost: Bool, _ email: String) {
        guard lostSignIn.contains(email) != lost else { return }
        if lost { lostSignIn.insert(email) } else { lostSignIn.remove(email) }
        UserDefaults.standard.set(lostSignIn.sorted(), forKey: "mail.lostSignIn")
    }

    func setOn(_ on: Bool, _ mailbox: Mailbox) {
        var off = Set(preferences.arrangement.off)
        if on { off.remove(mailbox.email) } else { off.insert(mailbox.email) }
        preferences.arrangement.off = arrangedScopes.map(\.email).filter(off.contains)
    }

    func move(from source: IndexSet, to destination: Int) {
        var moved = arrangedScopes
        moved.move(fromOffsets: source, toOffset: destination)
        preferences.arrangement.order = moved.map(\.email)
    }

    /** The alias mailboxes turned on whose mail `email`'s list leaves out ("Their mail in … too" off). */
    func aliasesApart(from email: String) -> [String] {
        guard preferences.aliasMailApart.contains(email.lowercased()) else { return [] }
        return shownAliases(of: email).map(\.id)
    }

    func setAliasMailInParent(_ on: Bool, _ email: String) {
        let key = email.lowercased()
        preferences.aliasMailApart = preferences.aliasMailApart.filter { $0 != key } + (on ? [] : [key])
    }

    /** The lists also follow which mailboxes are on and which leave their alias mailboxes' mail out. */
    private func checkCaches() {
        let key = preferences.arrangement.off + ["|"] + preferences.aliasMailApart
        if key != cachedFor {
            folderThreads.removeAll()
            unreadCounts.removeAll()
            cachedFor = key
        }
    }

    func threads(in folder: Folder, scope: String) -> [MailThread] {
        // Cache hits must still subscribe the view to mail changes.
        _ = threads
        _ = otherAddresses
        checkCaches()
        let key = Place(scope: scope, folder: folder)
        if let cached = folderThreads[key] { return cached }
        let result = threads(of: scope, in: folder).sorted { $0.latest.date > $1.latest.date }
        folderThreads[key] = result
        return result
    }

    func unreadCount(in folder: Folder, scope: String) -> Int {
        _ = threads
        _ = otherAddresses
        checkCaches()
        let key = Place(scope: scope, folder: folder)
        if let cached = unreadCounts[key] { return cached }
        let count = threads(of: scope, in: folder).reduce(0) { $0 + ($1.unread ? 1 : 0) }
        unreadCounts[key] = count
        return count
    }

    /** `whole`: a mailbox's own list with its alias mailboxes' mail, whatever its switch says. */
    private func threads(of scope: String, in folder: Folder, whole: Bool = false) -> [MailThread] {
        let alias = aliasScope(scope)
        let source = alias?.source ?? scope
        let addresses = self.addresses(of: source)
        let (mine, others) = (Set(addresses), Set(addresses.dropFirst()))
        let apart = alias != nil || whole ? [] : aliasesApart(from: scope)
        return allThreads(of: source).filter { thread in
            guard matches(thread, folder, mine: mine) else { return false }
            if let alias { return Self.belongs(thread, to: alias.email, in: folder, others: others) }
            return apart.isEmpty || Self.isRest(thread, without: apart, in: folder, mine: mine, others: others)
        }
    }

    /** Whether `message` puts its thread in `address`'s (an alias mailbox's) `folder`. */
    private static func isFor(_ message: Message, _ address: String, in folder: Folder, others: Set<String>) -> Bool {
        let received = {
            AliasMailbox.receives(address, deliveredTo: message.deliveredTo, recipients: (message.to + message.cc).map(\.email), others: others)
        }
        let wrote = { message.from.isAddress(address) }
        switch folder {
        case .inbox, .junk: return received()
        case .sent: return !message.draft && wrote()
        case .drafts: return message.draft && wrote()
        default: return received() || wrote()
        }
    }

    static func belongs(_ thread: MailThread, to address: String, in folder: Folder, others: Set<String>) -> Bool {
        thread.messages.contains { isFor($0, address, in: folder, others: others) }
    }

    /**
     * Whether the parent's `folder` keeps `thread` with its alias mailboxes' (`aliases`) mail left out:
     * one of the messages that put it there is none of theirs. In Inbox and Junk that's mail that came
     * in, not your replies beside it.
     */
    static func isRest(_ thread: MailThread, without aliases: [String], in folder: Folder, mine: Set<String>, others: Set<String>) -> Bool {
        thread.messages.contains { message in
            let fromMine = mine.contains(message.from.email.lowercased())
            let there = switch folder {
            case .inbox, .junk: !message.draft && (!fromMine || (message.to + message.cc).contains { mine.contains($0.email.lowercased()) })
            case .sent: !message.draft && fromMine
            case .drafts: message.draft
            default: true
            }
            return there && !aliases.contains { isFor(message, $0, in: folder, others: others) }
        }
    }

    func belonging(to scope: String) -> (MailThread) -> Bool {
        guard let alias = aliasScope(scope) else { return { $0.mailbox == scope } }
        let others = Set(addresses(of: alias.source).dropFirst())
        return { $0.mailbox == alias.source && Self.belongs($0, to: alias.email, in: .allMail, others: others) }
    }

    func recoveries(in scope: String) -> [RecoveredDraft] {
        guard let alias = aliasScope(scope) else { return recoveredDrafts.filter { $0.draft.from == scope } }
        return recoveredDrafts.filter { $0.draft.from == alias.source && $0.draft.address == alias.email }
    }

    func badge(in folder: Folder, scope: String) -> Int {
        switch folder {
        case .allMail: return 0
        case .drafts:
            let alias = aliasScope(scope)
            let saved = threads(of: scope, in: .drafts).flatMap(\.messages)
                .filter { message in message.draft && alias.map { message.from.isAddress($0.email) } != false }
            let local = recoveries(in: scope).filter { entry in !saved.contains(where: { $0.id == entry.draft.messageID }) }
            return saved.count + local.count
        default: return unreadCount(in: folder, scope: scope)
        }
    }

    func thread(_ id: String) -> MailThread? { threads.first { $0.id == id } }

    func allThreads(of email: String) -> [MailThread] { threads.filter { $0.mailbox == email } }

    private func matches(_ thread: MailThread, _ folder: Folder, mine: Set<String>) -> Bool {
        let away = thread.labels.contains("SPAM") || thread.labels.contains("TRASH")
        switch folder {
        case .inbox: return thread.labels.contains("INBOX") && !away
        case .starred: return thread.starred && !away
        case .sent: return thread.sent.contains { mine.contains($0.from.email.lowercased()) } && !away
        case .drafts: return thread.messages.contains(where: \.draft) && !away
        case .important: return thread.labels.contains("IMPORTANT") && !away
        case .allMail: return !away && !thread.isDraft
        case .archive: return thread.labels.contains("ARCHIVE") && !away
        case .junk: return thread.labels.contains("SPAM")
        case .trash: return thread.labels.contains("TRASH")
        case .label(let id, _): return thread.labels.contains(id) && !away
        }
    }

    func search(_ query: String, scope: String) -> [MailThread] {
        let terms = query.lowercased().split(separator: " ").map(String.init)
        guard !terms.isEmpty else { return [] }
        let labels = Dictionary(mailboxes.flatMap(\.labels).map { ($0.id, $0.name.lowercased()) }) { a, _ in a }
        let inScope = belonging(to: scope)
        return allThreads(of: mailbox(for: scope)?.source ?? scope)
            .filter { !$0.labels.contains("SPAM") && !$0.labels.contains("TRASH") && inScope($0) }
            .filter { thread in terms.allSatisfy { Self.term($0, matches: thread, labels: labels) } }
            .sorted { $0.latest.date > $1.latest.date }
    }

    private static func term(_ term: String, matches thread: MailThread, labels: [String: String]) -> Bool {
        let people = { (list: [Person]) in list.map { "\($0.name) \($0.email)".lowercased() } }
        let (op, value) = term.contains(":")
            ? (String(term.prefix { $0 != ":" }), String(term.drop { $0 != ":" }.dropFirst()))
            : ("", term)
        switch op {
        case "from": return people(thread.messages.map(\.from)).contains { $0.contains(value) }
        case "to": return people(thread.messages.flatMap { $0.to + $0.cc }).contains { $0.contains(value) }
        case "subject": return thread.subject.lowercased().contains(value)
        case "label": return thread.labels.contains { $0.lowercased() == value || labels[$0] == value }
        case "is" where value == "unread": return thread.unread
        case "is" where value == "starred": return thread.starred
        case "has" where value == "attachment": return thread.hasAttachments
        default:
            let haystack = ([thread.subject] + thread.messages.flatMap { [$0.from.name, $0.from.email, $0.text] })
                .joined(separator: " ").lowercased()
            return haystack.contains(term)
        }
    }

    func upsert(threads fresh: [MailThread]) {
        guard !fresh.isEmpty else { return }
        var updated = threads
        var changed = false
        var index = Dictionary(uniqueKeysWithValues: threads.enumerated().map { ($1.id, $0) })
        for var thread in fresh {
            if let pending = undoAction, pending.threads.contains(where: { $0.id == thread.id }) {
                stage(&thread, trash: pending.trash)
            }
            if let i = index[thread.id] {
                if updated[i] != thread { updated[i] = thread; changed = true }
            } else {
                index[thread.id] = updated.count
                updated.append(thread)
                changed = true
            }
        }
        if changed { threads = updated }
    }

    func remove(threadIDs: Set<String>) {
        guard !threadIDs.isEmpty else { return }
        threads.removeAll { threadIDs.contains($0.id) }
    }

    /** Drops a message shown before Gmail had it, and its thread if nothing else is left in it. */
    func remove(messageID: String) {
        for i in threads.indices { threads[i].messages.removeAll { $0.id == messageID } }
        threads.removeAll { $0.messages.isEmpty }
    }

    enum Change {
        case modify(add: [String], remove: [String])
        case star(message: String)
        case trash, untrash, delete
    }

    private func archiveFolder(_ thread: MailThread) -> Bool {
        mailbox(thread.mailbox)?.capabilities.archiveFolder == true
    }

    func canArchive(_ thread: MailThread) -> Bool {
        !thread.archivable(archiveFolder: archiveFolder(thread)).isEmpty
    }

    private func edit(_ id: String, _ changes: [Change], _ change: (inout MailThread) -> Void) {
        commitPendingAction()
        guard let i = threads.firstIndex(where: { $0.id == id }) else { return }
        change(&threads[i])
        let thread = threads[i]
        for c in changes { sync?.apply(c, to: thread) }
    }

    func setRead(_ read: Bool, _ id: String) {
        let change = Change.modify(add: read ? [] : ["UNREAD"], remove: read ? ["UNREAD"] : [])
        edit(id, [change]) { t in for i in t.messages.indices { t.messages[i].unread = !read } }
    }

    func toggleStar(_ id: String) {
        guard let thread = thread(id) else { return }
        let starred = !thread.starred
        let latest = thread.sent.last ?? thread.latest
        // Every copy of it (iCloud files one per address delivered to), so each alias mailbox shows it flagged.
        let messageID = latest.headers["Message-ID"]
        let copies = Set(thread.messages.filter { $0.id == latest.id || messageID != nil && $0.headers["Message-ID"] == messageID }.map(\.id))
        edit(id, starred ? copies.sorted().map { .star(message: $0) } : [.modify(add: [], remove: ["STARRED"])]) { t in
            for i in t.messages.indices { t.messages[i].starred = starred && copies.contains(t.messages[i].id) }
        }
    }

    func archive(_ id: String) { archive([id]) }
    func trash(_ id: String) { trash([id]) }
    func archive(_ ids: Set<String>) { stage(ids, trash: false) }
    func trash(_ ids: Set<String>) { stage(ids, trash: true) }

    private func stage(_ ids: Set<String>, trash: Bool) {
        commitPendingAction()
        let originals = threads.filter { ids.contains($0.id) && (trash ? !$0.labels.contains("TRASH") : canArchive($0)) }
        guard !originals.isEmpty else { return }
        undoAction = PendingAction(trash: trash, threads: originals)
        for i in threads.indices where originals.contains(where: { $0.id == threads[i].id }) {
            stage(&threads[i], trash: trash)
        }
        undoTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled else { return }
            self?.commitPendingAction()
        }
    }

    /** A thread as trashing or archiving leaves it, before the server has it. */
    private func stage(_ thread: inout MailThread, trash: Bool) {
        if trash {
            thread.labels.subtract(["INBOX", "SPAM", "ARCHIVE"])
            thread.labels.insert("TRASH")
        } else {
            let folders = archiveFolder(thread)
            thread.land(add: [], remove: Array(thread.archivable(archiveFolder: folders)), archiveFolder: folders)
        }
    }

    func undo() {
        guard let action = undoAction else { return }
        undoTask?.cancel()
        undoAction = nil
        for original in action.threads {
            guard let i = threads.firstIndex(where: { $0.id == original.id }) else { continue }
            let affected: Set<String> = action.trash
                ? ["INBOX", "SPAM", "TRASH", "ARCHIVE"]
                : original.archivable(archiveFolder: archiveFolder(original)).union(["ARCHIVE"])
            threads[i].labels.subtract(affected)
            threads[i].labels.formUnion(original.labels.intersection(affected))
        }
    }

    /**
     * Archived and read at once, waiting on the server: an unsubscribed list's
     * mail, so it doesn't come back. If the server refuses, the thread goes back
     * as Undo would put it, unread again, and the error is thrown.
     */
    func archiveRead(_ id: String) async throws {
        commitPendingAction()
        guard let i = threads.firstIndex(where: { $0.id == id }) else { return }
        let original = threads[i]
        let folders = archiveFolder(original)
        let archived = original.archivable(archiveFolder: folders)
        let unread = Set(original.messages.filter(\.unread).map(\.id))
        threads[i].land(add: [], remove: Array(archived), archiveFolder: folders)
        for m in threads[i].messages.indices { threads[i].messages[m].unread = false }
        let changed = threads[i]
        guard let sync else { return }
        do {
            try await sync.write(.modify(add: [], remove: archived.sorted() + ["UNREAD"]), to: changed)
        } catch {
            if let i = threads.firstIndex(where: { $0.id == id }) {
                let affected = archived.union(["ARCHIVE"])
                threads[i].labels.subtract(affected)
                threads[i].labels.formUnion(original.labels.intersection(affected))
                for m in threads[i].messages.indices where unread.contains(threads[i].messages[m].id) {
                    threads[i].messages[m].unread = true
                }
            }
            throw error
        }
    }

    func commitPendingAction() {
        undoTask?.cancel()
        guard let action = undoAction else { return }
        undoAction = nil
        for original in action.threads {
            let archived = Array(original.archivable(archiveFolder: archiveFolder(original)))
            sync?.apply(action.trash ? .trash : .modify(add: [], remove: archived), to: thread(original.id) ?? original)
        }
    }

    func markSpam(_ id: String) {
        guard let thread = thread(id) else { return }
        let folders = archiveFolder(thread)
        edit(id, [.modify(add: ["SPAM"], remove: ["INBOX"])]) { t in
            t.land(add: ["SPAM"], remove: ["INBOX", "TRASH"], archiveFolder: folders)
        }
    }

    func moveToInbox(_ id: String) {
        guard let thread = thread(id) else { return }
        let folders = archiveFolder(thread)
        let changes: [Change] = thread.labels.contains("TRASH")
            ? [.untrash, .modify(add: ["INBOX"], remove: [])]
            : [.modify(add: ["INBOX"], remove: ["SPAM"])]
        edit(id, changes) { t in
            t.land(add: ["INBOX"], remove: ["SPAM", "TRASH"], archiveFolder: folders)
        }
    }

    func deleteForever(_ id: String) {
        commitPendingAction()
        guard let thread = thread(id) else { return }
        threads.removeAll { $0.id == id }
        sync?.apply(.delete, to: thread)
    }

    func toggleLabel(_ label: String, _ id: String) {
        guard let thread = thread(id) else { return }
        let (on, folders) = (!thread.labels.contains(label), archiveFolder(thread))
        edit(id, [.modify(add: on ? [label] : [], remove: on ? [] : [label])]) { t in
            t.land(add: on ? [label] : [], remove: on ? [] : [label], archiveFolder: folders)
        }
    }

    func contacts(matching query: String, from email: String, excluding: Set<String>) -> [Person] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        var seen = excluding
        seen.formUnion(addresses(of: email))
        var matches: [Person] = []
        for thread in allThreads(of: email).sorted(by: { $0.latest.date > $1.latest.date }) {
            for message in thread.messages.reversed() {
                for person in [message.from] + message.to + message.cc {
                    let key = person.email.lowercased()
                    guard !seen.contains(key), Draft.validRecipient(person.email),
                          person.name.localizedStandardContains(query) || person.email.localizedStandardContains(query) else { continue }
                    seen.insert(key)
                    matches.append(person)
                    if matches.count == 6 { return matches }
                }
            }
        }
        return matches
    }

    func configureRecovery(namespace: String) {
        recoveryDirectory = URL.applicationSupportDirectory.appending(path: "draft-recovery").appending(path: namespace)
        guard let directory = recoveryDirectory else { return }
        recoveredDrafts = ((try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? [])
            .compactMap { try? JSONDecoder().decode(RecoveredDraft.self, from: Data(contentsOf: $0)) }
            .sorted { $0.updated > $1.updated }
    }

    func recover(_ draft: Draft) -> Draft {
        recoveredDrafts.first { $0.draft.id == draft.id || (draft.messageID != nil && $0.draft.messageID == draft.messageID && $0.draft.from == draft.from) }?.draft ?? draft
    }

    func saveRecovery(_ draft: Draft) throws {
        guard let directory = recoveryDirectory else { throw Draft.Failure.recoveryUnavailable }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let entry = RecoveredDraft(draft: draft)
        try JSONEncoder().encode(entry).write(to: directory.appending(path: "\(draft.id).json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        recoveredDrafts.removeAll { $0.id == draft.id }
        recoveredDrafts.insert(entry, at: 0)
    }

    func removeRecovery(_ draft: Draft, deletingFiles: Bool = false) {
        if deletingFiles {
            for file in draft.files {
                if let url = file.url { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
            }
        }
        if let directory = recoveryDirectory { try? FileManager.default.removeItem(at: directory.appending(path: "\(draft.id).json")) }
        recoveredDrafts.removeAll { $0.id == draft.id }
    }

    func clearRecovery() {
        for entry in recoveredDrafts { removeRecovery(entry.draft, deletingFiles: true) }
    }

    func attachmentURL(_ attachment: Attachment, of message: Message, in email: String) async throws -> URL {
        if let id = attachment.id, id.hasPrefix("local:") {
            let file = String(id.dropFirst(6))
            guard UUID(uuidString: file) != nil else { throw DraftFile.Failure.unavailable }
            let url = DraftFile.directory.appending(path: file).appending(path: URL(fileURLWithPath: attachment.filename).lastPathComponent)
            guard FileManager.default.fileExists(atPath: url.path) else { throw DraftFile.Failure.unavailable }
            return url
        }
        guard let sync else { throw DraftFile.Failure.unavailable }
        return try await sync.attachment(attachment, of: message, in: email)
    }

    func fileData(_ file: DraftFile, from email: String) async throws -> Data {
        if let url = file.url { return try Data(contentsOf: url) }
        let source = file.sourceMailbox ?? email
        guard let original = file.original, let message = allThreads(of: source).flatMap(\.messages).first(where: { $0.id == file.messageID }) else { throw DraftFile.Failure.unavailable }
        return try Data(contentsOf: await attachmentURL(original, of: message, in: source))
    }

    func send(_ draft: Draft) async throws {
        guard draft.canSend else { throw Draft.Failure.invalidRecipients }
        try await write(draft, asDraft: false)
        removeRecovery(draft, deletingFiles: !isDemo)
    }

    /** Keeps `draft` in Drafts (only when there's something in it). */
    func save(_ draft: Draft) async throws {
        guard !draft.isEmpty else { return await discard(draft) }
        try await write(draft, asDraft: true)
        removeRecovery(draft, deletingFiles: !isDemo)
    }

    func discard(_ draft: Draft) async {
        removeRecovery(draft, deletingFiles: true)
        guard let messageID = draft.messageID else { return }
        remove(messageID: messageID)
        await sync?.discard(draft)
    }

    /** An address since taken out of Send from falls back to the mailbox's own. */
    func sendingAddress(_ draft: Draft, of mailbox: Mailbox) -> String {
        guard let address = draft.address?.lowercased(), addresses(of: mailbox.email).contains(address) else { return mailbox.email }
        return address
    }

    private func write(_ draft: Draft, asDraft: Bool) async throws {
        guard let mailbox = mailbox(draft.from), !mailbox.signedOut else { throw Draft.Failure.mailboxUnavailable }
        guard draft.files.reduce(0, { $0 + $1.size }) <= DraftFile.limit else { throw DraftFile.Failure.tooLarge }
        let localID = UUID().uuidString
        let message = Message(
            id: localID,
            from: Person(name: mailbox.name, email: sendingAddress(draft, of: mailbox)),
            to: Draft.people(draft.to),
            cc: Draft.people(draft.cc),
            date: .now,
            text: draft.body,
            html: nil,
            attachments: draft.files.map(\.attachment),
            unread: false,
            starred: false,
            draft: asDraft,
            headers: draft.bcc.isEmpty ? [:] : ["Bcc": draft.bcc]
        )
        let threadID = draft.threadID ?? draft.messageID.flatMap { id in threads.first { $0.messages.contains { $0.id == id } }?.id }
        if let threadID, let i = threads.firstIndex(where: { $0.id == threadID }) {
            threads[i].messages.append(message)
            if !asDraft { threads[i].labels.insert("SENT") }
        } else {
            threads.append(MailThread(
                id: UUID().uuidString,
                mailbox: mailbox.email,
                subject: draft.subject.isEmpty ? "(no subject)" : draft.subject,
                labels: asDraft ? [] : ["SENT"],
                messages: [message]
            ))
        }
        threads.removeAll { $0.messages.isEmpty }
        guard let sync else {
            if let previous = draft.messageID { remove(messageID: previous) }
            return
        }
        do {
            try await sync.write(draft, asDraft: asDraft)
        } catch {
            ErrorReports.capture(error, scope: asDraft ? "save-draft" : "send", tags: ["provider": mailbox.provider.rawValue])
            remove(messageID: localID)
            throw error
        }
        remove(messageID: localID)
    }
}
