import Foundation
import Security

nonisolated enum Keychain {
    private static let service = "dev.otterware.agents"
    /** Kept here instead, in tests: a test build made without signing (CI's) has no Keychain. */
    nonisolated(unsafe) static var memory: [String: String]?

    static func get(_ key: String) -> String? {
        if let memory { return memory[key] }
        var result: AnyObject?
        var query = query(key)
        query[kSecReturnData as String] = true
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func set(_ key: String, _ value: String?, thisDeviceOnly: Bool = false) -> Bool {
        if memory != nil {
            memory?[key] = value
            return true
        }
        let query = query(key)
        guard let value else {
            let status = SecItemDelete(query as CFDictionary)
            return status == errSecSuccess || status == errSecItemNotFound
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: thisDeviceOnly ? kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly : kSecAttrAccessibleAfterFirstUnlock,
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status != errSecItemNotFound { return status == errSecSuccess }
        return SecItemAdd(query.merging(attributes) { _, value in value } as CFDictionary, nil) == errSecSuccess
    }

    private static func query(_ key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }
}
