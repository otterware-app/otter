import Foundation

final class ImapProvider: MailProvider {
    let email: String
    let settings: ImapSettings
    private var client: ImapClient?
    private var usedAt = Date.distantPast
    private var busy = false
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var folders: [ImapFolder] = []
    private var roles: [Role: String] = [:]
    /** Gmail's All Mail, where its IMAP archives (not synced). */
    private var allMail: String?

    private static let page = 30

    init(email: String, settings: ImapSettings) {
        self.email = email
        self.settings = settings
    }

    var capabilities: MailCapabilities { .imap }
    var takesTurns: Bool { true }

    private static func key(_ email: String) -> String { "imap-password:\(email.lowercased())" }
    static func password(_ email: String) -> String? { Keychain.get(key(email)) }
    static func setPassword(_ password: String?, for email: String) { Keychain.set(key(email), password, thisDeviceOnly: true) }

    /** Logs in to the IMAP and SMTP servers, to check settings before they're saved. */
    static func verify(_ settings: ImapSettings, password: String) async throws {
        let client = try await ImapClient.connect(settings.imap, username: settings.username, auth: .password(password))
        await client.logout()
        try await SMTP.verify(settings.smtp, username: settings.username, auth: .password(password))
    }

    /** Runs `body` on the connection, a job at a time (jobs open folders, so they can't interleave). */
    private func session<T>(_ body: (ImapClient) async throws -> T) async throws -> T {
        if busy { await withCheckedContinuation { waiting.append($0) } } else { busy = true }
        defer { if waiting.isEmpty { busy = false } else { waiting.removeFirst().resume() } }
        let client = try await connection()
        do {
            let result = try await body(client)
            usedAt = .now
            return result
        } catch {
            if case ImapError.server = error {} else {
                client.close()
                self.client = nil
            }
            throw error
        }
    }

    private func connection() async throws -> ImapClient {
        if let client {
            if usedAt > .now.addingTimeInterval(-60) { return client }
            if (try? await client.noop()) != nil { return client }
            client.close()
            self.client = nil
        }
        guard let password = Self.password(email) else { throw ImapError.signedOut }
        let client = try await ImapClient.connect(settings.imap, username: settings.username, auth: .password(password))
        self.client = client
        try await refreshFolders(client)
        return client
    }

    enum Role: String, CaseIterable {
        case inbox, sent, drafts, trash, junk, archive

        var label: String {
            switch self {
            case .inbox: "INBOX"
            case .sent: "SENT"
            case .drafts: "DRAFT"
            case .trash: "TRASH"
            case .junk: "SPAM"
            case .archive: "ARCHIVE"
            }
        }
    }

    private func refreshFolders(_ client: ImapClient) async throws {
        let list = try await client.list()
        (folders, roles, allMail) = Self.folders(list, gmail: await client.capabilities.contains("X-GM-EXT-1"))
    }

    /**
     * A LIST's folders worth syncing (not \All or \Flagged: they hold copies
     * of other folders' mail, and a server's virtual All can't even take a
     * move), which is which, and Gmail's All Mail (`gmail`: X-GM-EXT-1).
     * Roles come from the special-use attributes (RFC 6154), else the usual
     * names, at the top or right under INBOX. On Gmail a folder named Archive
     * is just a label: Gmail archives into All Mail.
     */
    static func folders(_ list: [ImapFolder], gmail: Bool) -> (folders: [ImapFolder], roles: [Role: String], allMail: String?) {
        let list = list.filter { $0.attributes.isDisjoint(with: ["\\noselect", "\\nonexistent"]) }
        let folders = list.filter { $0.attributes.isDisjoint(with: ["\\all", "\\flagged"]) }
        let attributes: [Role: String] = [.sent: "\\sent", .drafts: "\\drafts", .trash: "\\trash", .junk: "\\junk", .archive: "\\archive"]
        let names: [Role: [String]] = [
            .sent: ["sent", "sent items", "sent messages", "sent mail"],
            .drafts: ["drafts", "draft"],
            .trash: ["trash", "deleted items", "deleted messages", "bin"],
            .junk: ["junk", "spam", "junk e-mail", "junk email", "bulk mail"],
            .archive: ["archive", "archives", "archiv", "archivo", "archivio", "archief"],
        ]
        var roles: [Role: String] = [.inbox: folders.first { $0.path.uppercased() == "INBOX" }?.path ?? "INBOX"]
        for role in Role.allCases where role != .inbox {
            roles[role] = folders.first { $0.attributes.contains(attributes[role]!) }?.path
        }
        for role in Role.allCases where roles[role] == nil && !(gmail && role == .archive) {
            let taken = Set(roles.values)
            roles[role] = folders.first { names[role]!.contains(name($0).lowercased()) && !taken.contains($0.path) }?.path
        }
        return (folders, roles, gmail ? list.first { $0.attributes.contains("\\all") }?.path : nil)
    }

