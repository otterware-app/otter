import Foundation

/**
 * The tasks on disk: one JSON file a scope (the signed-in Otter account, or
 * the demo), written atomically as the mail cache and the draft recovery
 * copies are (`MailCache`, `MailStore.saveRecovery`). Nothing leaves the
 * phone.
 */
nonisolated final class TaskFiles: Sendable {
    static let live = TaskFiles(folder: URL.applicationSupportDirectory.appending(path: "tasks", directoryHint: .isDirectory))

    private let folder: URL
    private let queue = DispatchQueue(label: "app.otter.mail.tasks", qos: .utility)

    init(folder: URL) { self.folder = folder }

    private func file(_ scope: String) -> URL { folder.appending(path: "\(scope).json") }

    /**
     * The scope's tasks, read on the writing queue so it always sees the last
     * save: nil when the scope has no file yet, and a throw when there is one
     * that can't be read or decoded, which the store leaves alone rather than
     * writing an empty list over.
     */
    func load(_ scope: String) throws -> [MailTask]? {
        try queue.sync {
            let file = file(scope)
            guard FileManager.default.fileExists(atPath: file.path) else { return nil }
            return try JSONDecoder().decode([MailTask].self, from: try Data(contentsOf: file))
        }
    }

    /** The scope's lists, beside its tasks, so a tasks file from before lists reads as it always did. */
    func loadProjects(_ scope: String) throws -> [TaskProject]? {
        try queue.sync {
            let file = file("\(scope).projects")
            guard FileManager.default.fileExists(atPath: file.path) else { return nil }
            return try JSONDecoder().decode([TaskProject].self, from: try Data(contentsOf: file))
        }
    }

    func saveProjects(_ projects: [TaskProject], scope: String) async throws {
        try await write(projects, to: file("\(scope).projects"))
    }

    /** Returns once the file is on disk, so a failure reaches whoever asked for the save. */
    func save(_ tasks: [MailTask], scope: String) async throws {
        try await write(tasks, to: file(scope))
    }

    private func write(_ value: some Encodable & Sendable, to file: URL) async throws {
        let folder = folder
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                do {
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let data = try JSONEncoder().encode(value)
                    try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
                    continuation.resume()
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }
}
