import Foundation
import Observation
import UserNotifications

/**
 * Keeps signed-in mailboxes in step with their servers, local-first like
 * core's mail-sync.ts: the store renders from its copy (cached on disk, so
 * launch is instant), changes are made there first and then written through
 * the mailbox's provider (Gmail, IMAP or Outlook), and the provider catches
 * the copy up when a mailbox changed (a relay event, IDLE), on launch and when the
 * app comes back. Observable, so lists follow where their folders' pages got to.
 */
@MainActor
@Observable
final class MailSync {
    private let store: MailStore
    private let google: GoogleAuth
    private let microsoft: MicrosoftAuth
    private let relay: Relay?
    private var providers: [String: any MailProvider] = [:]
    private var states: [String: MailboxState] = [:]
    private var running: [String: Task<Void, Never>] = [:]
    private var watching: [String: Task<Void, Never>] = [:]
    private var saving: Task<Void, Never>?
    @ObservationIgnored private let cache: MailCache
    @ObservationIgnored private var cacheLoad: Task<Void, Never>?
    @ObservationIgnored private var forgotten: Set<String> = []
    private(set) var loadingCache = false
    var pushMailboxes: Set<String> = []
    @ObservationIgnored private var stopped = false
    private var busy: Set<String> = []
    private var waiting: [String: [CheckedContinuation<Void, Never>]] = [:]
    /** Folder pages being fetched ("email key"), so the same page isn't asked for twice at once. */
    private var paging: Set<String> = []
    /** Tasks of their own, so a list's `.task` restarting doesn't cancel a page midway. */
    @ObservationIgnored private var aliasPaging: [String: Task<Void, Never>] = [:]

    init(store: MailStore, google: GoogleAuth, microsoft: MicrosoftAuth = MicrosoftAuth(), relay: Relay? = nil, cache: MailCache = .live,
         providers: [String: any MailProvider] = [:]) {
        self.store = store
        self.google = google
        self.microsoft = microsoft
        self.relay = relay
        self.cache = cache
        self.providers = providers
    }

    private func provider(_ email: String) -> any MailProvider {
        if let provider = providers[email] { return provider }
        let provider: any MailProvider = if let settings = store.mailbox(email)?.imap {
            ImapProvider(email: email, settings: settings)
        } else if store.mailbox(email)?.provider == .outlook {
            OutlookProvider(
                email: email,
                api: GraphAPI(email: email) { [microsoft] force in try await microsoft.accessToken(email, force: force) },
                watchTarget: relay.map { relay in { try await relay.outlookWatch(email) } }
            )
        } else {
            GmailProvider(api: GmailAPI(email: email) { [google] force in try await google.accessToken(email, force: force) })
        }
        providers[email] = provider
        return provider
    }

    /**
     * Runs `body` with the mailbox's provider and state, then shows what it
     * answers. For a provider whose calls rewrite what's here (`takesTurns`:
     * IMAP moves re-key messages), one at a time per mailbox, so each starts
     * from what the last left: a sync that IDLE starts while a move is under
     * way would otherwise bring the thread back as it was. Gmail's calls run
     * side by side, as bulk actions want.
     */
    @discardableResult
    private func run(
        _ email: String, _ body: (any MailProvider, inout MailboxState, [MailThread]) async throws -> MailDelta
    ) async throws -> MailDelta {
        await waitForCache()
        try Task.checkCancellation()
        guard !stopped, store.mailbox(email) != nil else { throw CancellationError() }
        let provider = provider(email)
        let turns = provider.takesTurns
        if turns, busy.contains(email) {
            await withCheckedContinuation { waiting[email, default: []].append($0) }
        } else if turns {
            busy.insert(email)
        }
        defer {
            if turns, let next = waiting[email]?.first {
                waiting[email]?.removeFirst()
                next.resume()
            } else if turns {
                busy.remove(email)
            }
        }
        var state = states[email] ?? MailboxState()
        let delta = try await body(provider, &state, store.allThreads(of: email))
        try Task.checkCancellation()
        guard !stopped, store.mailbox(email) != nil else { throw CancellationError() }
        states[email] = state
        let fresh = Set(delta.threads.map(\.id))
        store.remove(threadIDs: delta.removed.subtracting(fresh))
        store.remove(threadIDs: delta.dropped.subtracting(fresh), gone: false)
        store.upsert(threads: delta.threads)
        scheduleSave()
        return delta
    }

