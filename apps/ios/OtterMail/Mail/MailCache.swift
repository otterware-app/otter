import CryptoKit
import Foundation

nonisolated final class MailCache: Sendable {
    struct Snapshot: Codable, Sendable {
        var mailbox: Mailbox
        var state: MailboxState
        var threads: [MailThread]
    }

    static let live = MailCache(folder: URL.applicationSupportDirectory.appending(path: "mail", directoryHint: .isDirectory))
    private let folder: URL
    private let queue = DispatchQueue(label: "app.otter.mail.cache", qos: .utility)
    /** Each file as last read or written, so a save rewrites only the mailboxes that changed: every sync saves. Touched on `queue` only. */
    nonisolated(unsafe) private var written: [String: SHA256.Digest] = [:]

    init(folder: URL) { self.folder = folder }

    private func file(_ email: String) -> URL { folder.appending(path: "\(email.lowercased()).json") }

    func load(_ emails: [String]) async -> [Snapshot] {
        await withCheckedContinuation { continuation in
            queue.async {
                let snapshots = emails.compactMap { email -> Snapshot? in
                    guard let data = try? Data(contentsOf: self.file(email)) else { return nil }
                    self.written[email.lowercased()] = SHA256.hash(data: data)
                    return try? JSONDecoder().decode(Snapshot.self, from: data)
                }
                continuation.resume(returning: snapshots)
            }
        }
    }

    func save(_ snapshots: [Snapshot]) {
        queue.async {
            try? FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            // Dictionaries in a fixed order: the same mail encodes the same.
            encoder.outputFormatting = .sortedKeys
            for var cached in snapshots {
                cached.threads = Array(cached.threads.sorted { $0.latest.date > $1.latest.date }.prefix(400))
                guard let data = try? encoder.encode(cached) else { continue }
                let key = cached.mailbox.email.lowercased(), digest = SHA256.hash(data: data)
                guard self.written[key] != digest else { continue }
                if (try? data.write(to: self.file(key), options: .atomic)) != nil { self.written[key] = digest }
            }
        }
    }

    func remove(_ email: String) {
        queue.async {
            self.written[email.lowercased()] = nil
            try? FileManager.default.removeItem(at: self.file(email))
        }
    }

    func removeAll() {
        queue.async {
            self.written = [:]
            try? FileManager.default.removeItem(at: self.folder)
        }
    }
}
