import Foundation

/**
 * This iPhone's copy of the account's agents and chats (`AgentEntries`), on disk so the app opens
 * on it at once. Agents and chats are read from here; secrets' values are in the Keychain (the
 * copy only marks that one exists). Each chat's turns are a file of their own, read when first
 * needed.
 */
final class AgentCopy: AgentStore {
    private var main: [String: JSON] = [:]
    private var turns: [String: [String: JSON]] = [:]
    let directory: URL?
    /** What's to be written: nil for `main`, else a chat's turns. */
    private var dirty: Set<String?> = []
    /** While `track` runs: each entry as it was before, and secrets that changed. */
    private var before: [String: JSON?]?
    private var secretsChanged: Set<String> = []

    /** `directory` nil: kept in memory alone (the demo's, or nobody's). */
    init(directory: URL?) {
        self.directory = directory
        guard let directory else { return }
        main = (try? JSON(parsing: Data(contentsOf: directory.appending(path: "entries.json"))))?.object ?? [:]
    }

    private func turnsFile(_ chat: String) -> URL? { directory?.appending(path: "turns/\(chat).json") }

    private func turnsOf(_ chat: String) -> [String: JSON] {
        if let loaded = turns[chat] { return loaded }
        let read = turnsFile(chat).flatMap { try? JSON(parsing: Data(contentsOf: $0)) }?.object ?? [:]
        turns[chat] = read
        return read
    }

    // MARK: AgentStore

    func get(_ key: String) -> JSON? {
        let parts = AgentEntries.segments(key)
        return parts[0] == "turn" && parts.count == 3 ? turnsOf(parts[1])[key] : main[key]
    }

    func set(_ key: String, _ value: JSON) {
        let parts = AgentEntries.segments(key)
        var value = value
        if parts[0] == "secret", parts.count == 3 {
            keepSecret(agent: parts[1], name: parts[2], value.string)
            value = value == .null ? .null : true
        }
        let current = get(key)
        guard current != value else { return }
        if before != nil, before?[key] == nil { before?[key] = .some(current) }
        if parts[0] == "turn", parts.count == 3 {
            var chat = turnsOf(parts[1])
            chat[key] = value
            turns[parts[1]] = chat
            dirty.insert(parts[1])
        } else {
            main[key] = value
            dirty.insert(nil)
        }
    }

    func turnKeys(_ chat: String) -> [String] { Array(turnsOf(chat).keys) }

    func removeTurns(_ chat: String) {
        for (key, value) in turnsOf(chat) where before != nil && before?[key] == nil { before?[key] = .some(value) }
        turns[chat] = [:]
        dirty.insert(chat)
    }

    func deviceKeys(_ agent: String) -> [String] { keys("agent-device/\(agent)/") }
    func secretKeys(_ agent: String) -> [String] { keys("secret/\(agent)/") }

    private func keys(_ prefix: String) -> [String] { main.keys.filter { $0.hasPrefix(prefix) } }

    /** An account's secret goes to the Keychain; one that pairs this iPhone alone is never taken from another device. */
    private func keepSecret(agent: String, name: String, _ value: String?) {
        let kind = main[AgentEntries.agentKey(agent)]?["kind"]?.string.flatMap(AgentKind.init)
        guard kind?.deviceSecrets.contains(name) != true else { return }
        let stored = "agent:\(agent):\(name)"
        guard Keychain.get(stored) != value else { return }
        Keychain.set(stored, value)
        secretsChanged.insert(AgentEntries.secretKey(agent, name))
    }

    // MARK: Reading

    /** What really changed in `work` (an entry written and written back is the same), by key. */
    func track(_ work: () -> Void) -> Set<String> {
        before = [:]
        secretsChanged = []
        work()
        let was = before ?? [:]
        before = nil
        return Set(was.filter { key, value in (get(key) ?? .null) != (value ?? .null) }.keys).union(secretsChanged)
    }

    /** The entries under `prefix` that are there (not gone), but turns. */
    func entries(_ prefix: String) -> [(key: String, value: JSON)] {
        main.filter { $0.key.hasPrefix(prefix) && $0.value != .null }.map { ($0.key, $0.value) }
    }

