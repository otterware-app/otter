import Foundation

/**
 * Keeps the store's chats on disk and in step with the account (core's services/chats.ts): a
 * change is written here at once and to the relay soon after; what other devices wrote is
 * pulled on connecting and on the relay's `chats` event. The list comes without turns, so a
 * chat's turns are read when it's opened and kept from then on.
 */
final class ChatSync {
    private let store: ChatStore
    private let relay: Relay
    private let directory: URL
    /** Chats changed here that the relay doesn't have yet. */
    private var pending: Set<String>
    private var deleted: Set<String>
    private var saving: [String: Task<Void, Never>] = [:]
    private var pushing: Task<Void, Never>?
    private var loading: [String: Task<Void, Never>] = [:]
    private var lastPush: [String: Date] = [:]
    private(set) var isPulling = false

    private static let streamingPush: TimeInterval = 15
    private var pendingKey: String { "chat-pending:" + directory.lastPathComponent }
    private var deletedKey: String { "chat-deleted:" + directory.lastPathComponent }

    init(store: ChatStore, relay: Relay, userId: String) {
        self.store = store
        self.relay = relay
        let name = Data(userId.utf8).base64EncodedString().replacingOccurrences(of: "/", with: "_")
        directory = URL.applicationSupportDirectory.appending(path: "Chats/\(name)", directoryHint: .isDirectory)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        pending = Set(UserDefaults.standard.stringArray(forKey: "chat-pending:" + name) ?? [])
        deleted = Set(UserDefaults.standard.stringArray(forKey: "chat-deleted:" + name) ?? [])
        let cached = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let list = (try? JSON(parsing: Data(contentsOf: directory.appending(path: "list.json"))))?.array ?? []
        let full = Set(cached.map { $0.deletingPathExtension().lastPathComponent })
        var chats = store.chats.filter(\.isBlank)
        for summary in list {
            guard let listed = Chat(summary) else { continue }
            // One opened before is read whole, so it shows at once.
            chats.append(full.contains(listed.id) ? read(listed.id) ?? listed : listed)
        }
        store.replace(chats: chats)
    }

    private func file(_ id: String) -> URL { directory.appending(path: "\(id).json") }

    private func read(_ id: String) -> Chat? {
        (try? JSON(parsing: Data(contentsOf: file(id)))).flatMap(Chat.init)
    }

    private func writeList() {
        let summaries = store.chats.filter { !$0.isBlank }.map { chat -> JSON in
            guard case .object(var object) = chat.json else { return .null }
            object["turns"] = nil
            return .object(object)
        }
        try? JSON.array(summaries).data.write(to: directory.appending(path: "list.json"), options: .atomic)
    }

    private func keepPending() {
        UserDefaults.standard.set(Array(pending), forKey: pendingKey)
        UserDefaults.standard.set(Array(deleted), forKey: deletedKey)
    }

    // MARK: Changes made here

    /** A chat changed here. `settled`: no turn runs in it, so other devices can have it now (else in a while). */
    func changed(_ id: String, settled: Bool? = nil) {
        guard let chat = store.chat(id), !chat.isBlank, chat.loaded else { return }
        pending.insert(id)
        keepPending()
        saving[id]?.cancel()
        saving[id] = Task {
            try? await Task.sleep(for: .milliseconds(settled == true ? 50 : 600))
            guard !Task.isCancelled, let chat = store.chat(id) else { return }
            try? chat.json.data.write(to: file(id), options: .atomic)
            writeList()
            saving[id] = nil
            push()
        }
    }

    func deleted(_ id: String) {
        pending.remove(id)
        deleted.insert(id)
        keepPending()
        try? FileManager.default.removeItem(at: file(id))
        writeList()
        push()
    }

