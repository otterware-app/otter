import CryptoKit
import Darwin
import Foundation
import Security

nonisolated enum MailCredentialStore {
    static let service = "dev.otterware.mail"
    static var group: String { Bundle.main.object(forInfoDictionaryKey: "NotificationAppGroup") as? String ?? "" }

    struct Failure: LocalizedError {
        let status: OSStatus

        var errorDescription: String? { "Couldn't access the mail credentials on this iPhone (\(status))." }
    }

    static func get(_ name: String) -> String? {
        try? read(name)
    }

    static func read(_ name: String) throws -> String? {
        var query = try query()
        query[kSecAttrAccount as String] = name
        query[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw Failure(status: status) }
        return String(data: data, encoding: .utf8)
    }

    static func names() throws -> [String] {
        var query = try query()
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let items = result as? [[String: Any]] else { throw Failure(status: status) }
        return items.compactMap { $0[kSecAttrAccount as String] as? String }
    }

    static func write(_ name: String, _ value: String?) throws {
        var query = try query()
        query[kSecAttrAccount as String] = name
        guard let value else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
            return
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, value in value } as CFDictionary, nil)
            if status == errSecDuplicateItem {
                status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            }
        }
        guard status == errSecSuccess else { throw Failure(status: status) }
    }

    private static func query() throws -> [String: Any] {
        guard !group.isEmpty else { throw Failure(status: errSecMissingEntitlement) }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccessGroup as String: group,
        ]
    }

    static func locked<T>(
        _ key: String, isolation: isolated (any Actor)? = #isolation, body: () async throws -> T
    ) async throws -> T {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group) else {
            throw Failure(status: errSecMissingEntitlement)
        }
        let directory = container.appending(path: "Notifications", directoryHint: .isDirectory)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
        let name = SHA256.hash(data: Data(key.lowercased().utf8)).map { String(format: "%02x", $0) }.joined()
        let path = directory.appending(path: "lock-" + name).path
        let fd = open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard fd >= 0 else { throw CocoaError(.fileWriteUnknown) }
        defer { flock(fd, LOCK_UN); close(fd) }
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: path)
        let deadline = ContinuousClock.now + .seconds(20)
        while flock(fd, LOCK_EX | LOCK_NB) != 0 {
            guard errno == EWOULDBLOCK, ContinuousClock.now < deadline else { throw CocoaError(.fileLocking) }
            try await Task.sleep(for: .milliseconds(25))
        }
        try Task.checkCancellation()
        return try await body()
    }

    static func request(_ url: URL, form: [String: String]) async throws -> (Data, Int) {
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        request.httpBody = Data(form.map { key, value in
            "\(key)=\(value.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")"
        }.joined(separator: "&").utf8)
        let result: (Data, URLResponse)
        do {
            result = try await URLSession.shared.data(for: request)
        } catch let error as URLError where form["grant_type"] == "refresh_token" &&
            [.networkConnectionLost, .timedOut, .cannotConnectToHost].contains(error.code) {
            try Task.checkCancellation()
            result = try await URLSession.shared.data(for: request)
        }
        return (result.0, (result.1 as? HTTPURLResponse)?.statusCode ?? 0)
    }
}
