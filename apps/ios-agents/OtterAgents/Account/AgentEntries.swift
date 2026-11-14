import Foundation

/**
 * The account's agents and chats as entries (packages/contracts' agent-sync.ts): the relay keeps
 * them, every device keeps a copy, and a change is a mutation that `apply` turns into entries,
 * the same here as on the relay and every other device.
 *
 *   agent/<id>                    what every device shares of an agent
 *   agent-device/<id>/<device>    one device's own settings for it
 *   secret/<id>/<name>            its key or token
 *   selected                      the agent new chats start with
 *   chat/<id>                     a chat without its turns
 *   turn/<chat>/<id>              `{position, turn}`: one of its turns, where it sits
 *
 * A key that was never written is nil; one gone is `.null`, and stays gone.
 */
protocol AgentStore: AnyObject {
    func get(_ key: String) -> JSON?
    func set(_ key: String, _ value: JSON)
    func turnKeys(_ chat: String) -> [String]
    /** Drops every turn of a chat, with no trace: the chat's own entry says it's gone. */
    func removeTurns(_ chat: String)
    func deviceKeys(_ agent: String) -> [String]
    func secretKeys(_ agent: String) -> [String]
}

enum AgentEntries {
    static let selectedKey = "selected"
    static func agentKey(_ id: String) -> String { "agent/\(id)" }
    static func agentDeviceKey(_ id: String, _ device: String) -> String { "agent-device/\(id)/\(device)" }
    static func secretKey(_ agent: String, _ name: String) -> String { "secret/\(agent)/\(name)" }
    static func chatKey(_ id: String) -> String { "chat/\(id)" }
    static func turnKey(_ chat: String, _ id: String) -> String { "turn/\(chat)/\(id)" }

    /** `turn/<chat>/<id>` → [turn, chat, id]: a turn's id may itself hold a slash. */
    static func segments(_ key: String) -> [String] { key.split(separator: "/", maxSplits: 2, omittingEmptySubsequences: false).map(String.init) }

    /** One request's mutations, at most. */
    static let batch = (mutations: 200, bytes: 4_000_000)
    /** A turn, at most, as kept. */
    private static let turnBytes = 1_000_000

    /** Its size as JavaScript's `JSON.stringify` writes it. */
    static func bytes(_ value: JSON) -> Int {
        let encoder = JSONEncoder()
        encoder.outputFormatting = .withoutEscapingSlashes
        return (try? encoder.encode(value).count) ?? 0
    }

    /** JavaScript's `slice(0, count)`, in UTF-16 code units. */
    private static func slice(_ text: String, _ count: Int) -> String {
        String(decoding: Array(text.utf16.prefix(count)), as: UTF16.self)
    }

    /** A turn too big to keep gives up its steps' outputs, then its pictures: the same on every device. */
    static func fitTurn(_ turn: JSON) -> JSON {
        guard bytes(turn) > turnBytes, case .object(var fitted) = turn else { return turn }
        if let items = fitted["items"]?.array {
            fitted["items"] = .array(items.map { item in
                guard case .object(var step) = item, step["kind"] == "step", let output = step["output"]?.string else { return item }
                step["output"] = .string(output.utf16.count > 2000 ? "\(slice(output, 2000))…" : output)
                return .object(step)
            })
        }
        if bytes(.object(fitted)) > turnBytes, let attachments = fitted["attachments"]?.array {
            fitted["attachments"] = .array(attachments.map { attachment in
                guard case .object(var file) = attachment else { return attachment }
                file["thumb"] = nil
                return .object(file)
            })
        }
        if bytes(.object(fitted)) > turnBytes {
            fitted["text"] = .string("\(slice(fitted["text"]?.string ?? "", turnBytes / 4))…")
        }
        return .object(fitted)
    }

