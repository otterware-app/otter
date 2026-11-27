import CryptoKit
import Foundation
import UIKit

/**
 * Senders' pictures, as the desktop finds them (core's avatar-store.ts, after
 * Google Contacts): Gravatar, then the sender domain's logo. Hits and misses
 * are kept on disk, so each sender costs one lookup per month (a week for misses).
 */
actor SenderPhotos {
    static let shared = SenderPhotos()

    private var memory: [String: UIImage?] = [:]
    private var inFlight: [String: Task<UIImage?, Never>] = [:]
    /** Where the app and its notifications' extension both find them: a cache, purgeable and not backed up. */
    private static let directory = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: PushState.group)?
        .appending(path: "Library/Caches/SenderPhotos", directoryHint: .isDirectory)
        ?? URL.cachesDirectory.appending(path: "sender-photos", directoryHint: .isDirectory)

    /** A photo already found, from disk: new mail's notification can't wait for the network. */
    static func cached(for email: String) -> Data? {
        let file = directory.appending(path: sha256(email.trimmingCharacters(in: .whitespaces).lowercased()))
        guard let modified = (try? FileManager.default.attributesOfItem(atPath: file.path(percentEncoded: false)))?[.modificationDate] as? Date,
              Date.now.timeIntervalSince(modified) < hitTTL,
              let data = try? Data(contentsOf: file), !data.isEmpty else { return nil }
        return data
    }

    private static let hitTTL: TimeInterval = 30 * 86_400

    func photo(for email: String) async -> UIImage? {
        let email = email.trimmingCharacters(in: .whitespaces).lowercased()
        guard email.contains("@") else { return nil }
        if let known = memory[email] { return known }
        if let pending = inFlight[email] { return await pending.value }
        let task = Task { await load(email) }
        inFlight[email] = task
        let image = await task.value
        inFlight[email] = nil
        memory[email] = image
        return image
    }

    private func load(_ email: String) async -> UIImage? {
        let file = Self.directory.appending(path: Self.sha256(email))
        if let attributes = try? FileManager.default.attributesOfItem(atPath: file.path()),
           let modified = attributes[.modificationDate] as? Date {
            let data = try? Data(contentsOf: file)
            let ttl: TimeInterval = data?.isEmpty == false ? Self.hitTTL : 7 * 86_400
            if Date.now.timeIntervalSince(modified) < ttl { return data.flatMap(UIImage.init) }
        }
        let data = await resolve(email)
        try? FileManager.default.createDirectory(at: Self.directory, withIntermediateDirectories: true)
        try? (data ?? Data()).write(to: file, options: .atomic)
        return data.flatMap(UIImage.init)
    }

    private func resolve(_ email: String) async -> Data? {
        if let gravatar = await image(at: "https://www.gravatar.com/avatar/\(Self.sha256(email))?s=128&d=404") {
            return gravatar
        }
        guard let domain = email.split(separator: "@").last.map(String.init), !Self.freemail.contains(domain) else { return nil }
        if let logo = await logo(domain) { return logo }
        let root = Self.registrableDomain(domain)
        return root != domain && !Self.freemail.contains(root) ? await logo(root) : nil
    }

    private func logo(_ domain: String) async -> Data? {
        let encoded = domain.addingPercentEncoding(withAllowedCharacters: .urlHostAllowed) ?? domain
        for address in ["https://www.google.com/s2/favicons?domain=\(encoded)&sz=64", "https://icons.duckduckgo.com/ip3/\(encoded).ico"] {
            // A 16px favicon blurs at the list's size; better the initial.
            if let logo = await image(at: address), let width = UIImage(data: logo)?.cgImage?.width, width >= 32 {
                return logo
            }
        }
        return nil
    }

    private func image(at address: String) async -> Data? {
        guard let url = URL(string: address) else { return nil }
        var request = URLRequest(url: url)
        request.timeoutInterval = 6
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, http.statusCode == 200,
              http.mimeType?.hasPrefix("image/") == true,
              !data.isEmpty, data.count <= 300 * 1024, UIImage(data: data) != nil
        else { return nil }
        return data
    }

    private static func sha256(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private static func registrableDomain(_ domain: String) -> String {
        let parts = domain.split(separator: ".")
        guard parts.count > 2 else { return domain }
        let take = ["co", "com", "org", "net", "ac", "gov", "edu"].contains(String(parts[parts.count - 2])) ? 3 : 2
        return parts.suffix(take).joined(separator: ".")
    }

    /** Core's freemail.ts: a domain here is no one's own, so it has no logo of theirs. */
    private static let freemail: Set<String> = [
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
        "ymail.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "pm.me", "gmx.com",
        "gmx.de", "gmx.net", "web.de", "aol.com", "mail.com", "zoho.com", "hey.com", "fastmail.com",
        "t-online.de", "orange.fr", "free.fr",
    ]
}