    /** A chat's turns, in their order. */
    func turns(of chat: String) -> [JSON] {
        turnsOf(chat).compactMap { key, record in record["turn"].map { (record["position"]?.number ?? 0, key, $0) } }
            .sorted { ($0.0, $0.1) < ($1.0, $1.1) }
            .map(\.2)
    }

    // MARK: Keeping it

    func save() {
        guard let directory, !dirty.isEmpty else { return }
        try? FileManager.default.createDirectory(at: directory.appending(path: "turns"), withIntermediateDirectories: true)
        for part in dirty {
            guard let chat = part else {
                try? JSON.object(main).data.write(to: directory.appending(path: "entries.json"), options: .atomic)
                continue
            }
            guard let file = turnsFile(chat) else { continue }
            if let chatTurns = turns[chat], !chatTurns.isEmpty {
                try? JSON.object(chatTurns).data.write(to: file, options: .atomic)
            } else {
                try? FileManager.default.removeItem(at: file)
            }
        }
        dirty = []
    }

    /** Every entry goes (the next exchange reads the account's whole); secrets stay in the Keychain until written again. */
    func clear() {
        main = [:]
        turns = [:]
        dirty = []
        if let directory {
            try? FileManager.default.removeItem(at: directory.appending(path: "entries.json"))
            try? FileManager.default.removeItem(at: directory.appending(path: "turns"))
        }
    }

    /** Signing out: the account's secrets leave the Keychain with it. */
    func forgetSecrets() {
        for (key, _) in entries("secret/") {
            let parts = AgentEntries.segments(key)
            guard parts.count == 3 else { continue }
            let kind = main[AgentEntries.agentKey(parts[1])]?["kind"]?.string.flatMap(AgentKind.init)
            if kind?.deviceSecrets.contains(parts[2]) != true { Keychain.set("agent:\(parts[1]):\(parts[2])", nil) }
        }
    }
}

/**
 * The copy in step with the account (core's services/agent-sync.ts): a change is applied to the
 * copy at once and kept in the outbox until the relay has it; each exchange sends the outbox,
 * takes what changed since, writes that over the copy and applies again what the relay hasn't had
 * yet. Without a relay (the demo's, or nobody's), changes stay here.
 */
final class AgentSync {
    let copy: AgentCopy
    /** This iPhone, for the settings that are its own. */
    let device: String
    private let relay: Relay?
    private var client: String
    private var since: Int
    private var nextId: Int
    private(set) var outbox: [(id: Int, mutation: JSON)]
    /** The last mutation sent: the relay may have applied it, so none up to it can change under its id. */
    private var sent: Int
    /** What other devices changed, by key, after an exchange. */
    var onChange: (Set<String>) -> Void = { _ in }

    private var timer: (at: ContinuousClock.Instant, task: Task<Void, Never>)?
    private var running: Task<Void, Never>?
    private var again = false
    private var failures = 0
    /** The relay refused a batch: they go one by one until the one it can't take is found, and dropped. */
    private var oneByOne = false
    private var saving: Task<Void, Never>?
    private var closed = false

    private static let deviceKey = "agent-sync:device"
    private static let retry: [Duration] = [.seconds(2), .seconds(5), .seconds(15), .seconds(60)]
    private static let partBytes = 1_000_000

    /** An account's copy, kept on disk under its user; without one, in memory alone. */
    init(user: String? = nil, relay: Relay? = nil) {
        if let id = UserDefaults.standard.string(forKey: Self.deviceKey) {
            device = id
        } else {
            device = UUID().uuidString.lowercased()
            UserDefaults.standard.set(device, forKey: Self.deviceKey)
        }
        self.relay = relay
        let directory = user.map { URL.applicationSupportDirectory.appending(path: "AgentSync/\(Self.folder($0))", directoryHint: .isDirectory) }
        copy = AgentCopy(directory: directory)
        let state = directory.flatMap { try? JSON(parsing: Data(contentsOf: $0.appending(path: "state.json"))) }
        client = state?["client"]?.string ?? UUID().uuidString.lowercased()
        since = state?["since"]?.count ?? 0
        outbox = (state?["outbox"]?.array ?? []).compactMap { row in
            guard let id = row["id"]?.count, let mutation = row["mutation"] else { return nil }
            return (id, mutation)
        }
        nextId = max(state?["nextId"]?.count ?? 1, (outbox.last?.id ?? 0) + 1)
        sent = state?["sent"]?.count ?? 0
    }

