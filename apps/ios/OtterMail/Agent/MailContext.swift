import Foundation

/**
 * Mail handed to an agent as a pointer (apps/web's chat-context.ts): the agent reads mail itself
 * (with gog, or varys's own mail connection), so only ids and a subject leave the app. Otter Mail
 * opens Otter Agents with it in a link; Otter Agents attaches it to a new chat. Compiled into both.
 */
nonisolated struct MailContext: Hashable, Codable {
    /** `mail` or `draft`, as a chat turn's context says it. */
    var kind = "mail"
    var account: String
    var threadID: String
    var subject: String
    var from: String
    var messageIDs: [String]
    /** The part of the message that was selected, when it's that the chat is about. */
    var quote: String?

    /** Otter Agents answers to its bundle id, so a debug build of Otter Mail opens the debug build of Otter Agents. */
    static func scheme(mail bundle: String? = Bundle.main.bundleIdentifier) -> String {
        bundle?.hasSuffix(".dev") == true ? "dev.otterware.agents.dev" : "dev.otterware.agents"
    }

    /** What Otter Mail opens: a new chat about this mail, each piece a `mail` item of the link, as JSON. */
    static func link(_ mail: [MailContext], scheme: String = MailContext.scheme()) -> URL? {
        guard !mail.isEmpty else { return nil }
        var link = URLComponents()
        link.scheme = scheme
        link.host = "new"
        link.queryItems = mail.compactMap { try? JSONEncoder().encode($0) }.map { URLQueryItem(name: "mail", value: String(decoding: $0, as: UTF8.self)) }
        return link.url
    }

    static func read(link: URL) -> [MailContext] {
        guard link.host() == "new", let items = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems else { return [] }
        return items.filter { $0.name == "mail" }
            .compactMap { $0.value.flatMap { try? JSONDecoder().decode(MailContext.self, from: Data($0.utf8)) } }
            .filter { !$0.account.isEmpty && !($0.threadID.isEmpty && $0.messageIDs.isEmpty) }
    }

    static func handoff(_ question: String, _ context: [MailContext], reader: String = "gog") -> String {
        guard !context.isEmpty else { return question }
        // A marker, not a name: the Mac and web apps strip it from what a chat shows.
        var lines = [question, "", "— context from Otter Mail —"]
        for c in context {
            if let quote = c.quote {
                lines.append("• Quoted from \"\(c.subject)\" [\(c.account)] (threadId \(c.threadID)):\n  “\(quote)”")
                continue
            }
            let what = c.kind == "draft" ? "Draft " : ""
            let ids = [c.threadID.isEmpty ? nil : "threadId \(c.threadID)", c.messageIDs.isEmpty ? nil : "message \(c.messageIDs.joined(separator: ", "))"]
            lines.append("• \(what)[\(c.account)] \"\(c.subject)\" — from \(c.from) (\(ids.compactMap { $0 }.joined(separator: ", ")))")
        }
        lines.append("Fetch full content with \(reader) if needed.")
        return lines.joined(separator: "\n")
    }
}
