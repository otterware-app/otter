import Foundation

nonisolated struct Draft: Identifiable, Hashable, Codable {
    var id = UUID()
    var from: String
    var to = ""
    var cc = ""
    var bcc = ""
    var files: [DraftFile] = []
    var subject = ""
    var body = ""
    var threadID: String?
    var messageID: String?

    var isEmpty: Bool {
        files.isEmpty && [to, cc, bcc, subject, body].allSatisfy { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    }

    enum Failure: LocalizedError {
        case mailboxUnavailable, recoveryUnavailable, invalidRecipients
        var errorDescription: String? {
            switch self {
            case .mailboxUnavailable: "This mailbox is no longer available. Sign in to it again before saving or sending."
            case .recoveryUnavailable: "Draft recovery isn't available yet. Please keep this message open."
            case .invalidRecipients: "Check the recipients before sending."
            }
        }
    }

    var canSend: Bool {
        let recipients = [to, cc, bcc].flatMap(Self.tokens)
        return !recipients.isEmpty && recipients.allSatisfy { Self.validRecipient($0) }
    }

    static func tokens(_ raw: String) -> [String] {
        var tokens: [String] = [], token = ""
        var quoted = false, escaped = false, angle = false
        for character in raw {
            if escaped { token.append(character); escaped = false; continue }
            if character == "\\", quoted { token.append(character); escaped = true; continue }
            if character == "\"" { quoted.toggle() }
            if !quoted {
                if character == "<" { angle = true }
                if character == ">" { angle = false }
            }
            if !quoted && !angle && (character == "," || character == ";" || character == "\n") {
                if !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { tokens.append(token.trimmingCharacters(in: .whitespacesAndNewlines)) }
                token = ""
            } else { token.append(character) }
        }
        if !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { tokens.append(token.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return tokens
    }

    static func validRecipient(_ token: String) -> Bool {
        guard let person = people(token).first, people(token).count == 1 else { return false }
        let parts = person.email.split(separator: "@", omittingEmptySubsequences: false)
        return parts.count == 2 && !parts[0].isEmpty && !parts[1].isEmpty
            && !person.email.contains(where: { $0.isWhitespace || "<>,;\"".contains($0) })
    }

    @MainActor static func new(from mailbox: Mailbox, to: String = "") -> Draft {
        Draft(from: mailbox.email, to: to, body: signatureBlock(mailbox))
    }

    @MainActor static func reply(to thread: MailThread, in mailbox: Mailbox, all: Bool) -> Draft {
        let last = thread.sent.last ?? thread.latest
        let mine = last.from.isAddress(mailbox.email)
        var to = mine ? last.to : [last.from]
        var cc: [Person] = []
        if all {
            let others = (last.to + last.cc).filter { $0.email != mailbox.email && !to.contains($0) }
            if mine { to += others } else { cc = others }
        }
        return Draft(
            from: mailbox.email,
            to: to.map(format).joined(separator: ", "),
            cc: cc.map(format).joined(separator: ", "),
            subject: thread.subject.hasPrefix("Re:") ? thread.subject : "Re: \(thread.subject)",
            body: signatureBlock(mailbox) + quote(last),
            threadID: thread.id
        )
    }

    @MainActor static func forward(_ thread: MailThread, in mailbox: Mailbox) -> Draft {
        let last = thread.sent.last ?? thread.latest
        let header = """
            ---------- Forwarded message ---------
            From: \(format(last.from))
            Date: \(last.date.formatted(date: .abbreviated, time: .shortened))
            Subject: \(thread.subject)
            """
        return Draft(
            from: mailbox.email,
            files: last.attachments.map { DraftFile(filename: $0.filename, mimeType: $0.mimeType, size: $0.size, original: $0, messageID: last.id, sourceMailbox: thread.mailbox) },
            subject: thread.subject.hasPrefix("Fwd:") ? thread.subject : "Fwd: \(thread.subject)",
            body: signatureBlock(mailbox) + "\n\n\(header)\n\n\(last.text)"
        )
    }

    static func resume(_ message: Message, in thread: MailThread) -> Draft {
        Draft(
            from: thread.mailbox,
            to: message.to.map(format).joined(separator: ", "),
            cc: message.cc.map(format).joined(separator: ", "),
            bcc: message.headers["Bcc"] ?? "",
            files: message.attachments.map { DraftFile(filename: $0.filename, mimeType: $0.mimeType, size: $0.size, original: $0, messageID: message.id, sourceMailbox: thread.mailbox) },
            subject: thread.isDraft ? thread.subject : "",
            body: message.text,
            threadID: thread.isDraft ? nil : thread.id,
            messageID: message.id
        )
    }

    static func format(_ person: Person) -> String {
        guard !person.name.isEmpty else { return person.email }
        let name = person.name.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
        return "\"\(name)\" <\(person.email)>"
    }

    /** "Ana <ana@x.com>, bo@y.com" → people (entries without an address are dropped). */
    static func people(_ list: String) -> [Person] {
        tokens(list).flatMap { Addresses.parse($0) }
    }

    @MainActor private static func signatureBlock(_ mailbox: Mailbox) -> String {
        let signature = Signature.plainText(mailbox.signature)
        return signature.isEmpty ? "" : "\n\n\(signature)"
    }

    private static func quote(_ message: Message) -> String {
        let when = message.date.formatted(date: .abbreviated, time: .shortened)
        let quoted = message.text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { "> \($0)" }.joined(separator: "\n")
        return "\n\nOn \(when), \(message.from.label) wrote:\n\(quoted)"
    }
}