    /** A user's folder, by its id. */
    static func folder(_ user: String) -> String {
        Data(user.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
    }

    var isSyncing: Bool { running != nil }

    // MARK: Changes made here

    /** Applies the mutations here and sends them to the relay soon: in `delay`, or with what goes first. */
    func mutate(_ given: [JSON], delay: Duration = .milliseconds(300)) {
        let mutations = given.flatMap(Self.parts)
        guard !mutations.isEmpty, !closed else { return }
        for mutation in mutations {
            AgentEntries.apply(mutation, to: copy)
            let at = joinable(mutation)
            let both = at.map { Self.joined(outbox[$0].mutation, mutation) }
            // Parts stay parts: joined, a long chat's upload would be more than the relay takes.
            if let at, let both, AgentEntries.bytes(both) <= Self.partBytes {
                outbox[at].mutation = both
            } else {
                outbox.append((nextId, mutation))
                nextId += 1
            }
        }
        save()
        request(delay)
    }

    /** The unsent mutation this one can join, so a streaming turn sends its latest, not each step. */
    private func joinable(_ mutation: JSON) -> Int? {
        func plain(_ m: JSON) -> Bool {
            (m["op"] == "turns" && m["imported"]?.bool != true) || (m["op"] == "chat.set" && m["ifNewer"]?.bool != true)
        }
        guard plain(mutation) else { return nil }
        let op = mutation["op"]?.string
        let chat = op == "turns" ? mutation["chat"]?.string : mutation["chat"]?["id"]?.string
        // Only what was never sent: one the relay may have applied can't change under its id.
        for index in outbox.indices.reversed() where outbox[index].id > sent {
            let queued = outbox[index].mutation
            if queued["op"] == "chat.delete", queued["id"]?.string == chat { return nil }
            guard queued["op"]?.string == op, plain(queued) else { continue }
            if op == "turns", queued["chat"]?.string == chat { return index }
            if op == "chat.set", queued["chat"]?["id"]?.string == chat { return index }
        }
        return nil
    }

    static func joined(_ queued: JSON, _ mutation: JSON) -> JSON {
        switch (queued["op"]?.string, mutation["op"]?.string) {
        case ("chat.set", "chat.set"):
            let chat = (queued["chat"]?.object ?? [:]).merging(mutation["chat"]?.object ?? [:]) { _, new in new }
            return AgentMutation.setChat(chat)
        case ("turns", "turns"):
            var ids: [String] = []
            var put: [String: JSON] = [:]
            for turn in (queued["put"]?.array ?? []) + (mutation["put"]?.array ?? []) {
                guard let id = turn["id"]?.string else { continue }
                if put[id] == nil { ids.append(id) }
                put[id] = turn
            }
            let order = (mutation["order"]?.array ?? []).compactMap(\.string)
            let kept = Set(order)
            var removed: [String] = []
            for id in ((queued["removed"]?.array ?? []) + (mutation["removed"]?.array ?? [])).compactMap(\.string)
            where !kept.contains(id) && !removed.contains(id) { removed.append(id) }
            return AgentMutation.turns(mutation["chat"]?.string ?? "", put: ids.filter(kept.contains).compactMap { put[$0] }, order: order, removed: removed)
        default:
            return mutation
        }
    }

    /** A chat's turns written at once go in parts the relay takes. */
    static func parts(_ mutation: JSON) -> [JSON] {
        guard mutation["op"] == "turns", case .object(var part) = mutation else { return [mutation] }
        var out: [JSON] = []
        var turns: [JSON] = []
        var size = 0
        for turn in (mutation["put"]?.array ?? []).map(AgentEntries.fitTurn) {
            let bytes = AgentEntries.bytes(turn)
            if !turns.isEmpty, size + bytes > partBytes {
                part["put"] = .array(turns)
                out.append(.object(part))
                turns = []
                size = 0
            }
            turns.append(turn)
            size += bytes
        }
        part["put"] = .array(turns)
        out.append(.object(part))
        return out
    }

    // MARK: Exchanging with the relay

    /** An exchange with the relay, in `delay` or sooner if one was already due sooner. */
    func request(_ delay: Duration = .zero) {
        guard relay?.isSignedIn == true, !closed else { return }
        let at = ContinuousClock.now + delay
        if let timer, timer.at <= at { return }
        timer?.task.cancel()
        timer = (at, Task { [weak self] in
            try? await Task.sleep(until: at)
            guard !Task.isCancelled, let self else { return }
            self.timer = nil
            await self.sync()
        })
    }

    /** Exchanges with the relay until the outbox is empty and every change is here. */
    func sync() async {
        if let running {
            again = true
            return await running.value
        }
        let task = Task {
            do {
                repeat {
                    again = false
                    try await exchange()
                } while again
                failures = 0
            } catch {
                let delay = Self.retry[min(failures, Self.retry.count - 1)]
                failures += 1
                request(delay)
            }
            running = nil
        }
        running = task
        await task.value
    }

    private func batch() -> [(id: Int, mutation: JSON)] {
        var batch: [(id: Int, mutation: JSON)] = []
        var size = 0
        for row in outbox.prefix(oneByOne ? 1 : AgentEntries.batch.mutations) {
            let bytes = AgentEntries.bytes(row.mutation)
            if !batch.isEmpty, size + bytes > AgentEntries.batch.bytes { break }
            size += bytes
            batch.append(row)
        }
        return batch
    }

    private func exchange() async throws {
        guard let relay else { return }
        while !closed {
            let mutations = batch()
            if let last = mutations.last?.id, last > sent {
                sent = last
                saveNow()
            }
            let response: Relay.AgentSyncResponse
            do {
                response = try await relay.agentSync(client: client, since: since, mutations: mutations)
            } catch let failure as Relay.Failure where [400, 413].contains(failure.status) && !mutations.isEmpty {
                guard !closed else { return }
                if mutations.count > 1 {
                    oneByOne = true
                } else {
                    // What it did here goes too: the copy is read again whole, under what's still to send.
                    outbox.removeAll { $0.id == mutations[0].id }
                    copy.clear()
                    since = 0
                    save()
                }
                continue
            }
            if mutations.count == 1 { oneByOne = false }
            guard !closed else { return }
            let changed = copy.track {
                outbox.removeAll { $0.id <= response.lastMutationId }
                for change in response.changes {
                    copy.set(change.key, change.value)
                    let parts = AgentEntries.segments(change.key)
                    if change.value == .null, parts[0] == "chat", parts.count == 2 { copy.removeTurns(parts[1]) }
                }
                for row in outbox { AgentEntries.apply(row.mutation, to: copy) }
            }
            since = response.version
            save()
            if !changed.isEmpty { onChange(changed) }
            if !response.more && outbox.isEmpty { return }
        }
    }

    // MARK: Keeping it

    /** Written in a moment: a turn that streams saves once a second, not at each word. */
    private func save() {
        guard copy.directory != nil, saving == nil else { return }
        saving = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1))
            self?.saving = nil
            self?.saveNow()
        }
    }

    func saveNow() {
        guard let directory = copy.directory, !closed else { return }
        copy.save()
        let state: JSON = .object([
            "client": .string(client),
            "since": .number(Double(since)),
            "nextId": .number(Double(nextId)),
            "sent": .number(Double(sent)),
            "outbox": .array(outbox.map { .object(["id": .number(Double($0.id)), "mutation": $0.mutation]) }),
        ])
        try? state.data.write(to: directory.appending(path: "state.json"), options: .atomic)
    }

    /** Signing out of this iPhone: the account's agents, chats and secrets leave it with the account. */
    func forget() {
        closed = true
        timer?.task.cancel()
        saving?.cancel()
        copy.forgetSecrets()
        if let directory = copy.directory { try? FileManager.default.removeItem(at: directory) }
    }
}
