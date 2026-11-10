import Foundation

typealias JSON = Varys.JSON

/**
 * The account's chats as every app keeps them (packages/contracts' chats.ts): the relay holds
 * one row a chat, and a write replaces it whole, so a turn keeps what this app doesn't read.
 */
nonisolated struct Chat: Identifiable, Equatable {
    struct Device: Equatable {
        var id: String
        var name: String
    }

    var id: String
    var title = "New chat"
    var provider: String
    var sessionId: String?
    var sessionOwned = false
    var lastResponseId: String?
    var device: Device?
    var createdAt: Int
    var updatedAt: Int
    var snoozedUntil: Int?
    var settledAt: Int?
    var pinnedAt: Int?
    var returnedAt: Int?
    var tabs: [ChatTab] = []
    var turns: [ChatTurn] = []
    /** Its turns are here: the list comes without them. */
    var loaded = false

    static let localProviders: Set<String> = ["claude", "codex"]

    init(provider: String, now: Int = .now) {
        id = UUID().uuidString.lowercased()
        self.provider = provider
        createdAt = now
        updatedAt = now
        returnedAt = now
        loaded = true
    }

    /** Nil for what isn't a chat, or is one deleted. */
    init?(_ json: JSON) {
        guard let id = json["id"]?.string, json["deletedAt"]?.count == nil else { return nil }
        self.id = id
        title = json["title"]?.string ?? "New chat"
        provider = json["provider"]?.string ?? ""
        sessionId = json["sessionId"]?.string
        sessionOwned = json["sessionOwned"]?.bool ?? false
        lastResponseId = json["lastResponseId"]?.string
        if let device = json["device"], let deviceId = device["id"]?.string {
            self.device = Device(id: deviceId, name: device["name"]?.string ?? "")
        }
        createdAt = json["createdAt"]?.count ?? 0
        updatedAt = json["updatedAt"]?.count ?? 0
        snoozedUntil = json["snoozedUntil"]?.count
        settledAt = json["settledAt"]?.count
        pinnedAt = json["pinnedAt"]?.count
        returnedAt = json["returnedAt"]?.count
        tabs = (json["tabs"]?.array ?? []).compactMap(ChatTab.init)
        if let turns = json["turns"]?.array {
            self.turns = turns.compactMap(ChatTurn.init)
            loaded = true
        }
    }

    var json: JSON {
        .object([
            "id": .string(id),
            "title": .string(title),
            "provider": .string(provider),
            "sessionId": sessionId.map(JSON.string) ?? .null,
            "sessionOwned": .bool(sessionOwned),
            "lastResponseId": lastResponseId.map(JSON.string) ?? .null,
            "device": device.map { .object(["id": .string($0.id), "name": .string($0.name)]) } ?? .null,
            "createdAt": .number(Double(createdAt)),
            "updatedAt": .number(Double(updatedAt)),
            "snoozedUntil": snoozedUntil.map { .number(Double($0)) } ?? .null,
            "settledAt": settledAt.map { .number(Double($0)) } ?? .null,
            "pinnedAt": pinnedAt.map { .number(Double($0)) } ?? .null,
            "returnedAt": returnedAt.map { .number(Double($0)) } ?? .null,
            "tabs": .array(tabs.map(\.json)),
            "turns": .array(turns.map(\.json)),
        ])
    }

    var isBlank: Bool { loaded && turns.isEmpty }

    /** It ran in Claude or Codex on a Mac, which is where it continues. */
    var isElsewhere: Bool { Self.localProviders.contains(provider) }

    /** OpenClaw's agent, from the session it runs in (`agent:<id>:…`). */
    var openClawAgent: String? {
        guard provider == "openclaw", let parts = sessionId?.split(separator: ":"), parts.count > 2, parts[0] == "agent" else { return nil }
        return String(parts[1])
    }
}

nonisolated struct ChatTab: Identifiable, Equatable {
    enum Ref: Equatable {
        case thread(accountId: String, id: String)
        case draft(accountId: String, id: String)
        case page(url: String)
        case file(href: String)

        var kind: String {
            switch self {
            case .thread: "thread"
            case .draft: "draft"
            case .page: "page"
            case .file: "file"
            }
        }
    }

    var id: String
    var title: String
    var ref: Ref
    var addedAt: Int
    var made = false
    var closedAt: Int?

    init(ref: Ref, title: String, made: Bool = false, now: Int = .now) {
        id = switch ref {
        case .thread(let account, let id): "thread:\(account):\(id)"
        case .draft(let account, let id): "draft:\(account):\(id)"
        case .page(let url): "page:\(url)"
        case .file(let href): "file:\(href)"
        }
        self.title = title
        self.ref = ref
        addedAt = now
        self.made = made
    }

    init?(_ json: JSON) {
        guard let id = json["id"]?.string, let ref = json["ref"] else { return nil }
        switch ref["kind"]?.string {
        case "thread": self.ref = .thread(accountId: ref["accountId"]?.string ?? "", id: ref["id"]?.string ?? "")
        case "draft": self.ref = .draft(accountId: ref["accountId"]?.string ?? "", id: ref["id"]?.string ?? "")
        case "page": self.ref = .page(url: ref["url"]?.string ?? "")
        case "file": self.ref = .file(href: ref["href"]?.string ?? "")
        default: return nil
        }
        self.id = id
        title = json["title"]?.string ?? ""
        addedAt = json["addedAt"]?.count ?? 0
        made = json["made"]?.bool ?? false
        closedAt = json["closedAt"]?.count
    }

    var json: JSON {
        let ref: [String: JSON] = switch ref {
        case .thread(let account, let id): ["kind": "thread", "accountId": .string(account), "id": .string(id)]
        case .draft(let account, let id): ["kind": "draft", "accountId": .string(account), "id": .string(id)]
        case .page(let url): ["kind": "page", "url": .string(url)]
        case .file(let href): ["kind": "file", "href": .string(href)]
        }
        var object: [String: JSON] = ["id": .string(id), "title": .string(title), "ref": .object(ref), "addedAt": .number(Double(addedAt))]
        if made { object["made"] = true }
        if let closedAt { object["closedAt"] = .number(Double(closedAt)) }
        return .object(object)
    }
}