    private func path(_ role: Role, _ client: ImapClient) async throws -> String {
        if let path = roles[role] { return path }
        let name = role.rawValue.capitalized
        // The Archive is flagged for its use where the server can, so other apps find it too.
        let use = role == .archive ? "\\Archive" : nil
        do {
            try await client.create(name, use: use)
        } catch ImapError.server {
            try await client.create("INBOX\(folders.first?.delimiter ?? ".")\(name)", use: use)
        }
        try await refreshFolders(client)
        guard let path = roles[role] else { throw ImapError.server("Couldn't make a \(name) folder.") }
        return path
    }

    private func archive(_ client: ImapClient) async throws -> String {
        if let allMail { return allMail }
        return try await path(.archive, client)
    }

    private func role(_ path: String) -> Role? { roles.first { $0.value == path }?.key }

    private func label(_ path: String) -> String? {
        switch role(path) {
        case .drafts: nil
        case let role?: role.label
        case nil: folders.contains { $0.path == path } ? path : nil
        }
    }

    private func labels(of thread: MailThread) -> Set<String> {
        Set(thread.messages.compactMap { ImapID($0.id).flatMap { label($0.path) } })
    }

    private func path(_ folder: Folder) -> String? {
        switch folder {
        case .inbox: roles[.inbox]
        case .sent: roles[.sent]
        case .drafts: roles[.drafts]
        case .junk: roles[.junk]
        case .trash: roles[.trash]
        case .archive: roles[.archive]
        case .label(let id, _): id
        case .starred, .important, .allMail: nil
        }
    }

    private func folder(_ path: String) -> Folder {
        switch role(path) {
        case .inbox: .inbox
        case .sent: .sent
        case .drafts: .drafts
        case .junk: .junk
        case .trash: .trash
        case .archive: .archive
        case nil: .label(id: path, name: path)
        }
    }

    var hasArchive: Bool { roles[.archive] != nil }

