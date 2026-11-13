import Foundation

/**
 * The agents you added, as the Otter account's `assistant` section holds them (core's
 * agents.json and `SyncedProviderSettings`): each one's kind, name, picture and settings, the one
 * new chats start on, and the ids of those removed, kept for good so no device brings one back.
 */
nonisolated struct AgentList: Equatable {
    struct Entry: Identifiable, Equatable {
        static let maxName = 60
        /** A chosen picture is an inline data URL, never a link (contracts' `isMailboxPicture`). */
        static let maxPicture = 48_000

        var id: String
        /** One this iPhone runs (`AgentKind`), or one only a Mac runs (Claude, Codex): kept as it comes. */
        var kind: String
        var name: String
        var avatar: String?
        var settings: [String: JSON] = [:]

        init(id: String, kind: String, name: String, avatar: String? = nil, settings: [String: JSON] = [:]) {
            self.id = id
            self.kind = kind
            self.name = name
            self.avatar = avatar
            self.settings = settings
        }

        init?(_ json: JSON) {
            guard let id = json["id"]?.string, let kind = json["kind"]?.string, let name = json["name"]?.string,
                  let settings = json["settings"]?.object else { return nil }
            self.init(id: id, kind: kind, name: String(name.prefix(Self.maxName)), avatar: json["avatar"]?.string.flatMap { Self.isPicture($0) ? $0 : nil },
                      settings: settings)
        }

        var json: JSON {
            var object: [String: JSON] = ["id": .string(id), "kind": .string(kind), "name": .string(name), "settings": .object(settings)]
            if let avatar { object["avatar"] = .string(avatar) }
            return .object(object)
        }

        static func isPicture(_ value: String) -> Bool {
            value.count <= maxPicture && value.wholeMatch(of: /data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}/) != nil
        }

        /** As the account keeps it: without what stays on each device. */
        var synced: Entry {
            guard let kind = AgentKind(rawValue: kind) else { return self }
            var entry = self
            entry.settings = settings.filter { !kind.isDeviceField($0.key) }
            return entry
        }
    }

    var selected: String?
    var agents: [Entry] = []
    var removed: [String] = []

    init(selected: String? = nil, agents: [Entry] = [], removed: [String] = []) {
        self.selected = selected
        self.agents = agents
        self.removed = removed
    }

    /** Nil when it isn't a list of agents: the account has none yet, or has them as apps before agents had ids wrote them. */
    init?(_ json: JSON?) {
        guard let json, let agents = json["agents"]?.array else { return nil }
        selected = json["selected"]?.string
        self.agents = agents.compactMap(Entry.init)
        removed = json["removed"]?.array?.compactMap(\.string) ?? []
    }

    var json: JSON {
        .object(["selected": selected.map(JSON.string) ?? .null, "agents": .array(agents.map(\.json)), "removed": .array(removed.map(JSON.string))])
    }

    /** What this iPhone writes to the account. */
    var synced: AgentList { AgentList(selected: selected, agents: agents.map(\.synced), removed: removed) }

    /**
     * This iPhone's list once it has read the account's (core's `applySyncedProviderSettings`):
     * the account's agents, in its order, with its names and pictures and its settings over this
     * iPhone's (those that stay here kept); then those added here that the account hasn't heard
     * of yet. Removed on either side, an agent is gone for good.
     */
    func merged(with account: AgentList) -> AgentList {
        let removed = removed + account.removed.filter { !removed.contains($0) }
        let theirs = account.agents.filter { !removed.contains($0.id) }.map { entry in
            var merged = entry
            let mine = agents.first { $0.id == entry.id }?.settings ?? [:]
            merged.settings = mine.merging(entry.synced.settings) { _, theirs in theirs }
            return merged
        }
        let added = agents.filter { mine in !removed.contains(mine.id) && !theirs.contains { $0.id == mine.id } }
        let all = theirs + added
        let selected = [account.selected, selected].compactMap(\.self).first { id in all.contains { $0.id == id } }
        return AgentList(selected: selected, agents: all, removed: removed)
    }
}