nonisolated struct ChatStep: Equatable {
    /** command, read, edit, search, web, skill or tool. */
    var kind = "tool"
    var title: String
    var detail: String?
    var source: String?
    /** The agent compacting its context: running until its output, which is empty unless it failed. */
    var compaction = false

    init(kind: String = "tool", title: String, detail: String? = nil, source: String? = nil, compaction: Bool = false) {
        self.kind = kind
        self.title = title
        self.detail = detail
        self.source = source
        self.compaction = compaction
    }

    init(_ json: JSON) {
        kind = json["kind"]?.string ?? "tool"
        title = json["title"]?.string ?? "Tool"
        detail = json["detail"]?.string
        source = json["source"]?.string
        compaction = json["compaction"]?.bool ?? false
    }

    var json: JSON {
        var object: [String: JSON] = ["kind": .string(kind), "title": .string(title)]
        if let detail { object["detail"] = .string(detail) }
        if let source { object["source"] = .string(source) }
        if compaction { object["compaction"] = true }
        return .object(object)
    }
}

nonisolated enum ChatItem: Equatable {
    case text(id: String?, String)
    /** Running until it has an output. */
    case step(id: String?, ChatStep, output: String?)

    init?(_ json: JSON) {
        switch json["kind"]?.string {
        case "text": self = .text(id: json["id"]?.string, json["text"]?.string ?? "")
        case "step": self = .step(id: json["id"]?.string, ChatStep(json["step"] ?? .null), output: json["output"]?.string)
        default: return nil
        }
    }

    var json: JSON {
        switch self {
        case .text(let id, let text):
            var object: [String: JSON] = ["kind": "text", "text": .string(text)]
            if let id { object["id"] = .string(id) }
            return .object(object)
        case .step(let id, let step, let output):
            var object: [String: JSON] = ["kind": "step", "step": step.json]
            if let id { object["id"] = .string(id) }
            if let output { object["output"] = .string(output) }
            return .object(object)
        }
    }

    var step: ChatStep? { if case .step(_, let step, _) = self { step } else { nil } }
    var text: String? { if case .text(_, let text) = self { text } else { nil } }
    var isRunning: Bool { if case .step(_, _, nil) = self { true } else { false } }
}

/** Something the agent changed in Otter: a draft, a conversation, a label, a view, a theme, an event. */
nonisolated struct ChatChange: Equatable {
    var title: String
    /** created, updated, deleted, trashed or restored. */
    var action: String
    var kind: String
    var id: String
    var accountId: String?
    var url: String?

    init?(_ json: JSON) {
        guard let target = json["target"], let kind = target["kind"]?.string, let id = target["id"]?.string else { return nil }
        title = json["title"]?.string ?? ""
        action = json["action"]?.string ?? "updated"
        self.kind = kind
        self.id = id
        accountId = target["accountId"]?.string
        url = target["url"]?.string
    }
}

nonisolated struct ChatContext: Equatable {
    var subjects: [String]
    var count: Int
    /** draft, sent, mail, mixed or quote. */
    var kind: String

    init?(_ json: JSON) {
        guard json.object != nil else { return nil }
        subjects = (json["subjects"]?.array ?? []).compactMap(\.string)
        count = json["count"]?.count ?? subjects.count
        kind = json["kind"]?.string ?? "mail"
    }
}

nonisolated struct ChatSentAttachment: Equatable {
    var name: String
    var isImage: Bool
    var size: Int
    /** A small picture of it, kept on the device that sent it. */
    var thumb: String?

    init(name: String, isImage: Bool, size: Int, thumb: String? = nil) {
        self.name = name
        self.isImage = isImage
        self.size = size
        self.thumb = thumb
    }

    init?(_ json: JSON) {
        guard let name = json["name"]?.string else { return nil }
        self.name = name
        isImage = json["kind"]?.string == "image"
        size = json["size"]?.count ?? 0
        thumb = json["thumb"]?.string
    }

    /** As it's synced: without the picture. */
    var json: JSON {
        .object(["name": .string(name), "kind": .string(isImage ? "image" : "file"), "size": .number(Double(size))])
    }
}

