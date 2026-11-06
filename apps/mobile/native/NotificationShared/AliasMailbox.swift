import Foundation

nonisolated struct AliasMailbox: Codable, Hashable, Sendable {
    var address: String
    var name: String?
    var color: String?
    var signature: String?

    var id: String { address.lowercased() }

    var title: String {
        if let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty { return name }
        let local = address.split(separator: "@").first.map(String.init) ?? address
        return local.prefix(1).uppercased() + local.dropFirst()
    }

    /** `header` gives a header's topmost value; iCloud stamps `Original-Recipient: rfc822;<address>` on each copy it files. */
    static func deliveredTo(_ header: (String) -> String?) -> [String] {
        var addresses: [String] = []
        for name in ["Original-Recipient", "Delivered-To", "X-Original-To"] {
            guard var value = header(name)?.trimmingCharacters(in: .whitespaces) else { continue }
            if value.lowercased().hasPrefix("rfc822;") { value = String(value.dropFirst(7)) }
            value = value.trimmingCharacters(in: .whitespaces.union(["<", ">"])).lowercased()
            if !value.isEmpty && !addresses.contains(value) { addresses.append(value) }
        }
        return addresses
    }

    /**
     * A copy delivered to any of the mailbox's Send from addresses (`others`) is those aliases' alone.
     * Otherwise To and Cc decide: Postfix and Dovecot stamp the mailbox's own address in Delivered-To.
     */
    static func receives(_ address: String, deliveredTo: [String], recipients: [String], others: Set<String>) -> Bool {
        let named = deliveredTo.filter(others.contains)
        return named.isEmpty ? recipients.contains { $0.lowercased() == address } : named.contains(address)
    }

    static func announced(to: [String], cc: [String], deliveredTo: [String], among aliases: [AliasMailbox]) -> AliasMailbox? {
        for address in to + cc + deliveredTo {
            if let alias = aliases.first(where: { $0.id == address.lowercased() }) { return alias }
        }
        return nil
    }
}
