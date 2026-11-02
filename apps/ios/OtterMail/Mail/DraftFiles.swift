import Foundation
import UniformTypeIdentifiers

nonisolated struct DraftFile: Identifiable, Hashable, Codable {
    var id = UUID()
    var filename: String
    var mimeType: String
    var size: Int
    var file: String?
    var original: Attachment?
    var messageID: String?
    var sourceMailbox: String?

    static let limit = 25 * 1024 * 1024
    static let directory = URL.applicationSupportDirectory.appending(path: "draft-files", directoryHint: .isDirectory)
    var url: URL? { file.map { Self.directory.appending(path: $0).appending(path: filename) } }
    var attachment: Attachment {
        Attachment(id: file.map { "local:\($0)" } ?? original?.id, filename: filename, mimeType: mimeType, size: size)
    }

    static func imported(_ data: Data, filename: String, mimeType: String) throws -> DraftFile {
        guard data.count <= limit else { throw Failure.tooLarge }
        let name = URL(fileURLWithPath: filename).lastPathComponent
        var result = DraftFile(filename: name.isEmpty ? "attachment" : name, mimeType: mimeType, size: data.count)
        result.file = result.id.uuidString
        let url = result.url!
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return result
    }

    static func imported(_ url: URL, remaining: Int) throws -> DraftFile {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey, .isRegularFileKey])
        guard values.isRegularFile == true else { throw Failure.unavailable }
        guard (values.fileSize ?? 0) <= remaining else { throw Failure.tooLarge }
        let data = try Data(contentsOf: url)
        guard data.count <= remaining else { throw Failure.tooLarge }
        return try imported(data, filename: url.lastPathComponent, mimeType: values.contentType?.preferredMIMEType ?? "application/octet-stream")
    }

    enum Failure: LocalizedError {
        case tooLarge, unavailable
        var errorDescription: String? {
            switch self {
            case .tooLarge: "Attachments must total 25 MB or less."
            case .unavailable: "This attachment couldn't be opened. Please try again."
            }
        }
    }
}

/** Local recovery copies. Attachments live separately so each keystroke saves only small metadata. */
nonisolated struct RecoveredDraft: Identifiable, Codable {
    var draft: Draft
    var updated: Date = .now
    var id: UUID { draft.id }
}