    func labels() async throws -> [MailLabel] {
        if folders.isEmpty { try await session { try await refreshFolders($0) } }
        let special = Set(roles.values)
        return folders.filter { !special.contains($0.path) }
            .map { MailLabel(id: $0.path, name: Self.name($0), color: nil) }
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    /** A folder's name as a label's: decoded, "/" between levels, without the "INBOX." some servers put first. */
    private static func name(_ folder: ImapFolder) -> String {
        let decoded = MailDecoding.folderName(folder.path)
        var parts = folder.delimiter.map { decoded.components(separatedBy: $0) } ?? [decoded]
        if parts.count > 1, parts[0].uppercased() == "INBOX" { parts.removeFirst() }
        return parts.joined(separator: "/")
    }

    /** What a sync found, before it's folded into threads. */
    private struct Changes {
        var new: [Fetched] = []
        var flags: [String: Set<String>] = [:]
        var gone: Set<String> = []
    }

    func sync(_ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta {
        try await session { client in
            try await refreshFolders(client)
            var changes = Changes()
            if state.folders == nil {
                // The first time: the newest of the inbox, and of Sent and Drafts so replies join their threads.
                state.folders = [:]
                state.archiveLabeled = true
                for role in [Role.inbox, .sent, .drafts] {
                    if let path = roles[role] { try await loadPage(path, &state, client, &changes) }
                }
            } else {
                try await catchUp(&state, known: known, client, &changes)
            }
            var delta = merge(known, changes)
            if state.archiveLabeled != true {
                // Cached before the Archive's mail carried ARCHIVE: labeled once as its folders say now.
                let merged = Set(delta.threads.map(\.id)).union(delta.removed)
                for var thread in known where !merged.contains(thread.id) && labels(of: thread) != thread.labels {
                    thread.labels = labels(of: thread)
                    delta.threads.append(thread)
                }
                state.archiveLabeled = true
            }
            return delta
        }
    }

    /** Every folder synced so far, caught up. */
    private func catchUp(_ state: inout MailboxState, known: [MailThread], _ client: ImapClient, _ changes: inout Changes) async throws {
        let here = known.flatMap(\.messages).compactMap { ImapID($0.id) }
        for path in (state.folders ?? [:]).keys.sorted() {
            let mine = here.filter { $0.path == path }
            guard folders.contains(where: { $0.path == path }) else {
                changes.gone.formUnion(mine.map(\.id))
                state.folders?[path] = nil
                continue
            }
            try await catchUp(path, mine: mine, &state, client, &changes)
        }
    }

    private func catchUp(_ path: String, mine: [ImapID], _ state: inout MailboxState, _ client: ImapClient, _ changes: inout Changes) async throws {
        guard var saved = state.folders?[path] else { return }
        let capabilities = await client.capabilities
        let condstore = capabilities.contains("CONDSTORE") || capabilities.contains("QRESYNC")
        let qresync = capabilities.contains("QRESYNC")
        // Nothing new: servers with CONDSTORE say so without the folder being opened (the open one's STATUS can be stale).
        if condstore, saved.highestModSeq != nil, await client.selected != path, let status = try? await client.status(path),
           status.uidValidity == saved.uidValidity, status.uidNext == saved.uidNext, status.highestModSeq == saved.highestModSeq {
            return
        }
        let status = try await client.select(path)
        guard status.uidValidity == saved.uidValidity else {
            changes.gone.formUnion(mine.map(\.id))
            state.folders?[path] = nil
            return try await loadPage(path, &state, client, &changes)
        }
        if status.uidNext > saved.uidNext {
            let uids = try await client.search("UID \(saved.uidNext):* UNDELETED").filter { $0 >= saved.uidNext }.suffix(200)
            changes.new += try await messages(Array(uids), in: path, validity: status.uidValidity, client)
        }
        let uids = Set(mine.filter { $0.validity == status.uidValidity }.map(\.uid))
        if let low = uids.min() {
            let responses: [ImapResponse]
            var present: Set<UInt32>?
            if condstore, let modseq = saved.highestModSeq {
                responses = try await client.fetch("\(low):*", "(UID FLAGS)", modifiers: qresync ? "(CHANGEDSINCE \(modseq) VANISHED)" : "(CHANGEDSINCE \(modseq))")
                if !qresync { present = Set(try await client.search("UID \(low):* UNDELETED")) }
            } else {
                responses = try await client.fetch("\(low):*", "(UID FLAGS)")
                present = Set(responses.compactMap { response in
                    let items = response.values.first?.pairs ?? [:]
                    return Self.isDeleted(items) ? nil : items["UID"]?.number.map { UInt32(clamping: $0) }
                })
            }
            for response in responses {
                if response.kind == "VANISHED" {
                    let vanished = imapUIDs(response.values.last?.text ?? "")
                    changes.gone.formUnion(vanished.map { ImapID(validity: status.uidValidity, uid: $0, path: path).id })
                    continue
                }
                let items = response.values.first?.pairs ?? [:]
                guard let uid = items["UID"]?.number, let flags = items["FLAGS"] else { continue }
                let id = ImapID(validity: status.uidValidity, uid: UInt32(clamping: uid), path: path).id
                if Self.isDeleted(items) { changes.gone.insert(id) } else { changes.flags[id] = Set(flags.list.compactMap { $0.text?.lowercased() }) }
            }
            if let present {
                changes.gone.formUnion(uids.subtracting(present).map { ImapID(validity: status.uidValidity, uid: $0, path: path).id })
            }
        }
        saved.uidNext = status.uidNext
        saved.highestModSeq = status.highestModSeq
        state.folders?[path] = saved
    }

    private func loadPage(_ path: String, _ state: inout MailboxState, _ client: ImapClient, _ changes: inout Changes) async throws {
        let status = try await client.select(path)
        var saved = state.folders?[path]
            ?? ImapFolderState(uidValidity: status.uidValidity, uidNext: status.uidNext, highestModSeq: status.highestModSeq, oldest: status.uidNext)
        guard saved.uidValidity == status.uidValidity else { return }
        let older = saved.oldest > 1 ? try await client.search("UID 1:\(saved.oldest - 1) UNDELETED").filter { $0 < saved.oldest } : []
        let page = older.sorted().suffix(Self.page)
        let fetched = try await messages(Array(page), in: path, validity: status.uidValidity, client)
        changes.new += fetched
        saved.oldest = page.min() ?? saved.oldest
        if state.folders == nil { state.folders = [:] }
        state.folders?[path] = saved
        state.paged(MailSync.key(folder(path)), next: older.count > page.count ? "more" : nil, oldest: fetched.map(\.message.date).min())
    }

    /** Starts syncing a folder from now, before mail is moved or written there (not Gmail's All Mail: it holds every message). */
    @discardableResult
    private func track(_ path: String, _ state: inout MailboxState, _ client: ImapClient) async throws -> UInt32 {
        if let saved = state.folders?[path] { return saved.uidValidity }
        let status = try await client.select(path)
        guard path != allMail else { return status.uidValidity }
        if state.folders == nil { state.folders = [:] }
        state.folders?[path] = ImapFolderState(uidValidity: status.uidValidity, uidNext: status.uidNext, highestModSeq: nil, oldest: status.uidNext)
        return status.uidValidity
    }

    func loadMore(_ folder: Folder, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta {
        try await session { client in
            guard let path = path(folder), folders.contains(where: { $0.path == path }) else {
                state.pages[MailSync.key(folder)] = ""
                return MailDelta()
            }
            var changes = Changes()
            try await loadPage(path, &state, client, &changes)
            return merge(known, changes)
        }
    }

    func search(_ query: String, known: [MailThread]) async throws -> (ids: [String], threads: [MailThread]) { ([], []) }

    /** A message as fetched, with what threading it needs. */
    private struct Fetched {
        var message: Message
        var subject: String
        var root: String
        var bodies: [ImapBodyPart]
    }

    private func messages(_ uids: [UInt32], in path: String, validity: UInt32, _ client: ImapClient) async throws -> [Fetched] {
        guard !uids.isEmpty else { return [] }
        let responses = try await client.fetch(
            imapSet(uids),
            "(UID FLAGS INTERNALDATE ENVELOPE BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (REFERENCES LIST-UNSUBSCRIBE LIST-UNSUBSCRIBE-POST)])"
        )
        let drafts = role(path) == .drafts
        var fetched = responses.compactMap { Self.fetched($0.values.first?.pairs ?? [:], path: path, validity: validity, inDrafts: drafts) }
        let groups = Dictionary(grouping: fetched.indices) { fetched[$0].bodies.map(\.section) }
        for (sections, indices) in groups where !sections.isEmpty {
            let byUID = Dictionary(indices.map { (ImapID(fetched[$0].message.id)!.uid, $0) }) { a, _ in a }
            let items = sections.map { "BODY.PEEK[\($0)]" }.joined(separator: " ")
            for response in try await client.fetch(imapSet(byUID.keys), "(UID \(items))") {
                let pairs = response.values.first?.pairs ?? [:]
                guard let uid = pairs["UID"]?.number, let index = byUID[UInt32(clamping: uid)] else { continue }
                for part in fetched[index].bodies {
                    guard let data = pairs["BODY[\(part.section)]"]?.data else { continue }
                    let text = MailDecoding.text(MailDecoding.transfer(data, encoding: part.encoding), charset: part.params["charset"])
                        .replacingOccurrences(of: "\r\n", with: "\n")
                    if part.type == "text/html" { fetched[index].message.html = text } else { fetched[index].message.text = text }
                }
                if fetched[index].message.text.isEmpty, let html = fetched[index].message.html {
                    fetched[index].message.text = HTMLText.plain(html)
                }
            }
        }
        return fetched
    }

    private static let internalDate = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "d-MMM-yyyy HH:mm:ss Z"
        return formatter
    }()

    private static func fetched(_ items: [String: ImapValue], path: String, validity: UInt32, inDrafts: Bool) -> Fetched? {
        guard let uid = items["UID"]?.number, !isDeleted(items) else { return nil }
        let flags = Set(items["FLAGS"]?.list.compactMap { $0.text?.lowercased() } ?? [])
        let envelope = items["ENVELOPE"]?.list ?? []
        let field = { (i: Int) in i < envelope.count ? envelope[i] : .none }
        let block = items.first { $0.key.hasPrefix("BODY[HEADER") }?.value.text ?? ""
        let messageID = field(9).text
        let references = MailDecoding.header("References", in: block)
        let ids = { (text: String?) in (text ?? "").matches(of: /<[^>]+>/).map { String($0.output) } }
        let root = ids(references).first ?? ids(field(8).text).first ?? messageID ?? "\(validity):\(uid):\(path)"

        let parts = ImapBodyPart.leaves(items["BODYSTRUCTURE"] ?? .none)
        let bodies = [parts.first { $0.isBody && $0.type == "text/plain" }, parts.first { $0.isBody && $0.type == "text/html" }].compactMap { $0 }
        let isInline = { (part: ImapBodyPart) in part.contentID != nil && part.disposition != "attachment" && part.type.hasPrefix("image/") }
        let attachment = { (part: ImapBodyPart) in
            Attachment(id: "\(part.section) \(part.encoding)", filename: part.filename ?? "", mimeType: part.type, size: part.size, contentID: isInline(part) ? part.contentID : nil)
        }
        let files = parts.filter { !$0.isBody && ($0.disposition == "attachment" || $0.filename != nil || isInline($0)) }

        var headers: [String: String] = [:]
        if let messageID { headers["Message-ID"] = messageID }
        let bcc = imapAddresses(field(7))
        if !bcc.isEmpty { headers["Bcc"] = bcc.map(Draft.format).joined(separator: ", ") }
        for name in ["References", "List-Unsubscribe", "List-Unsubscribe-Post"] {
            if let value = MailDecoding.header(name, in: block) { headers[name] = value }
        }
        let inline = files.filter(isInline).map(attachment)
        let message = Message(
            id: ImapID(validity: validity, uid: UInt32(clamping: uid), path: path).id,
            from: imapAddresses(field(2)).first ?? Person(name: "", email: ""),
            to: imapAddresses(field(5)),
            cc: imapAddresses(field(6)),
            date: (items["INTERNALDATE"]?.text).flatMap { internalDate.date(from: $0.trimmingCharacters(in: .whitespaces)) } ?? .now,
            text: "",
            html: nil,
            attachments: files.filter { !isInline($0) }.map(attachment),
            inline: inline.isEmpty ? nil : inline,
            unread: !flags.contains("\\seen"),
            starred: flags.contains("\\flagged"),
            draft: inDrafts || flags.contains("\\draft"),
            headers: headers
        )
        let subject = field(1).text.map(MailDecoding.words) ?? ""
        return Fetched(message: message, subject: subject.isEmpty ? "(no subject)" : subject, root: root, bodies: bodies)
    }

    /** Marked \Deleted: on its way out (see ImapClient.delete), so not shown. */
    private static func isDeleted(_ items: [String: ImapValue]) -> Bool {
        items["FLAGS"]?.list.contains { $0.text?.lowercased() == "\\deleted" } ?? false
    }

    /** A subject without its "Re:", "Fwd:", "AW:", "SV:"…: what a thread's messages share. */
    static func topic(_ subject: String) -> String {
        var topic = subject.trimmingCharacters(in: .whitespaces)
        while let prefix = topic.prefixMatch(of: /(?i)(re|fwd?|aw|sv|wg)(\[\d+\])?\s*:\s*/) {
            topic = String(topic[prefix.range.upperBound...])
        }
        topic = topic.lowercased()
        return topic == "(no subject)" ? "" : topic
    }

    private func merge(_ known: [MailThread], _ changes: Changes) -> MailDelta {
        var threads = Dictionary(known.map { ($0.id, $0) }) { a, _ in a }
        var owner: [String: String] = [:]
        for thread in known { for message in thread.messages { owner[message.id] = thread.id } }
        var touched = Set<String>()
        for id in changes.gone {
            guard let thread = owner[id] else { continue }
            threads[thread]?.messages.removeAll { $0.id == id }
            touched.insert(thread)
        }
        for (id, flags) in changes.flags {
            guard let thread = owner[id], let i = threads[thread]?.messages.firstIndex(where: { $0.id == id }) else { continue }
            let (unread, starred) = (!flags.contains("\\seen"), flags.contains("\\flagged"))
            guard threads[thread]!.messages[i].unread != unread || threads[thread]!.messages[i].starred != starred else { continue }
            threads[thread]!.messages[i].unread = unread
            threads[thread]!.messages[i].starred = starred
            touched.insert(thread)
        }
        for fetched in changes.new {
            var id = owner[fetched.message.id] ?? "\(email) \(fetched.root)"
            if owner[fetched.message.id] == nil, let thread = threads[id], Self.topic(thread.subject) != Self.topic(fetched.subject) {
                id = "\(email) \(fetched.message.id)"
            }
            if threads[id] == nil {
                threads[id] = MailThread(id: id, mailbox: email, subject: fetched.subject, labels: [], messages: [])
            }
            threads[id]!.messages.removeAll { $0.id == fetched.message.id }
            if threads[id]!.messages.allSatisfy({ $0.date > fetched.message.date }) { threads[id]!.subject = fetched.subject }
            threads[id]!.messages.append(fetched.message)
            owner[fetched.message.id] = id
            touched.insert(id)
        }
        var delta = MailDelta()
        for id in touched {
            guard var thread = threads[id] else { continue }
            if thread.messages.isEmpty {
                delta.removed.insert(id)
                continue
            }
            thread.messages.sort { $0.date < $1.date }
            thread.labels = labels(of: thread)
            delta.threads.append(thread)
        }
        return delta
    }

    func apply(_ change: MailStore.Change, to thread: MailThread, _ state: inout MailboxState) async throws -> MailDelta {
        let ids = thread.messages.compactMap { ImapID($0.id) }
        return try await session { client in
            var moved: [String: String?] = [:]
            switch change {
            case .modify(let add, let remove):
                if add.contains("UNREAD") { try await flag(ids, #"-FLAGS.SILENT (\Seen)"#, client) }
                if remove.contains("UNREAD") { try await flag(ids, #"+FLAGS.SILENT (\Seen)"#, client) }
                if remove.contains("STARRED") { try await flag(ids, #"-FLAGS.SILENT (\Flagged)"#, client) }
                for (destination, group) in try await moves(ids, add: add, remove: remove, in: thread, client) {
                    moved.merge(try await move(group, to: destination, &state, client)) { $1 }
                }
            case .star(let message):
                if let id = ImapID(message) { try await flag([id], #"+FLAGS.SILENT (\Flagged)"#, client) }
            case .trash:
                let trash = try await path(.trash, client)
                let trashing = ids.filter { $0.path != trash }
                moved = try await move(trashing, to: trash, &state, client)
                // Where each came from, for Restore; kept with the mailbox's state, so it outlives a relaunch.
                var origins = state.trashedFrom ?? [:]
                for id in trashing {
                    if let new = moved[id.id] ?? nil { origins[new] = id.path }
                }
                state.trashedFrom = origins
            case .untrash:
                var origins = state.trashedFrom ?? [:]
                let trashed = ids.filter { role($0.path) == .trash }
                let inbox = roles[.inbox] ?? "INBOX"
                let destination = { (id: ImapID) -> String in
                    guard let origin = origins[id.id], self.folders.contains(where: { $0.path == origin }) else { return inbox }
                    return origin
                }
                for (path, group) in Dictionary(grouping: trashed, by: destination) {
                    moved.merge(try await move(group, to: path, &state, client)) { $1 }
                }
                for id in trashed { origins[id.id] = nil }
                state.trashedFrom = origins
            case .delete:
                let doomed = ids.filter { [.trash, .junk].contains(role($0.path)) }
                if var origins = state.trashedFrom {
                    for id in doomed { origins[id.id] = nil }
                    state.trashedFrom = origins
                }
                for (path, group) in Dictionary(grouping: doomed, by: \.path) {
                    try await client.open(path)
                    try await client.delete(group.map(\.uid))
                }
                var kept = thread
                kept.messages.removeAll { message in doomed.contains { $0.id == message.id } }
                guard !kept.messages.isEmpty else { return MailDelta(removed: [thread.id]) }
                kept.labels = labels(of: kept)
                return MailDelta(threads: [kept])
            }
            guard !moved.isEmpty else { return MailDelta() }
            var updated = thread
            updated.messages = thread.messages.compactMap { message in
                guard let new = moved[message.id] else { return message }
                guard let new else { return nil }
                var message = message
                message.id = new
                return message
            }
            guard !updated.messages.isEmpty else { return MailDelta(removed: [thread.id]) }
            updated.labels = labels(of: updated)
            return MailDelta(threads: [updated])
        }
    }

    private func path(label: String, _ client: ImapClient) async throws -> String? {
        switch label {
        case "INBOX": roles[.inbox]
        case "SENT": try await path(.sent, client)
        case "SPAM": try await path(.junk, client)
        case "TRASH": try await path(.trash, client)
        case "ARCHIVE": try await archive(client)
        default: folders.contains { $0.path == label } ? label : nil
        }
    }

    private func moves(_ ids: [ImapID], add: [String], remove: [String], in thread: MailThread, _ client: ImapClient) async throws -> [String: [ImapID]] {
        let isFolder = { (label: String) in
            ["INBOX", "TRASH", "SPAM", "ARCHIVE"].contains(label) || self.folders.contains { $0.path == label && self.role(label) == nil }
        }
        if let target = add.first(where: isFolder) {
            guard let destination = try await path(label: target, client) else { return [:] }
            let kept = (target == "TRASH" ? [] : Set(["SENT", "DRAFT", "TRASH", "SPAM"])).subtracting(remove)
            let others = ids.filter { $0.path != destination }
            var movable = others.filter { !kept.contains(role($0.path)?.label ?? "") }
            if movable.isEmpty { movable = others.filter { role($0.path) != .drafts } }
            if target == "SPAM" || remove.contains("SPAM") {
                let seen = movable.filter { label($0.path).map(remove.contains) ?? false }
                movable = seen.isEmpty ? Array(movable.suffix(1)) : seen
            }
            return [destination: movable]
        }
        let archived = remove.filter { $0 == "INBOX" || isFolder($0) && !["TRASH", "SPAM", "ARCHIVE"].contains($0) }
        if !archived.isEmpty {
            return [try await archive(client): ids.filter { label($0.path).map(archived.contains) ?? false }]
        }
        let back = ids.filter { id in role(id.path).map { [.junk, .archive].contains($0) && remove.contains($0.label) } ?? false }
        guard !back.isEmpty else { return [:] }
        let own = Set(thread.messages.filter { $0.from.isAddress(email) }.map(\.id))
        var moves: [String: [ImapID]] = [:]
        for id in back {
            let destination = if own.contains(id.id) { try await path(.sent, client) } else { roles[.inbox] ?? "INBOX" }
            moves[destination, default: []].append(id)
        }
        return moves
    }

    private func flag(_ ids: [ImapID], _ change: String, _ client: ImapClient) async throws {
        for (path, group) in Dictionary(grouping: ids, by: \.path) {
            try await client.open(path)
            try await client.store(group.map(\.uid), change)
        }
    }

    private func move(_ ids: [ImapID], to destination: String, _ state: inout MailboxState, _ client: ImapClient) async throws -> [String: String?] {
        let movers = ids.filter { $0.path != destination }
        guard !movers.isEmpty else { return [:] }
        let validity = try await track(destination, &state, client)
        var out: [String: String?] = [:]
        for (path, group) in Dictionary(grouping: movers, by: \.path) {
            try await client.open(path)
            // Out of Gmail's All Mail, only a copy: there, taking it out would delete it.
            let uids = if path == allMail {
                try await client.copy(group.map(\.uid), to: destination)
            } else {
                try await client.move(group.map(\.uid), to: destination)
            }
            for id in group {
                out.updateValue(uids[id.uid].map { ImapID(validity: validity, uid: $0, path: destination).id }, forKey: id.id)
            }
        }
        return out
    }

    func refresh(_ thread: MailThread, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta {
        let ids = thread.messages.compactMap { ImapID($0.id) }
        return try await session { client in
            var flags: [String: Set<String>] = [:]
            for (path, group) in Dictionary(grouping: ids, by: \.path) {
                guard (try? await client.select(path)) != nil else { continue }
                for response in try await client.fetch(imapSet(group.map(\.uid)), "(UID FLAGS)") {
                    let items = response.values.first?.pairs ?? [:]
                    guard let uid = items["UID"]?.number, !Self.isDeleted(items) else { continue }
                    let id = ImapID(validity: group[0].validity, uid: UInt32(clamping: uid), path: path).id
                    flags[id] = Set(items["FLAGS"]?.list.compactMap { $0.text?.lowercased() } ?? [])
                }
            }
            var updated = thread
            updated.messages = thread.messages.compactMap { message in
                guard let flags = flags[message.id] else { return nil }
                var message = message
                message.unread = !flags.contains("\\seen")
                message.starred = flags.contains("\\flagged")
                return message
            }
            guard !updated.messages.isEmpty else { return MailDelta(removed: [thread.id]) }
            updated.labels = labels(of: updated)
            return MailDelta(threads: [updated])
        }
    }

    func send(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta {
        guard let password = Self.password(email) else { throw ImapError.signedOut }
        try await SMTP.send(message.raw, from: message.from, to: message.recipients, server: settings.smtp, username: settings.username, auth: .password(password))
        do {
            return try await session { client in
                // Gmail and Outlook file what their SMTP sends; a copy would make two.
                if !Self.filesSentMail(settings.smtp.host) {
                    let sent = try await path(.sent, client)
                    try await track(sent, &state, client)
                    _ = try await client.append(message.raw, to: sent, flags: #"\Seen"#)
                }
                if let draft = message.draft.flatMap(ImapID.init) { try await deleteDraft(draft, known: known, client) }
                var changes = Changes()
                try await catchUp(&state, known: known, client, &changes)
                return merge(known, changes)
            }
        } catch {
            return MailDelta()
        }
    }

    private static func filesSentMail(_ host: String) -> Bool {
        let host = host.lowercased()
        return ["gmail.com", "googlemail.com", "office365.com", "outlook.com"].contains { host.hasSuffix($0) }
    }

    func saveDraft(_ message: Outgoing, _ state: inout MailboxState, known: [MailThread]) async throws -> MailDelta {
        try await session { client in
            let drafts = try await path(.drafts, client)
            try await track(drafts, &state, client)
            _ = try await client.append(message.raw, to: drafts, flags: #"\Draft \Seen"#)
            if let previous = message.draft.flatMap(ImapID.init) { try await deleteDraft(previous, known: known, client) }
            var changes = Changes()
            try await catchUp(&state, known: known, client, &changes)
            return merge(known, changes)
        }
    }

    func deleteDraft(_ messageID: String, _ state: inout MailboxState) async throws {
        guard let id = ImapID(messageID) else { return }
        try await session { client in try await deleteDraft(id, known: [], client) }
    }

    /**
     * Deletes a draft's earlier version, only if its UID still names it: the
     * folder's UIDVALIDITY unchanged, a draft, and (when the copy here has
     * one) the same Message-ID.
     */
    private func deleteDraft(_ id: ImapID, known: [MailThread], _ client: ImapClient) async throws {
        guard try await client.select(id.path).uidValidity == id.validity else { return }
        let response = try await client.fetch("\(id.uid)", "(UID FLAGS BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])").first
        let items = response?.values.first?.pairs ?? [:]
        let flags = items["FLAGS"]?.list.compactMap { $0.text?.lowercased() } ?? []
        guard items["UID"]?.number == UInt64(id.uid), flags.contains("\\draft") || role(id.path) == .drafts else { return }
        let expected = known.lazy.flatMap(\.messages).first { $0.id == id.id }?.headers["Message-ID"]
        if let expected = expected.flatMap(Self.messageID) {
            let header = items.first { $0.key.hasPrefix("BODY[HEADER") }?.value.text ?? ""
            guard MailDecoding.header("Message-ID", in: header).flatMap(Self.messageID) == expected else { return }
        }
        try await client.delete([id.uid])
    }

    /** A Message-ID as `<local@domain>`, or nil when it isn't one (empty, or without its brackets). */
    private static func messageID(_ text: String) -> String? {
        let text = text.trimmingCharacters(in: .whitespaces)
        return text.wholeMatch(of: /<[^<>\s]+>/) != nil ? text : nil
    }

    func attachment(_ attachment: Attachment, of message: Message) async throws -> Data {
        guard let id = ImapID(message.id), let spec = attachment.id?.split(separator: " "), spec.count == 2 else {
            throw ImapError.protocolError("No file to open.")
        }
        return try await session { client in
            try await client.open(id.path)
            let response = try await client.fetch("\(id.uid)", "(UID BODY.PEEK[\(spec[0])])").first
            guard let data = response?.values.first?.pairs["BODY[\(spec[0])]"]?.data else {
                throw ImapError.server("The file isn't on the server anymore.")
            }
            return MailDecoding.transfer(data, encoding: String(spec[1]))
        }
    }

    func signature() async throws -> String? { nil }
    func setSignature(_ html: String) async throws -> String { html }

    /**
     * IDLE on the inbox, on a connection of its own, while the app is open:
     * each change there syncs. A new IDLE every 25 minutes (servers drop them
     * after 30), reconnecting with backoff. Servers without IDLE sync when
     * the app opens or is pulled to refresh. A refused password stops it:
     * retrying would only get the account locked.
     */
    func watch(pushTopic: String?, _ state: inout MailboxState, onChange: @escaping () -> Void) async -> Task<Void, Never>? {
        guard let password = Self.password(email) else { return nil }
        let settings = settings
        let inbox = roles[.inbox] ?? "INBOX"
        return Task {
            var delay = Duration.seconds(2)
            while !Task.isCancelled {
                do {
                    let client = try await ImapClient.connect(settings.imap, username: settings.username, auth: .password(password))
                    defer { client.close() }
                    guard await client.capabilities.contains("IDLE") else { return }
                    try await client.select(inbox)
                    while !Task.isCancelled {
                        let started = ContinuousClock.now
                        if try await client.idle(for: .seconds(25 * 60)) { onChange() }
                        let lasted = ContinuousClock.now - started
                        if lasted > .seconds(60) { delay = .seconds(2) }
                        // A server that ends every IDLE at once mustn't be asked again at once.
                        if lasted < .seconds(5) { try await Task.sleep(for: .seconds(5) - lasted) }
                    }
                } catch ImapError.authentication {
                    onChange()
                    return
                } catch {
                    try? await Task.sleep(for: delay)
                    delay = min(delay * 2, .seconds(300))
                }
            }
        }
    }
}

/** An IMAP message's id in the app: `<uidvalidity>:<uid>:<folder path>`. */
nonisolated struct ImapID: Hashable {
    var validity: UInt32
    var uid: UInt32
    var path: String

    init(validity: UInt32, uid: UInt32, path: String) {
        self.validity = validity
        self.uid = uid
        self.path = path
    }

    init?(_ id: String) {
        let parts = id.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        guard parts.count == 3, let validity = UInt32(parts[0]), let uid = UInt32(parts[1]) else { return nil }
        self.init(validity: validity, uid: uid, path: String(parts[2]))
    }

    var id: String { "\(validity):\(uid):\(path)" }
}