    /** Restore before network sync, without holding up the first frame or gestures. */
    func loadCache(for emails: [String]) {
        guard cacheLoad == nil else { return }
        loadingCache = true
        let mailboxes = Dictionary(uniqueKeysWithValues: store.mailboxes.map { ($0.email, $0) })
        cacheLoad = Task {
            let snapshots = await cache.load(emails)
            defer { loadingCache = false }
            guard !Task.isCancelled else { return }
            for cached in snapshots where !forgotten.contains(cached.mailbox.email) && store.mailbox(cached.mailbox.email) != nil {
                states[cached.mailbox.email] = cached.state
                if store.mailbox(cached.mailbox.email) == mailboxes[cached.mailbox.email] {
                    store.upsert(mailbox: cached.mailbox)
                }
                store.upsert(threads: cached.threads)
            }
        }
    }

    func waitForCache() async { await cacheLoad?.value }

    func loadNotificationThread(_ id: String, email: String) async {
        _ = try? await run(email) { provider, state, known in
            try await provider.refresh(MailThread(id: id, mailbox: email, subject: "", labels: [], messages: []), &state, known: known)
        }
    }

    private func scheduleSave() {
        guard !stopped else { return }
        saving?.cancel()
        saving = Task {
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            save()
        }
    }

    private func save() {
        let snapshots = store.mailboxes.filter { !$0.signedOut && !forgotten.contains($0.email) }.map { mailbox in
            MailCache.Snapshot(mailbox: mailbox, state: states[mailbox.email] ?? MailboxState(), threads: store.allThreads(of: mailbox.email))
        }
        cache.save(snapshots)
    }

    func forget(_ email: String) {
        forgotten.insert(email)
        states[email] = nil
        providers[email] = nil
        running[email]?.cancel()
        running[email] = nil
        watching.removeValue(forKey: email)?.cancel()
        cache.remove(email)
    }

    func stop(_ email: String) {
        providers[email] = nil
        watching.removeValue(forKey: email)?.cancel()
    }

    func forgetAll() {
        stopped = true
        saving?.cancel()
        cacheLoad?.cancel()
        for email in Set(states.keys).union(providers.keys) { forget(email) }
        cache.removeAll()
    }

    func syncAll(notify: Bool = false) async {
        await withTaskGroup(of: Void.self) { group in
            for mailbox in store.shownMailboxes where !mailbox.signedOut {
                group.addTask { await self.sync(mailbox.email, notify: notify) }
            }
        }
    }

    func sync(_ email: String, notify: Bool = false) async {
        await waitForCache()
        guard !stopped, !Task.isCancelled, store.mailbox(email) != nil else { return }
        forgotten.remove(email)
        if let running = running[email] { return await running.value }
        let task = Task { await catchUp(email, notify: notify) }
        running[email] = task
        await task.value
        running[email] = nil
    }

    private func catchUp(_ email: String, notify: Bool) async {
        do {
            let before = Dictionary(store.allThreads(of: email).map { ($0.id, $0) }) { a, _ in a }
            let delta = try await run(email) { provider, state, known in try await provider.sync(&state, known: known) }
            if notify { await announce(delta.threads, before: before) }
            store.recordSync(email, failure: nil)
            let provider = provider(email)
            let labels = try await provider.labels()
            // A Gmail sign-in from before settings were asked for can't read it; the mail still syncs.
            let signature = try? await provider.signature()
            // Read after the awaits, so what changed meanwhile (a synced signature) isn't written over.
            if var mailbox = store.mailbox(email) {
                mailbox.labels = labels
                mailbox.hasArchive = provider.capabilities.archiveFolder ? provider.hasArchive : nil
                if let signature { mailbox.signature = signature }
                store.upsert(mailbox: mailbox)
            }
            scheduleSave()
        } catch where Self.signedOut(error) {
            // A password the server refuses is no use kept (as GoogleAuth drops a revoked sign-in).
            if store.mailbox(email)?.imap != nil { ImapProvider.setPassword(nil, for: email) }
            store.setSignedOut(true, email)
            store.setLostSignIn(true, email)
            stop(email)
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled, (error as? URLError)?.code != .cancelled else { return }
            ErrorReports.capture(error, scope: "mail-sync", tags: ["provider": store.mailbox(email)?.provider.rawValue ?? "unknown"])
            store.recordSync(email, failure: error is URLError || (error as? ImapError)?.isConnectionFailure == true ? "Can't connect" : "Sync failed")
        }
    }

