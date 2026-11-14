import Foundation

/**
 * One agent you added, as the account keeps it (contracts' `AgentRecord`): its kind, name, picture
 * and settings, with this iPhone's own settings for it over them.
 */
nonisolated struct AgentEntry: Identifiable, Equatable {
    static let maxName = 60
    /** A chosen picture is an inline data URL, never a link (contracts' `isMailboxPicture`). */
    static let maxPicture = 48_000

    var id: String
    /** One this iPhone runs (`AgentKind`), or one only a Mac runs (Claude, Codex): kept as it comes. */
    var kind: String
    var name: String
    var avatar: String?
    var settings: [String: JSON] = [:]
    /** Where it sits among the agents: they're listed in the order they were added. */
    var addedAt: Double = 0

    init(id: String, kind: String, name: String, avatar: String? = nil, settings: [String: JSON] = [:], addedAt: Double = 0) {
        self.id = id
        self.kind = kind
        self.name = name
        self.avatar = avatar
        self.settings = settings
        self.addedAt = addedAt
    }

    /** The account's record, with this device's settings (`agent-device/<id>/<device>`) over its own. */
    init?(_ record: JSON, device: JSON?) {
        guard let id = record["id"]?.string, let kind = record["kind"]?.string, let name = record["name"]?.string else { return nil }
        let settings = (record["settings"]?.object ?? [:]).merging(device?.object ?? [:]) { _, own in own }
        self.init(id: id, kind: kind, name: String(name.prefix(Self.maxName)), avatar: record["avatar"]?.string.flatMap { Self.isPicture($0) ? $0 : nil },
                  settings: settings, addedAt: record["addedAt"]?.number ?? 0)
    }

    static func isPicture(_ value: String) -> Bool {
        value.count <= maxPicture && value.wholeMatch(of: /data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+\/]+={0,2}/) != nil
    }
}