    /** `kept` with what the old relay copy cut from it (a step's output, a picture) back from `whole`. */
    private static func restored(_ kept: JSON, _ whole: JSON) -> JSON {
        guard case .object(var turn) = kept else { return kept }
        if let items = turn["items"]?.array {
            let full = whole["items"]?.array ?? []
            turn["items"] = .array(items.enumerated().map { index, item in
                guard case .object(var step) = item, step["kind"] == "step", let output = step["output"]?.string, output.hasSuffix("…"),
                      index < full.count, full[index]["kind"] == "step", let whole = full[index]["output"]?.string,
                      whole.hasPrefix(output.dropLast()) else { return item }
                step["output"] = .string(whole)
                return .object(step)
            })
        }
        if let attachments = turn["attachments"]?.array {
            let full = whole["attachments"]?.array ?? []
            turn["attachments"] = .array(attachments.map { attachment in
                guard case .object(var file) = attachment, given(file["thumb"]) == nil,
                      let thumb = full.first(where: { $0["name"] == file["name"] })?["thumb"]?.string, !thumb.isEmpty else { return attachment }
                file["thumb"] = .string(thumb)
                return .object(file)
            })
        }
        return .object(turn)
    }

    /** JavaScript's `??`: null and absent alike are nothing. */
    private static func given(_ value: JSON?) -> JSON? { value == .null ? nil : value }

    /** The one place a mutation becomes entries: the relay and each device run it alike. */
    static func apply(_ mutation: JSON, to store: AgentStore) {
        switch mutation["op"]?.string {
        case "agent.set":
            guard let id = mutation["id"]?.string else { return }
            let key = agentKey(id)
            let current = store.get(key)
            if current == .null { return }
            let before = current?.object
            let name = given(mutation["name"])
            if before == nil, name?.string?.isEmpty != false { return }
            var next: [String: JSON] = [
                "id": .string(id),
                "kind": given(before?["kind"]) ?? mutation["kind"] ?? .null,
                "name": name ?? given(before?["name"]) ?? "",
                "settings": .object((before?["settings"]?.object ?? [:]).merging(mutation["settings"]?.object ?? [:]) { _, new in new }),
                "addedAt": given(before?["addedAt"]) ?? given(mutation["addedAt"]) ?? .number(0),
            ]
            let avatar = mutation["avatar"] == nil ? before?["avatar"] : mutation["avatar"]
            if let avatar = avatar?.string, !avatar.isEmpty { next["avatar"] = .string(avatar) }
            store.set(key, .object(next))
        case "agent.device":
            guard let id = mutation["id"]?.string, let device = mutation["device"]?.string,
                  store.get(agentKey(id))?.object != nil else { return }
            let key = agentDeviceKey(id, device)
            let before = store.get(key)?.object ?? [:]
            store.set(key, .object(before.merging(mutation["settings"]?.object ?? [:]) { _, new in new }))
        case "agent.remove":
            guard let id = mutation["id"]?.string else { return }
            store.set(agentKey(id), .null)
            for key in store.deviceKeys(id) { store.set(key, .null) }
            for key in store.secretKeys(id) { store.set(key, .null) }
            if store.get(selectedKey) == .string(id) { store.set(selectedKey, .null) }
        case "secret.set":
            guard let agent = mutation["agent"]?.string, let name = mutation["name"]?.string,
                  store.get(agentKey(agent))?.object != nil else { return }
            let key = secretKey(agent, name)
            let value = mutation["value"] ?? .null
            if value == .null, given(store.get(key)) == nil { return }
            store.set(key, value)
        case "select":
            let id = mutation["id"] ?? .null
            if let id = id.string, store.get(agentKey(id))?.object == nil { return }
            store.set(selectedKey, id)
        case "chat.set":
            guard let chat = mutation["chat"]?.object, let id = chat["id"]?.string else { return }
            let key = chatKey(id)
            let current = store.get(key)
            if current == .null { return }
            let before = current?.object
            if mutation["ifNewer"]?.bool == true, let before,
               let updatedAt = before["updatedAt"]?.number, updatedAt >= (given(chat["updatedAt"])?.number ?? 0) { return }
            if before == nil, chat["provider"]?.string?.isEmpty != false || chat["createdAt"] == nil { return }
            store.set(key, .object((before ?? [:]).merging(chat) { _, new in new }))
        case "chat.delete":
            guard let id = mutation["id"]?.string, store.get(chatKey(id)) != .null else { return }
            store.set(chatKey(id), .null)
            store.removeTurns(id)
        case "turns":
            guard let chat = mutation["chat"]?.string, store.get(chatKey(chat))?.object != nil else { return }
            let removed = Set((mutation["removed"]?.array ?? []).compactMap(\.string))
            for id in removed where store.get(turnKey(chat, id)) != nil { store.set(turnKey(chat, id), .null) }
            var stored: [String: (position: Double, record: JSON)] = [:]
            for key in store.turnKeys(chat) {
                guard let record = store.get(key), let position = record["position"]?.number, let id = record["turn"]?["id"]?.string else { continue }
                stored[id] = (position, record)
            }
            let order = (mutation["order"]?.array ?? []).compactMap(\.string).filter { !removed.contains($0) }
            let known = Set(order)
            // A turn written elsewhere that this order doesn't know of stays after the one it followed.
            var following: [String?: [String]] = [:]
            var after: String?
            for (id, _) in stored.sorted(by: { ($0.value.position, $0.key) < ($1.value.position, $1.key) }) {
                if known.contains(id) { after = id } else { following[after, default: []].append(id) }
            }
            let all = (following[nil] ?? []) + order.flatMap { [$0] + (following[$0] ?? []) }
            let put = Dictionary((mutation["put"]?.array ?? []).compactMap { turn in turn["id"]?.string.map { ($0, turn) } }) { _, last in last }
            let imported = mutation["imported"]?.bool == true
            for (position, id) in all.enumerated() {
                let key = turnKey(chat, id)
                let before = stored[id]
                if let turn = put[id] {
                    if imported, store.get(key) == .null { continue }
                    let kept = imported ? before?.record["turn"].map { restored($0, turn) } : nil
                    store.set(key, .object(["position": .number(Double(position)), "turn": fitTurn(kept ?? turn)]))
                } else if let before, before.position != Double(position), case .object(var record) = before.record {
                    record["position"] = .number(Double(position))
                    store.set(key, .object(record))
                }
            }
        default:
            return
        }
    }
}