nonisolated struct ChatCitation: Equatable, Identifiable {
    var id = UUID()
    var text: String
    var comment: String?

    static func == (a: ChatCitation, b: ChatCitation) -> Bool { a.text == b.text && a.comment == b.comment }
}

/** A turn no message of yours started: a scheduled task's result, or a message the agent sent you itself. */
nonisolated enum ChatDelivery: Equatable {
    case automation(jobId: String?, name: String?, schedule: String?)
    case message(from: String?)

    init?(_ json: JSON) {
        switch json["kind"]?.string {
        case "automation": self = .automation(jobId: json["jobId"]?.string, name: json["name"]?.string, schedule: json["schedule"]?.string)
        case "message": self = .message(from: json["from"]?.string)
        default: return nil
        }
    }

    var json: JSON {
        var object: [String: JSON] = [:]
        switch self {
        case .automation(let jobId, let name, let schedule):
            object["kind"] = "automation"
            if let jobId { object["jobId"] = .string(jobId) }
            if let name { object["name"] = .string(name) }
            if let schedule { object["schedule"] = .string(schedule) }
        case .message(let from):
            object["kind"] = "message"
            if let from { object["from"] = .string(from) }
        }
        return .object(object)
    }
}

nonisolated struct ChatTurn: Identifiable, Equatable {
    enum Role: String { case user, assistant }

    var id: String
    var role: Role
    var text = ""
    var items: [ChatItem] = []
    /** Read only here: what Otter's own tools changed, on a device that has them. */
    private(set) var changes: [ChatChange] = []
    private(set) var context: ChatContext?
    var skill: String?
    /** queued, steer or promoted. */
    var intent: String?
    var attachments: [ChatSentAttachment] = []
    var citations: [ChatCitation] = []
    var error: String?
    /** The chat was forked from another after this turn. */
    var forked = false
    var delivered: ChatDelivery?
    var startedAt: Int?
    var finishedAt: Int?
    /** The turn as it came, so what this app doesn't read is written back with it. */
    private var base: [String: JSON] = [:]

    init(id: String, role: Role, text: String = "", now: Int? = .now) {
        self.id = id
        self.role = role
        self.text = text
        startedAt = now
    }

    init?(_ json: JSON) {
        guard let id = json["id"]?.string, let role = json["role"]?.string.flatMap(Role.init) else { return nil }
        self.id = id
        self.role = role
        text = json["text"]?.string ?? ""
        items = (json["items"]?.array ?? []).compactMap(ChatItem.init)
        changes = (json["changes"]?.array ?? []).compactMap(ChatChange.init)
        context = json["context"].flatMap(ChatContext.init)
        skill = json["skill"]?.string
        intent = json["intent"]?.string
        attachments = (json["attachments"]?.array ?? []).compactMap(ChatSentAttachment.init)
        citations = (json["citations"]?.array ?? []).compactMap { item in
            item["text"]?.string.map { ChatCitation(text: $0, comment: item["comment"]?.string) }
        }
        error = json["error"]?.string
        forked = json["forked"]?.bool ?? false
        delivered = json["delivered"].flatMap(ChatDelivery.init)
        startedAt = json["startedAt"]?.count
        finishedAt = json["finishedAt"]?.count
        base = json.object ?? [:]
    }

    var json: JSON {
        var object = base
        object["id"] = .string(id)
        object["role"] = .string(role.rawValue)
        object["text"] = .string(text)
        object["items"] = role == .assistant || !items.isEmpty ? .array(items.map(\.json)) : nil
        object["skill"] = skill.map(JSON.string)
        object["intent"] = intent.map(JSON.string)
        object["attachments"] = attachments.isEmpty ? nil : .array(attachments.map(\.json))
        object["citations"] = citations.isEmpty ? nil : .array(citations.map { citation in
            var item: [String: JSON] = ["text": .string(citation.text)]
            if let comment = citation.comment { item["comment"] = .string(comment) }
            return .object(item)
        })
        object["error"] = error.map(JSON.string)
        object["forked"] = forked ? true : nil
        object["delivered"] = delivered?.json
        object["startedAt"] = startedAt.map { .number(Double($0)) }
        object["finishedAt"] = finishedAt.map { .number(Double($0)) }
        return .object(object)
    }

    /** What the agent said last: the text after its last step. */
    var answer: String {
        let last = items.lastIndex { $0.step != nil } ?? -1
        return items[(last + 1)...].compactMap(\.text).joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var isLive: Bool { role == .assistant && finishedAt == nil && error == nil }
}

extension JSON: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
}

extension Int {
    /** Now, in the milliseconds every app stamps chats with. */
    nonisolated static var now: Int { Int((Date().timeIntervalSince1970 * 1000).rounded()) }
}

extension Date {
    nonisolated init(ms: Int) { self.init(timeIntervalSince1970: Double(ms) / 1000) }
}