    private static func signedOut(_ error: Error) -> Bool {
        if case GoogleAuth.Failure.signedOut = error { return true }
        if case MicrosoftAuth.Failure.signedOut = error { return true }
        if (error as? GmailAPI.Failure)?.status == 401 || (error as? GraphAPI.Failure)?.status == 401 { return true }
        return (error as? ImapError)?.isSignedOut == true
    }

    func watch(pushTopic: String?, relayOnly: Bool = false) async {
        for mailbox in store.shownMailboxes where !mailbox.signedOut && watching[mailbox.email] == nil && (!relayOnly || mailbox.capabilities.relayPush) {
            let email = mailbox.email
            var task: Task<Void, Never>?
            _ = try? await run(email) { provider, state, _ in
                task = await provider.watch(pushTopic: pushTopic, &state) { [weak self] in
                    Task { await self?.sync(email, notify: true) }
                }
                return MailDelta()
            }
            if let task { watching[email] = task }
        }
    }

    func stopWatching() {
        for task in watching.values { task.cancel() }
        watching = [:]
    }

    static func key(_ folder: Folder) -> String {
        switch folder {
        case .label(let id, _): "label:\(id)"
        default: folder.title
        }
    }

    func hasMore(_ folder: Folder, scope: String) -> Bool {
        mailboxes(scope).contains { states[$0]?.pages[Self.key(folder)] != "" }
    }

    func cursor(_ folder: Folder, scope: String) -> String {
        mailboxes(scope).map { states[$0]?.pages[Self.key(folder)] ?? "" }.joined(separator: " ")
    }

    func listed(_ threads: [MailThread], in folder: Folder) -> [MailThread] {
        let key = Self.key(folder)
        let paged = Set(store.shownMailboxes.filter { !$0.signedOut }.map(\.email))
        return threads.filter { !paged.contains($0.mailbox) || states[$0.mailbox]?.lists($0, in: key) != false }
    }

    static let aliasPage = 20
    static let aliasPageLimit = 10
    private(set) var aliasPaused: Set<String> = []

    func paused(_ folder: Folder, scope: String) -> Bool { aliasPaused.contains("\(scope) \(Self.key(folder))") }

    func loadMore(_ folder: Folder, scope: String) async {
        guard store.mailbox(scope) == nil, store.alias(scope) != nil else { return await loadMore(folder, in: mailboxes(scope)) }
        let key = "\(scope) \(Self.key(folder))"
        if let running = aliasPaging[key] { return await running.value }
        aliasPaused.remove(key)
        let task = Task { await pageAlias(folder, scope: scope) }
        aliasPaging[key] = task
        await task.value
        aliasPaging[key] = nil
    }

    /**
     * An alias mailbox's mail can be sparse in its parent's: page the parent until `aliasPage` of it are in,
     * but through at most `aliasPageLimit` pages before the list waits to be asked.
     */
    private func pageAlias(_ folder: Folder, scope: String) async {
        let count = { self.listed(self.store.threads(in: folder, scope: scope), in: folder).count }
        let wanted = count() + Self.aliasPage
        for _ in 0..<Self.aliasPageLimit {
            guard !stopped, hasMore(folder, scope: scope), count() < wanted else { return }
            let cursor = cursor(folder, scope: scope)
            await loadMore(folder, in: mailboxes(scope))
            guard cursor != self.cursor(folder, scope: scope) else { return }
        }
        if hasMore(folder, scope: scope), count() < wanted { aliasPaused.insert("\(scope) \(Self.key(folder))") }
    }

