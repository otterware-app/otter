import Foundation

nonisolated struct GmailNotification {
    struct Message: Decodable, Sendable {
        struct Payload: Decodable, Sendable {
            struct Header: Decodable, Sendable { var name: String; var value: String }
            var headers: [Header]?
        }
        var id: String
        var threadId: String
        var labelIds: [String]?
        var snippet: String?
        var internalDate: String?
        var payload: Payload?

        var preview: String { MailDecoding.preview(snippet ?? "", limit: 500) }

        func eligible(_ mode: String) -> Bool {
            let labels = Set(labelIds ?? [])
            return mode != "off" && labels.contains("UNREAD") && labels.isDisjoint(with: ["DRAFT", "SENT", "SPAM", "TRASH"])
                && (mode == "all" || labels.contains("INBOX"))
        }
        func header(_ name: String) -> String {
            MailDecoding.words(payload?.headers?.first { $0.name.caseInsensitiveCompare(name) == .orderedSame }?.value ?? "")
        }

        var sender: String {
            let from = header("From")
            if let bracket = from.firstIndex(of: "<") {
                let name = from[..<bracket].trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "\""))
                if !name.isEmpty { return name }
            }
            return from
        }
    }
    struct Failure: Error { var status: Int }
    let get: @Sendable (String, [URLQueryItem]) async throws -> Data

    static func direct(email: String) -> Self {
        Self { path, query in
            var components = URLComponents(string: "https://gmail.googleapis.com/gmail/v1/users/me/\(path)")!
            components.queryItems = query
            for attempt in 0..<2 {
                var request = URLRequest(url: components.url!)
                request.timeoutInterval = 8
                let token = try await GoogleCredentials.refresh(email, force: attempt > 0)
                request.setValue("Bearer \(token.accessToken)", forHTTPHeaderField: "Authorization")
                let (data, response) = try await URLSession.shared.dataRetrying(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                if status == 200 { return data }
                if status == 401 && attempt == 0 { continue }
                throw Failure(status: status)
            }
            throw Failure(status: 401)
        }
    }
}

extension URLSession {
    /**
     * Tries once more when a poor network drops the connection. iOS retries no POST itself, and a
     * notification has one chance: a token refresh lost on mobile data left the generic alert.
     */
    nonisolated func dataRetrying(for request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await data(for: request)
        } catch let error as URLError where [.networkConnectionLost, .timedOut, .cannotConnectToHost].contains(error.code) {
            try Task.checkCancellation()
            return try await data(for: request)
        }
    }
}

/** Success, expiry, and cancellation race through the same completion gate. */
nonisolated final class NotificationCompletion<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: ((Value) -> Void)?
    init(_ handler: @escaping (Value) -> Void) { self.handler = handler }
    func finish(_ value: Value) {
        lock.lock()
        let callback = handler
        handler = nil
        lock.unlock()
        callback?(value)
    }
}
