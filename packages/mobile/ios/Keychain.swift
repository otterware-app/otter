import Foundation
import Security

/**
 * Generic passwords under the app's service, as the Swift apps keep them
 * (apps/ios-agents' and apps/ios' Keychain.swift): an item they wrote is found here under the
 * same name.
 */
enum Keychain {
  struct Failure: LocalizedError {
    var status: OSStatus
    var errorDescription: String? {
      "The Keychain refused it (\(SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"))."
    }
  }

  static func get(service: String, name: String) throws -> String? {
    if sharedImapPassword(service: service, name: name) { return try MailCredentialStore.read(name) }
    var query = query(service: service, name: name)
    query[kSecReturnData as String] = true
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw Failure(status: status) }
    return String(data: data, encoding: .utf8)
  }

  static func set(service: String, name: String, value: String) throws {
    if sharedImapPassword(service: service, name: name) { return try MailCredentialStore.write(name, value) }
    let query = query(service: service, name: name)
    let attributes: [String: Any] = [
      kSecValueData as String: Data(value.utf8),
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
    ]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
    }
    guard status == errSecSuccess else { throw Failure(status: status) }
  }

  static func delete(service: String, name: String) throws {
    if sharedImapPassword(service: service, name: name) { return try MailCredentialStore.write(name, nil) }
    let status = SecItemDelete(query(service: service, name: name) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw Failure(status: status) }
  }

  private static func sharedImapPassword(service: String, name: String) -> Bool {
    service == MailCredentialStore.service && name.hasPrefix("imap-password:")
  }

  private static func query(service: String, name: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: name,
    ]
  }
}