    private func push() {
        guard pushing == nil else { return }
        pushing = Task {
            defer { pushing = nil }
            for id in deleted {
                guard (try? await relay.deleteChat(id)) != nil else { continue }
                deleted.remove(id)
            }
            for id in pending {
                guard let chat = store.chat(id) else { pending.remove(id); continue }
                // A turn streaming is told to the other devices every so often, not at each word.
                if store.runs[id] != nil, let last = lastPush[id], Date.now.timeIntervalSince(last) < Self.streamingPush { continue }
                do {
                    try await relay.putChat(chat.forSync.anyObject)
                    lastPush[id] = .now
                    if store.chat(id)?.updatedAt == chat.updatedAt { pending.remove(id) }
                } catch let failure as Relay.Failure where failure.status == 409 {
                    // Another device wrote it since: its copy stands, unless a turn runs in it here.
                    pending.remove(id)
                    if store.runs[id] == nil { await fetch(id, replacing: true) }
                } catch let failure as Relay.Failure where [400, 404, 413].contains(failure.status) {
                    pending.remove(id)
                } catch {
                    break
                }
            }
            keepPending()
            if store.runs.keys.contains(where: pending.contains) {
                Task {
                    try? await Task.sleep(for: .seconds(Self.streamingPush))
                    push()
                }
            }
        }
    }

    // MARK: What the account has

    func pull() async {
        guard !isPulling, let listed = try? await relay.chats() else { return }
        isPulling = true
        defer { isPulling = false }
        var remote: [String: Chat] = [:]
        var gone: Set<String> = []
        for object in listed {
            let json = JSON(any: object)
            if let chat = Chat(json) { remote[chat.id] = chat } else if let id = json["id"]?.string { gone.insert(id) }
        }
        for id in gone where store.chat(id) != nil && store.runs[id] == nil {
            pending.remove(id)
            store.remove(id)
            try? FileManager.default.removeItem(at: file(id))
        }
        var refresh: [String] = []
        for (id, listed) in remote where !pending.contains(id) && store.runs[id] == nil {
            guard let local = store.chat(id) else {
                store.insert(listed)
                continue
            }
            guard listed.updatedAt > local.updatedAt else { continue }
            if local.loaded { refresh.append(id) } else { store.update(id, save: false) { $0 = listed } }
        }
        // A chat here that the account never had is one it should get.
        for chat in store.chats where !chat.isBlank && chat.loaded && remote[chat.id] == nil && !gone.contains(chat.id) {
            pending.insert(chat.id)
        }
        keepPending()
        writeList()
        store.replace(chats: store.chats)
        for id in refresh { await fetch(id, replacing: true) }
        if !pending.isEmpty || !deleted.isEmpty { push() }
    }

    /** Reads a chat's turns, once: from this iPhone when it has them, else from the account. */
    func load(_ id: String) async {
        guard let chat = store.chat(id), !chat.loaded else { return }
        if let task = loading[id] { return await task.value }
        let task = Task { await fetch(id, replacing: false) }
        loading[id] = task
        await task.value
        loading[id] = nil
    }

    private func fetch(_ id: String, replacing: Bool) async {
        guard let object = try? await relay.chat(id), let remote = Chat(JSON(any: object)) else { return }
        guard let local = store.chat(id), store.runs[id] == nil, replacing || !local.loaded else { return }
        let merged = Self.merged(remote, local)
        store.update(id, save: false) { $0 = merged }
        try? merged.json.data.write(to: file(id), options: .atomic)
        writeList()
    }

    /** The account's copy wins, with what the relay drops of this iPhone's: its turns from before the ones kept. */
    static func merged(_ remote: Chat, _ local: Chat) -> Chat {
        guard local.loaded, let first = remote.turns.first, let at = local.turns.firstIndex(where: { $0.id == first.id }), at > 0 else { return remote }
        var merged = remote
        merged.turns = Array(local.turns[..<at]) + remote.turns
        return merged
    }

    /** Signed out: nothing of the account stays on this iPhone. */
    func forget() {
        saving.values.forEach { $0.cancel() }
        pushing?.cancel()
        try? FileManager.default.removeItem(at: directory)
        UserDefaults.standard.removeObject(forKey: pendingKey)
        UserDefaults.standard.removeObject(forKey: deletedKey)
    }
}

extension JSON {
    /** From what `JSONSerialization` reads. */
    nonisolated init(any value: Any) {
        switch value {
        case let value as String: self = .string(value)
        case let value as NSNumber:
            self = CFGetTypeID(value) == CFBooleanGetTypeID() ? .bool(value.boolValue) : .number(value.doubleValue)
        case let value as [Any]: self = .array(value.map(JSON.init(any:)))
        case let value as [String: Any]: self = .object(value.mapValues(JSON.init(any:)))
        default: self = .null
        }
    }

    nonisolated var anyObject: [String: Any] {
        (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
