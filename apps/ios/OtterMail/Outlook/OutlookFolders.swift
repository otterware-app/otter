import Foundation

nonisolated struct OutlookFolders: Equatable {
    struct Folder: Equatable {
        var id: String
        var name: String
        var parentID: String?
        var label: String?
    }

    struct Category: Equatable {
        var name: String
        var color: String
    }

    var wellKnown: [String: String]
    var folders: [Folder]
    var categories: [Category]

    static let folderPrefix = "folder:"
    static let categoryPrefix = "category:"

    static let wellKnownNames = ["inbox", "sentitems", "drafts", "deleteditems", "junkemail", "archive", "outbox", "conversationhistory", "syncissues", "scheduled"]
    private static let systemLabels = ["inbox": "INBOX", "sentitems": "SENT", "drafts": "DRAFT", "deleteditems": "TRASH", "junkemail": "SPAM", "archive": "ARCHIVE"]
    private static let skipped = ["outbox", "conversationhistory", "syncissues", "scheduled"]

    struct ApiFolder: Decodable {
        var id: String
        var displayName: String
        var childFolderCount: Int?
    }

    init(wellKnown: [String: String], children: [String?: [ApiFolder]], categories: [Category]) {
        self.wellKnown = wellKnown
        self.categories = categories
        let role = Dictionary(wellKnown.map { ($1, $0) }) { a, _ in a }
        var folders: [Folder] = []
        func visit(_ parent: String?, _ path: String, _ inherited: String?) {
            for child in children[parent] ?? [] {
                let name = role[child.id]
                if let name, Self.skipped.contains(name) { continue }
                let full = path.isEmpty ? child.displayName : "\(path)/\(child.displayName)"
                let own: String? = if let name { Self.systemLabels[name] } else { "\(Self.folderPrefix)\(child.id)" }
                let label = inherited ?? own
                folders.append(Folder(id: child.id, name: full, parentID: parent, label: label))
                if (child.childFolderCount ?? 0) > 0 {
                    visit(child.id, full, label == "TRASH" || label == "SPAM" ? label : nil)
                }
            }
        }
        visit(nil, "", nil)
        let order = { (folder: Folder) in
            folder.id == wellKnown["inbox"] ? 0 : folder.label == "SPAM" ? 2 : folder.label == "TRASH" ? 3 : 1
        }
        self.folders = folders.enumerated().sorted { (order($0.element), $0.offset) < (order($1.element), $1.offset) }.map(\.element)
    }

    func label(ofFolder id: String?) -> String? {
        guard let id else { return nil }
        if let folder = folders.first(where: { $0.id == id }) { return folder.label }
        if let name = wellKnown.first(where: { $0.value == id })?.key { return Self.systemLabels[name] }
        return "\(Self.folderPrefix)\(id)"
    }

    func isSynced(_ folderID: String?) -> Bool {
        guard let folderID else { return true }
        return !Self.skipped.contains { wellKnown[$0] == folderID }
    }

    func folder(ofLabel label: String) -> String? {
        if label.hasPrefix(Self.folderPrefix) { return String(label.dropFirst(Self.folderPrefix.count)) }
        guard let name = Self.systemLabels.first(where: { $0.value == label })?.key else { return nil }
        return wellKnown[name] ?? name
    }

    func id(_ name: String) -> String { wellKnown[name] ?? name }

    var hasArchive: Bool { folders.contains { $0.label == "ARCHIVE" } }

    static func category(_ label: String) -> String? {
        label.hasPrefix(categoryPrefix) ? String(label.dropFirst(categoryPrefix.count)) : nil
    }

    var labels: [MailLabel] {
        let byName = { (a: MailLabel, b: MailLabel) in a.name.localizedStandardCompare(b.name) == .orderedAscending }
        let folders = self.folders.filter { $0.label?.hasPrefix(Self.folderPrefix) == true }
            .map { MailLabel(id: $0.label!, name: $0.name, color: nil) }
            .sorted(by: byName)
        let categories = self.categories.map { MailLabel(id: Self.categoryPrefix + $0.name, name: $0.name, color: Self.presets[$0.color]) }
            .sorted(by: byName)
        return folders + categories
    }

    func labels(folder: String?, isRead: Bool?, flagged: Bool, importance: String?, categories: [String]?) -> [String] {
        var labels: [String] = []
        if let label = label(ofFolder: folder) { labels.append(label) }
        if isRead == false { labels.append("UNREAD") }
        if flagged { labels.append("STARRED") }
        if importance == "high" { labels.append("IMPORTANT") }
        labels += (categories ?? []).map { Self.categoryPrefix + $0 }
        return labels
    }

    static let presets = [
        "preset0": "#e74856", "preset1": "#ff8c00", "preset2": "#ab7b5d", "preset3": "#fff100", "preset4": "#47d041",
        "preset5": "#30c6cc", "preset6": "#73aa24", "preset7": "#4cb4ff", "preset8": "#8764b8", "preset9": "#f495bf",
        "preset10": "#4b7a9e", "preset11": "#2d4250", "preset12": "#a0aeb2", "preset13": "#6b7b81", "preset14": "#1f1f1f",
        "preset15": "#a4262c", "preset16": "#ca5010", "preset17": "#8e562e", "preset18": "#c19c00", "preset19": "#0b6a0b",
        "preset20": "#038387", "preset21": "#5c7e10", "preset22": "#004e8c", "preset23": "#5c2e91", "preset24": "#9b1c54",
    ]
}
