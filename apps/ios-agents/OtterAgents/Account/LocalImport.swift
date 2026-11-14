import Foundation

/**
 * Where this iPhone kept agents and chats before the account kept them (the `agents` list, the
 * `Chats` folder, the secrets in the Keychain): sent to the account once, whole, as core's
 * local-import.ts does on a Mac. A chat the account has newer keeps its own fields and takes the
 * turns only this iPhone had.
 */
extension AgentSync {
    func importLocalData(user: String) {
        let defaults = UserDefaults.standard
        let folder = Self.folder(user)
        let chats = URL.applicationSupportDirectory.appending(path: "Chats/\(folder)", directoryHint: .isDirectory)
        let list = defaults.data(forKey: "agents").flatMap { try? JSON(parsing: $0) }
        guard list != nil || FileManager.default.fileExists(atPath: chats.path(percentEncoded: false)) else { return }

        var mutations: [JSON] = []
        for (addedAt, agent) in (list?["agents"]?.array ?? []).enumerated() {
            guard let id = agent["id"]?.string, let kind = agent["kind"]?.string, let name = agent["name"]?.string, !name.isEmpty else { continue }
            let type = AgentKind(rawValue: kind)
            let own = type?.deviceFields ?? []
            let settings = agent["settings"]?.object ?? [:]
            mutations.append(AgentMutation.setAgent(id, kind: kind, name: name, avatar: agent["avatar"]?.string.map(JSON.string),
                                                    settings: settings.filter { !own.contains($0.key) }, addedAt: addedAt))
            let mine = settings.filter { own.contains($0.key) }
            if !mine.isEmpty { mutations.append(AgentMutation.device(id, device: device, settings: mine)) }
            for secret in type?.secrets ?? [] where type?.deviceSecrets.contains(secret) == false {
                if let value = Keychain.get("agent:\(id):\(secret)"), !value.isEmpty { mutations.append(AgentMutation.secret(id, secret, value)) }
            }
        }
        mutations += (list?["removed"]?.array ?? []).compactMap(\.string).map(AgentMutation.removeAgent)
        if let selected = list?["selected"]?.string { mutations.append(AgentMutation.select(selected)) }

        let files = (try? FileManager.default.contentsOfDirectory(at: chats, includingPropertiesForKeys: nil)) ?? []
        for file in files where file.pathExtension == "json" && file.lastPathComponent != "list.json" {
            guard case .object(var chat) = try? JSON(parsing: Data(contentsOf: file)), let id = chat["id"]?.string else { continue }
            let turns = chat.removeValue(forKey: "turns")?.array ?? []
            mutations.append(AgentMutation.setChat(chat, ifNewer: true))
            mutations.append(AgentMutation.turns(id, put: turns, order: turns.compactMap { $0["id"]?.string }, imported: true))
        }
        mutations += (defaults.stringArray(forKey: "chat-deleted:\(folder)") ?? []).map(AgentMutation.deleteChat)

        mutate(mutations)
        saveNow()
        try? FileManager.default.removeItem(at: chats)
        for key in ["agents", "chat-pending:\(folder)", "chat-deleted:\(folder)"] { defaults.removeObject(forKey: key) }
    }
}