    /** A page on opening the folder where none yet says where its list ends, before the list gets there (not before a first sync). */
    func open(_ folder: Folder, scope: String) async {
        await waitForCache()
        let key = Self.key(folder)
        await loadMore(folder, in: mailboxes(scope).filter { states[$0]?.unbounded(key) == true })
    }

    private func loadMore(_ folder: Folder, in emails: [String]) async {
        await waitForCache()
        let key = Self.key(folder)
        for email in emails where states[email]?.pages[key] != "" && paging.insert("\(email) \(key)").inserted {
            _ = try? await run(email) { provider, state, known in try await provider.loadMore(folder, &state, known: known) }
            paging.remove("\(email) \(key)")
        }
    }

    func search(_ query: String, scope: String) async -> [String] {
        await waitForCache()
        var found: [String] = []
        for email in mailboxes(scope) {
            guard let (ids, threads) = try? await provider(email).search(query, known: store.allThreads(of: email)) else { continue }
            store.upsert(threads: threads)
            found += ids
        }
        return found
    }

    private func mailboxes(_ scope: String) -> [String] {
        let source = store.mailbox(for: scope)?.source ?? scope
        return store.shownMailboxes.filter { !$0.signedOut && $0.email == source }.map(\.email)
    }

    /** Writes a change the store already shows; if the server refuses, the thread is reloaded as it has it. */
    func apply(_ change: MailStore.Change, to thread: MailThread) {
        guard store.mailbox(thread.mailbox)?.signedOut == false else { return }
        let email = thread.mailbox
        Task {
            do {
                try await write(change, to: thread)
            } catch {
                _ = try? await run(email) { provider, state, known in try await provider.refresh(thread, &state, known: known) }
            }
        }
    }

    /** Writes a change the store already shows, throwing if the server refuses it. */
    func write(_ change: MailStore.Change, to thread: MailThread) async throws {
        guard store.mailbox(thread.mailbox)?.signedOut == false else { throw Draft.Failure.mailboxUnavailable }
        try await run(thread.mailbox) { provider, state, known in
            try await provider.apply(change, to: known.first(where: { $0.id == thread.id }) ?? thread, &state)
        }
    }

    func write(_ draft: Draft, asDraft: Bool) async throws {
        guard let mailbox = store.mailbox(draft.from), !mailbox.signedOut else { throw Draft.Failure.mailboxUnavailable }
        let replyTo = draft.threadID.flatMap(store.thread)
        let quoted = replyTo?.sent.last { $0.headers["Message-ID"] != nil }
        let to = Draft.people(draft.to), cc = Draft.people(draft.cc), bcc = Draft.people(draft.bcc)
        var files: [MIME.File] = []
        var size = 0
        for file in draft.files {
            let data = try await store.fileData(file, from: draft.from)
            size += data.count
            guard size <= DraftFile.limit else { throw DraftFile.Failure.tooLarge }
            files.append(MIME.File(filename: file.filename, mimeType: file.mimeType, data: data))
        }
        let html = Compose.html(draft.body, signature: store.signature(of: draft))
        // The server and SMTP's envelope stay the mailbox's.
        let raw = MIME.message(
            from: Person(name: mailbox.name, email: store.sendingAddress(draft, of: mailbox)),
            to: to,
            cc: cc,
            bcc: asDraft || mailbox.imap == nil ? bcc : [],
            files: files,
            subject: draft.subject,
            text: draft.body,
            html: html,
            inReplyTo: quoted?.headers["Message-ID"],
            references: quoted?.headers["References"],
            stamped: mailbox.imap != nil
        )
        let message = Outgoing(
            raw: raw, from: mailbox.email, recipients: (to + cc + bcc).map(\.email), threadID: draft.threadID, draft: draft.messageID,
            subject: draft.subject, html: html, to: to, cc: cc, bcc: bcc, files: files, replyTo: quoted?.id
        )
        try await run(mailbox.email) { provider, state, known in
            asDraft
                ? try await provider.saveDraft(message, &state, known: known)
                : try await provider.send(message, &state, known: known)
        }
    }