/** The mutations a device sends (contracts' `AgentMutation`), as JSON. */
enum AgentMutation {
    /** Makes the agent, or changes it: its settings are merged, key by key. `avatar` `.null` takes its picture away. */
    static func setAgent(_ id: String, kind: String, name: String? = nil, avatar: JSON? = nil, settings: [String: JSON]? = nil, addedAt: Int? = nil) -> JSON {
        var mutation: [String: JSON] = ["op": "agent.set", "id": .string(id), "kind": .string(kind)]
        mutation["name"] = name.map(JSON.string)
        mutation["avatar"] = avatar
        mutation["settings"] = settings.map(JSON.object)
        mutation["addedAt"] = addedAt.map { .number(Double($0)) }
        return .object(mutation)
    }

    static func device(_ id: String, device: String, settings: [String: JSON]) -> JSON {
        .object(["op": "agent.device", "id": .string(id), "device": .string(device), "settings": .object(settings)])
    }

    static func removeAgent(_ id: String) -> JSON { .object(["op": "agent.remove", "id": .string(id)]) }

    static func secret(_ agent: String, _ name: String, _ value: String?) -> JSON {
        .object(["op": "secret.set", "agent": .string(agent), "name": .string(name), "value": value.map(JSON.string) ?? .null])
    }

    static func select(_ id: String?) -> JSON { .object(["op": "select", "id": id.map(JSON.string) ?? .null]) }

    /** Makes the chat or changes the fields given (`id` among them). `ifNewer`: only over an older one (a device's first upload). */
    static func setChat(_ fields: [String: JSON], ifNewer: Bool = false) -> JSON {
        var mutation: [String: JSON] = ["op": "chat.set", "chat": .object(fields)]
        if ifNewer { mutation["ifNewer"] = true }
        return .object(mutation)
    }

    static func deleteChat(_ id: String) -> JSON { .object(["op": "chat.delete", "id": .string(id)]) }

    /**
     * Writes `put`, numbers the chat's turns in `order`'s order, and removes `removed`. `imported`:
     * a device's first upload of what it kept before, where a turn the account has keeps its content.
     */
    static func turns(_ chat: String, put: [JSON], order: [String], removed: [String] = [], imported: Bool = false) -> JSON {
        var mutation: [String: JSON] = ["op": "turns", "chat": .string(chat), "put": .array(put), "order": .array(order.map(JSON.string))]
        if !removed.isEmpty { mutation["removed"] = .array(removed.map(JSON.string)) }
        if imported { mutation["imported"] = true }
        return .object(mutation)
    }
}
