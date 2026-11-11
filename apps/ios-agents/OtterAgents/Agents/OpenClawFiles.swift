import Foundation

/** A file an agent linked or made, read from where the agent runs. */
nonisolated struct ChatFile: Sendable {
    var name: String
    var data: Data
    var mimeType: String

    static let maxBytes = 50 * 1024 * 1024

    init(name: String, data: Data, mimeType: String?) throws {
        guard data.count <= Self.maxBytes else { throw OpenClaw.Failure(message: "That file is too large to preview (50 MB max).") }
        self.name = name
        self.data = data
        self.mimeType = mimeType.flatMap { $0.isEmpty ? nil : $0 } ?? "application/octet-stream"
    }

    /** The path a link names (core's chatFilePath): without `file:` or `sandbox:`, and without a line number. */
    static func path(_ href: String) throws -> String {
        var path = href
        if path.lowercased().hasPrefix("file:") {
            guard let url = URL(string: path) else { throw OpenClaw.Failure(message: "Couldn't read that link.") }
            if let host = url.host(), !host.isEmpty, host != "localhost" { throw OpenClaw.Failure(message: "That file is on another computer.") }
            path = url.path(percentEncoded: true)
        } else if path.lowercased().hasPrefix("sandbox:") {
            path = String(path.dropFirst("sandbox:".count))
        }
        path = path.removingPercentEncoding ?? path
        return path.replacingOccurrences(of: ":\\d+(?:-\\d+)?$", with: "", options: .regularExpression)
    }
}

/** What the Mac and web apps' OpenClaw `readFile` does (extensions/openclaw/core/openclaw.ts): change both together. */
extension OpenClaw {
    private static let fileTimeout: TimeInterval = 120
    private static let unreadable = "This file is outside the agent's workspace on the OpenClaw machine. Ask it to save the file in its workspace, or attach it."

    func file(session: String, href: String) async throws -> ChatFile {
        if href.hasPrefix("otter-artifact:") { return try await artifact(session: session, href: href) }
        let path = try ChatFile.path(href)
        let name = path.split(separator: "/").last.map(String.init) ?? "File"
        if ChatText.isImageLink(path) {
            let ref = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? name
            let result = try await request("sessions.files.assets", ["sessionKey": session, "path": path, "refs": [ref]]) as? [String: Any]
            let asset = (result?["assets"] as? [[String: Any]])?.first
            guard let content = asset?["content"] as? String, let data = Data(base64Encoded: content) else {
                throw Failure(message: "OpenClaw couldn't read this image. Ask it to attach the image directly.")
            }
            return try ChatFile(name: name, data: data, mimeType: asset?["mimeType"] as? String)
        }
        // The gateway serves only files in the agent's workspace: one it wrote elsewhere on its
        // machine (/tmp, say) can't be read from here.
        let result: [String: Any]?
        do {
            result = try await request("sessions.files.get", ["sessionKey": session, "path": path]) as? [String: Any]
        } catch {
            throw Self.outside(error) ? Failure(message: Self.unreadable) : error
        }
        guard let file = result?["file"] as? [String: Any] else { throw Failure(message: Self.unreadable) }
        guard let content = file["content"] as? String else {
            // It shares only images and text, up to 256 KB: the Otter plugin sends the rest (a PDF).
            do {
                let whole = (try await request("otter.files.get", ["sessionKey": session, "path": path], timeout: Self.fileTimeout) as? [String: Any])?["file"] as? [String: Any]
                guard let content = whole?["content"] as? String, let data = Data(base64Encoded: content) else { throw Failure(message: Self.unreadable) }
                return try ChatFile(name: whole?["name"] as? String ?? name, data: data, mimeType: file["mimeType"] as? String)
            } catch let error as Failure where error.message.range(of: "unknown method", options: .caseInsensitive) != nil {
                throw Failure(message: "To open this file, update the Otter plugin on the OpenClaw gateway: openclaw plugins update @otterware/openclaw-otter")
            } catch {
                throw Self.outside(error) ? Failure(message: Self.unreadable) : error
            }
        }
        let data = file["contentEncoding"] as? String == "base64" ? Data(base64Encoded: content) : Data(content.utf8)
        guard let data else { throw Failure(message: Self.unreadable) }
        return try ChatFile(name: (file["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? name, data: data, mimeType: file["mimeType"] as? String)
    }

    private func artifact(session: String, href: String) async throws -> ChatFile {
        let id = String(href.dropFirst("otter-artifact:".count))
        let result = try await request("artifacts.download", ["sessionKey": session, "artifactId": id.removingPercentEncoding ?? id],
                                       timeout: Self.fileTimeout) as? [String: Any] ?? [:]
        let artifact = result["artifact"] as? [String: Any] ?? [:]
        let title = artifact["title"] as? String ?? "File"
        if result["encoding"] as? String == "base64", let encoded = result["data"] as? String, let data = Data(base64Encoded: encoded) {
            return try ChatFile(name: title, data: data, mimeType: artifact["mimeType"] as? String)
        }
        guard let path = result["url"] as? String, let url = URL(string: path.replacingOccurrences(of: "^/", with: "", options: .regularExpression), relativeTo: httpBase) else {
            throw Failure(message: "OpenClaw hasn't made this image available to download.")
        }
        // The gateway's own link: fetched without this iPhone's credentials.
        var fetch = URLRequest(url: url, timeoutInterval: 30)
        fetch.httpShouldHandleCookies = false
        let (data, response) = try await URLSession.shared.data(for: fetch)
        guard let http = response as? HTTPURLResponse, (200 ..< 300).contains(http.statusCode) else {
            throw Failure(message: "Couldn't load the file (HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)).")
        }
        return try ChatFile(name: title, data: data, mimeType: artifact["mimeType"] as? String ?? http.value(forHTTPHeaderField: "content-type"))
    }

    /** The gateway's address over HTTP, for what it serves beside its socket. */
    var httpBase: URL {
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) ?? URLComponents()
        parts.scheme = parts.scheme?.lowercased() == "wss" ? "https" : parts.scheme?.lowercased() == "ws" ? "http" : parts.scheme
        if !(parts.path.hasSuffix("/")) { parts.path += "/" }
        return parts.url ?? url
    }

    private static func outside(_ error: Error) -> Bool {
        (error as? Failure)?.message.range(of: "not found|outside", options: [.regularExpression, .caseInsensitive]) != nil
    }
}