    func discard(_ draft: Draft) async {
        guard let messageID = draft.messageID else { return }
        _ = try? await run(draft.from) { provider, state, _ in
            try await provider.deleteDraft(messageID, &state)
            return MailDelta()
        }
    }

    func setSignature(_ html: String, for email: String) async throws {
        let saved = try await provider(email).setSignature(html)
        if var mailbox = store.mailbox(email) {
            mailbox.signature = saved
            store.upsert(mailbox: mailbox)
        }
        scheduleSave()
    }

    func inlineImage(_ attachment: Attachment, of message: Message, in email: String) async -> Data? {
        try? await provider(email).attachment(attachment, of: message)
    }

    func attachment(_ attachment: Attachment, of message: Message, in email: String) async throws -> URL {
        let data = try await provider(email).attachment(attachment, of: message)
        let folder = URL.temporaryDirectory.appending(path: message.id.replacingOccurrences(of: "/", with: "_"), directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let url = folder.appending(path: attachment.filename.isEmpty ? "attachment" : URL(fileURLWithPath: attachment.filename).lastPathComponent)
        try data.write(to: url)
        return url
    }

    private func announce(_ threads: [MailThread], before: [String: MailThread]) async {
        let mode = store.preferences.notifications
        guard mode != .off, !stopped, !Task.isCancelled else { return }
        // One per Message-ID: a copy delivered to each of two aliases is one message.
        var announced: Set<String> = []
        for thread in threads {
            guard !stopped, !Task.isCancelled, store.preferences.notifications != .off else { return }
            guard !forgotten.contains(thread.mailbox), store.mailbox(thread.mailbox) != nil else { continue }
            if pushMailboxes.contains(thread.mailbox.lowercased()) { continue }
            let earlier = before[thread.id]?.messages ?? []
            let known = Set(earlier.map(\.id)), seen = Set(earlier.compactMap { $0.headers["Message-ID"] })
            let arrived = thread.messages.filter { message in
                !known.contains(message.id) && message.unread && !message.draft && !seen.contains(message.headers["Message-ID"] ?? "")
            }
            guard let message = arrived.last else { continue }
            if mode == .inbox && !thread.labels.contains("INBOX") { continue }
            if let id = message.headers["Message-ID"], !announced.insert(id).inserted { continue }
            let content = alert(message, in: thread)
            try? await UNUserNotificationCenter.current().add(
                UNNotificationRequest(identifier: message.id, content: content, trigger: nil)
            )
        }
    }
}

extension MailSync {
    func alert(_ message: Message, in thread: MailThread) -> UNMutableNotificationContent {
        let alias = AliasMailbox.announced(to: message.to.map(\.email), cc: message.cc.map(\.email), deliveredTo: message.deliveredTo,
                                           among: store.shownAliases(of: thread.mailbox))
        let name = store.shownScopes.count > 1 ? alias?.title ?? store.mailbox(thread.mailbox)?.displayName : nil
        let content = UNMutableNotificationContent()
        content.title = message.from.label
        content.subtitle = PushState.subtitle(thread.subject, mailbox: name)
        content.body = message.snippet
        content.sound = .default
        content.threadIdentifier = thread.id
        content.userInfo = ["thread": thread.id, "mailbox": alias?.id ?? thread.mailbox]
        return content
    }
}

enum Compose {
    static func html(_ text: String, signature: String) -> String {
        let escape = { (s: String) in
            s.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
                .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\n", with: "<br>")
        }
        let plain = Signature.plainText(signature)
        if !plain.isEmpty, let range = text.range(of: plain) {
            return "<div dir=\"ltr\">\(escape(String(text[..<range.lowerBound])))\(signature)\(escape(String(text[range.upperBound...])))</div>"
        }
        return "<div dir=\"ltr\">\(escape(text))</div>"
    }
}
