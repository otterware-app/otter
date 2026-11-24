import Foundation

nonisolated enum ImapValue: Equatable, Sendable {
    case atom(String)
    case string(Data)
    case list([ImapValue])
    case none

    var text: String? {
        switch self {
        case .atom(let atom): atom
        case .string(let data): String(data: data, encoding: .utf8) ?? String(decoding: data, as: UTF8.self)
        default: nil
        }
    }

    var data: Data? {
        switch self {
        case .atom(let atom): Data(atom.utf8)
        case .string(let data): data
        default: nil
        }
    }

    var list: [ImapValue] { if case .list(let items) = self { items } else { [] } }
    var number: UInt64? { text.flatMap { UInt64($0) } }

    var pairs: [String: ImapValue] {
        let items = list
        var out: [String: ImapValue] = [:]
        for i in stride(from: 0, to: items.count - 1, by: 2) {
            if let key = items[i].text { out[key.uppercased()] = items[i + 1] }
        }
        return out
    }
}

nonisolated struct ImapResponse: Sendable {
    /** The message number or count before the kind (`* 12 EXISTS`). */
    var number: UInt32?
    var kind: String
    var values: [ImapValue]
    var text = ""
}

/** Reads IMAP's grammar (RFC 3501 §9) from a response, literals inline. */
nonisolated struct ImapParser {
    private let bytes: [UInt8]
    private var i = 0

    init(_ data: Data) { bytes = [UInt8](data) }

    static func response(_ data: Data) -> ImapResponse {
        var parser = ImapParser(data)
        var first = parser.atom()
        var number: UInt32?
        if let n = UInt32(first) {
            number = n
            first = parser.atom()
        }
        let kind = first.uppercased()
        if ["OK", "NO", "BAD", "BYE", "PREAUTH"].contains(kind) {
            parser.skipSpaces()
            var code: [ImapValue] = []
            if parser.peek == UInt8(ascii: "[") {
                parser.i += 1
                code = parser.values(until: UInt8(ascii: "]"))
            }
            parser.skipSpaces()
            let text = String(decoding: parser.bytes[parser.i...], as: UTF8.self)
            return ImapResponse(number: number, kind: kind, values: code, text: text)
        }
        return ImapResponse(number: number, kind: kind, values: parser.values(until: nil))
    }

    private var peek: UInt8? { i < bytes.count ? bytes[i] : nil }

    private mutating func skipSpaces() {
        while peek == UInt8(ascii: " ") { i += 1 }
    }

    private mutating func values(until close: UInt8?) -> [ImapValue] {
        var out: [ImapValue] = []
        while true {
            skipSpaces()
            guard let c = peek else { return out }
            if c == close { i += 1; return out }
            switch c {
            case UInt8(ascii: "("):
                i += 1
                out.append(.list(values(until: UInt8(ascii: ")"))))
            case UInt8(ascii: "["):
                i += 1
                out.append(.list(values(until: UInt8(ascii: "]"))))
            case UInt8(ascii: ")"), UInt8(ascii: "]"):
                i += 1
            case UInt8(ascii: "\""):
                out.append(.string(quoted()))
            case UInt8(ascii: "{"):
                out.append(.string(literal()))
            default:
                let atom = atom()
                out.append(atom.uppercased() == "NIL" ? .none : .atom(atom))
            }
        }
    }

    private mutating func atom() -> String {
        skipSpaces()
        let start = i
        while let c = peek {
            if c == UInt8(ascii: "[") {
                guard i > start else { break }
                while let d = peek, d != UInt8(ascii: "]") { i += 1 }
                i = min(i + 1, bytes.count)
                continue
            }
            if [UInt8(ascii: " "), UInt8(ascii: "("), UInt8(ascii: ")"), UInt8(ascii: "]"), UInt8(ascii: "\"")].contains(c) { break }
            i += 1
        }
        return String(decoding: bytes[start..<i], as: UTF8.self)
    }

    private mutating func quoted() -> Data {
        i += 1
        var out = Data()
        while let c = peek, c != UInt8(ascii: "\"") {
            if c == UInt8(ascii: "\\"), i + 1 < bytes.count { i += 1 }
            out.append(bytes[i])
            i += 1
        }
        i += 1
        return out
    }

    private mutating func literal() -> Data {
        i += 1
        var count = 0
        while let c = peek, c != UInt8(ascii: "}") {
            if let digit = Int(String(UnicodeScalar(c))) { count = count * 10 + digit }
            i += 1
        }
        i += 3
        let end = min(i + count, bytes.count)
        defer { i = end }
        return Data(bytes[min(i, end)..<end])
    }
}

