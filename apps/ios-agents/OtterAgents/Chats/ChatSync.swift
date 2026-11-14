import Foundation

/**
 * The store's chats as the account keeps them (core's services/chats.ts): read from this iPhone's
 * copy (`AgentSync`), a chat and each of its turns an entry. A change here is saved as the fields
 * and turns that changed, so a long chat that streams writes one turn, not itself whole; what
 * other devices wrote comes in with each exchange. A chat's turns are read when it's opened.
 */
final class ChatSync {
    private let store: ChatStore
    private let sync: AgentSync
    private var saving: [String: Task<Void, Never>] = [:]

    init(store: ChatStore, sync: AgentSync) {
        self.store = store
        self.sync = sync
        let chats = sync.copy.entries("chat/").compactMap { Chat($0.value) }.sorted { $0.updatedAt > $1.updatedAt }
        store.replace(chats: store.chats.filter(\.isBlank) + chats)
    }

    /** An exchange is on its way: a chat not here yet may still come with it. */
    var isSyncing: Bool { sync.isSyncing }

    // MARK: Changes made here

    /** A chat changed here. `settled`: no turn runs in it, so other devices can have it now (else in a moment). */
    func changed(_ id: String, settled: Bool = false) {
        guard let chat = store.chat(id), !chat.isBlank, chat.loaded else { return }
        if settled {
            saving[id]?.cancel()
            saving[id] = nil
        }
        guard saving[id] == nil else { return }
        saving[id] = Task {
            try? await Task.sleep(for: .milliseconds(settled ? 50 : 300))
            guard !Task.isCancelled else { return }
            saving[id] = nil
            save(id, settled: settled)
        }
    }

    private func save(_ id: String, settled: Bool) {
        guard let chat = store.chat(id), !chat.isBlank, chat.loaded, case .object(var record) = chat.json else { return }
        let before = sync.copy.get(AgentEntries.chatKey(id))
        if before == .null { return }
        record["turns"] = nil
        var fields = before?.object.map { stored in record.filter { (stored[$0.key] ?? .null) != $0.value } } ?? record
        let stored = before == nil ? [] : sync.copy.turns(of: id)
        let storedIds = stored.compactMap { $0["id"]?.string }
        let storedTurns = Dictionary(stored.compactMap { turn in turn["id"]?.string.map { ($0, turn) } }) { first, _ in first }
        let ids = chat.turns.map(\.id)
        let put = chat.turns.map(\.json).filter { turn in turn["id"]?.string.flatMap { storedTurns[$0] } != turn }
        var mutations: [JSON] = []
        if !fields.isEmpty {
            fields["id"] = .string(id)
            mutations.append(AgentMutation.setChat(fields))
        }
        if !put.isEmpty || storedIds != ids {
            mutations.append(AgentMutation.turns(id, put: put, order: ids, removed: storedIds.filter { !Set(ids).contains($0) }))
        }
        sync.mutate(mutations, delay: .milliseconds(settled ? 100 : 300))
    }

    func deleted(_ id: String) {
        saving.removeValue(forKey: id)?.cancel()
        sync.mutate([AgentMutation.deleteChat(id)], delay: .zero)
    }

    // MARK: What the account has

    /** Reads a chat's turns from the copy, once. */
    func load(_ id: String) {
        guard let chat = store.chat(id), !chat.loaded else { return }
        let turns = sync.copy.turns(of: id).compactMap(ChatTurn.init)
        store.update(id, save: false) {
            $0.turns = turns
            $0.loaded = true
        }
    }

    /** Another device changed these entries (by key): the chats they're of are read again, but those running or saving here. */
    func heard(_ keys: Set<String>) {
        let ids = Set(keys.compactMap { key -> String? in
            let parts = AgentEntries.segments(key)
            return (parts[0] == "chat" || parts[0] == "turn") && parts.count > 1 ? parts[1] : nil
        })
        for id in ids where store.runs[id] == nil {
            guard var chat = sync.copy.get(AgentEntries.chatKey(id)).flatMap(Chat.init) else {
                saving.removeValue(forKey: id)?.cancel()
                store.remove(id)
                continue
            }
            guard saving[id] == nil else { continue }
            guard let local = store.chat(id) else {
                store.insert(chat)
                continue
            }
            if local.loaded {
                chat.turns = sync.copy.turns(of: id).compactMap(ChatTurn.init)
                chat.loaded = true
            }
            store.update(id, save: false) { $0 = chat }
        }
    }

    /** Signed out: what's still to save stays unsaved. */
    func forget() {
        saving.values.forEach { $0.cancel() }
        saving = [:]
    }
}
