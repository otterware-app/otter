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

    init(folder: URL) { self.folder = folder }

    private func file(_ email: String) -> URL { folder.appending(path: "\(email.lowercased()).json") }

    func load(_ emails: [String]) async -> [Snapshot] {
        await withCheckedContinuation { continuation in
            queue.async {
                let snapshots = emails.compactMap { email -> Snapshot? in
                    guard let data = try? Data(contentsOf: self.file(email)) else { return nil }
                    return try? JSONDecoder().decode(Snapshot.self, from: data)
                }
                continuation.resume(returning: snapshots)
            }
        }
    }

    func save(_ snapshots: [Snapshot]) {
        queue.async {
            try? FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
            for var cached in snapshots {
                cached.threads = Array(cached.threads.sorted { $0.latest.date > $1.latest.date }.prefix(400))
                try? JSONEncoder().encode(cached).write(to: self.file(cached.mailbox.email), options: .atomic)
            }
        }
    }

    func remove(_ email: String) {
        queue.async { try? FileManager.default.removeItem(at: self.file(email)) }
    }

    func removeAll() {
        queue.async { try? FileManager.default.removeItem(at: self.folder) }
    }
}