nonisolated func imapAddresses(_ value: ImapValue) -> [Person] {
    value.list.compactMap { address in
        let parts = address.list
        guard parts.count == 4, let mailbox = parts[2].text, let host = parts[3].text else { return nil }
        return Person(name: parts[0].text.map(MailDecoding.words) ?? "", email: "\(mailbox)@\(host)")
    }
}

nonisolated struct ImapBodyPart: Sendable {
    var section: String
    var type: String
    var params: [String: String]
    var contentID: String?
    var encoding: String
    var size: Int
    var disposition: String?
    var dispositionParams: [String: String]

    var filename: String? {
        (MailDecoding.parameter("filename", in: dispositionParams) ?? MailDecoding.parameter("name", in: params))
            .flatMap { $0.isEmpty ? nil : $0 }
    }

    /** The message's own words (not a file), plain or HTML. */
    var isBody: Bool { (type == "text/plain" || type == "text/html") && disposition != "attachment" && filename == nil }

    static func leaves(_ value: ImapValue, section: String = "") -> [ImapBodyPart] {
        let items = value.list
        guard let first = items.first else { return [] }
        if case .list = first {
            let children = items.prefix { if case .list = $0 { true } else { false } }
            return children.enumerated().flatMap { index, child in
                leaves(child, section: section.isEmpty ? "\(index + 1)" : "\(section).\(index + 1)")
            }
        }
        guard items.count >= 7 else { return [] }
        let type = "\(items[0].text ?? "text")/\(items[1].text ?? "plain")".lowercased()
        // Extension data follows the basic fields, after text's line count and message/rfc822's envelope, body and lines.
        let extensions = type.hasPrefix("text/") ? 8 : type == "message/rfc822" ? 10 : 7
        let disposition = items.count > extensions + 1 ? items[extensions + 1].list : []
        return [ImapBodyPart(
            section: section.isEmpty ? "1" : section,
            type: type,
            params: strings(items[2]),
            contentID: items[3].text?.trimmingCharacters(in: CharacterSet(charactersIn: "<> ")),
            encoding: items[5].text ?? "7bit",
            // The size on the wire; base64 takes a third more than the file.
            size: Int(items[6].number ?? 0) * ((items[5].text ?? "").lowercased() == "base64" ? 3 : 4) / 4,
            disposition: disposition.first?.text?.lowercased(),
            dispositionParams: disposition.count > 1 ? strings(disposition[1]) : [:]
        )]
    }

    private static func strings(_ value: ImapValue) -> [String: String] {
        value.pairs.reduce(into: [:]) { out, pair in out[pair.key.lowercased()] = pair.value.text }
    }
}

nonisolated func imapSet(_ uids: some Sequence<UInt32>) -> String {
    var ranges: [(UInt32, UInt32)] = []
    for uid in Set(uids).sorted() {
        if let last = ranges.last, last.1 + 1 == uid { ranges[ranges.count - 1].1 = uid } else { ranges.append((uid, uid)) }
    }
    return ranges.map { $0 == $1 ? "\($0)" : "\($0):\($1)" }.joined(separator: ",")
}

nonisolated func imapUIDs(_ set: String) -> [UInt32] {
    set.split(separator: ",").flatMap { range -> [UInt32] in
        let ends = range.split(separator: ":").compactMap { UInt32($0) }
        guard let low = ends.min(), let high = ends.max(), high - low < 100_000 else { return [] }
        return Array(low...high)
    }
}
