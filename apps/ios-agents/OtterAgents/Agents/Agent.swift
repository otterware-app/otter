import Foundation
import Observation

/**
 * One agent you added: what the account keeps of it (`entry`), and how this iPhone reaches it.
 * Its connection, secrets, models and status are its own, so two of a kind (two Hermes servers,
 * two OpenClaw gateways, each paired as a device of its own) run side by side.
 */
@Observable
final class Agent: Identifiable {
    var entry: AgentEntry
    var status: Agents.Status = .notConfigured
    var models: [Hermes.Model] = []
    /** An OpenClaw gateway's agents as they show themselves: a picture or an emoji, by agent. */
    var faces: [String: (avatar: String?, emoji: String?)] = [:]
    var pairing: String?
    /** Whether you can talk with it in a chat: its gateway has a realtime voice set up. */
    var talks = false
    var fullAccess: Bool?
    var fullAccessRequest: String?

    /** The gateway's agents as it last listed them, kept on this iPhone: their names and pictures are there before it answers. */
    @ObservationIgnored var gatewayAgents: [OpenClaw.GatewayAgent] = []
    @ObservationIgnored var skills: (at: Date, skills: [Skill])?
    @ObservationIgnored private var gateway: OpenClaw?
    @ObservationIgnored private var varysConnection: (key: String, client: Varys)?

    init(_ entry: AgentEntry) {
        self.entry = entry
        if kind == .openclaw {
            gatewayAgents = (try? JSONDecoder().decode([OpenClaw.GatewayAgent].self, from: Data(contentsOf: gatewayAgentsFile))) ?? []
            showGatewayAgents()
        }
    }

    var id: String { entry.id }
    var name: String { entry.name }
    var avatar: String? { entry.avatar }
    /** Its kind, when this iPhone runs it. */
    var kind: AgentKind? { AgentKind(rawValue: entry.kind) }
    var enabled: Bool { entry.settings["enabled"]?.bool ?? true }
    var isUsable: Bool { kind != nil && enabled && status == .ready }

    func string(_ key: String) -> String { entry.settings[key]?.string ?? "" }

    var statusText: String {
        guard enabled else { return "Off" }
        if pairing != nil { return "Waiting for approval" }
        return switch status {
        case .notConfigured: "Not connected"
        case .checking: "Checking…"
        case .ready: "Connected"
        case .failed: "Not answering"
        }
    }

    // MARK: Models

    /** The model a turn runs on (an OpenClaw gateway's agent): the one chosen, else the agent's default. */
    var model: Hermes.Model? {
        let chosen = string("model")
        return enabledModels.first { $0.slug == chosen && !chosen.isEmpty } ?? enabledModels.first(where: \.isDefault) ?? enabledModels.first
    }

    var enabledModels: [Hermes.Model] { kind == .openclaw ? models.filter { isGatewayAgentEnabled($0.slug) } : models }
    var canStartChat: Bool { kind != .openclaw || (models.isEmpty ? isGatewayAgentEnabled("main") : !enabledModels.isEmpty) }

    func isGatewayAgentEnabled(_ id: String) -> Bool {
        !(entry.settings["disabledAgents"]?.array?.compactMap(\.string) ?? []).contains(id)
    }

    /** What the picker shows beside the model: "High · Fast". */
    var traits: String? {
        guard kind == .hermes, let model else { return nil }
        var parts: [String] = []
        if model.reasoning, let effort = Agents.efforts(model).first(where: { $0.id == string("reasoningEffort") && !$0.id.isEmpty }) { parts.append(effort.label) }
        if model.fast, string("serviceTier") == "priority" { parts.append("Fast") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var hermesModelFields: [String: Any] {
        var fields: [String: Any] = [:]
        let parts = string("model").components(separatedBy: "::")
        if parts.count == 2 {
            fields["provider"] = parts[0]
            fields["model"] = parts[1]
        }
        var options: [String: Any] = [:]
        let effort = string("reasoningEffort"), tier = string("serviceTier")
        if effort == "none" {
            options["reasoning"] = ["enabled": false]
        } else if !effort.isEmpty {
            options["reasoning"] = ["effort": effort]
        }
        if !tier.isEmpty, tier != "default" { options["service_tier"] = tier }
        if !options.isEmpty { fields["model_options"] = options }
        return fields
    }

    /** Tasks whose results the account said to leave with the agent (the Mac's and the web's setting too). */
    var muted: Set<String> {
        guard let key = mutedKey else { return [] }
        return Set(string(key).split(separator: ",").map(String.init))
    }

    var mutedKey: String? {
        switch kind {
        case .hermes: "mutedJobs"
        case .varys: "mutedRoutines"
        default: nil
        }
    }

    // MARK: Secrets

    /** Kept under the agent's id, as core keeps them (`agent:<id>:<name>`): the account's come from `AgentSync`, through `Agents.setSecret`. */
    private func secretName(_ name: String) -> String { "agent:\(id):\(name)" }

    func secret(_ name: String) -> String? { Keychain.get(secretName(name)).flatMap(\.nilIfEmpty) }

    func setSecret(_ name: String, _ value: String?, thisDeviceOnly: Bool = false) {
        Keychain.set(secretName(name), value, thisDeviceOnly: thisDeviceOnly)
    }

    func forgetSecrets() {
        for name in kind?.secrets ?? [] { setSecret(name, nil) }
        try? FileManager.default.removeItem(at: gatewayAgentsFile)
    }

    // MARK: Reaching it

    var hermes: Hermes? {
        let url = string("baseUrl")
        guard kind == .hermes, enabled, !url.isEmpty, let key = secret("key") else { return nil }
        return Hermes(baseURL: Hermes.normalized(url), key: key)
    }

    var openClaw: OpenClaw? {
        guard kind == .openclaw, enabled, let url = URL(string: string("url")), !string("url").isEmpty else { return nil }
        if gateway?.url != url {
            gateway?.disconnect()
            let id = id
            let secrets = OpenClaw.Secrets(get: { Keychain.get("agent:\(id):\($0)") }, set: { Keychain.set("agent:\(id):\($0)", $1, thisDeviceOnly: true) })
            gateway = OpenClaw(url: url, secrets: secrets, appVersion: Bundle.main.version)
        }
        return gateway
    }

    var varys: Varys? {
        let address = string("address"), agentId = string("agentId")
        guard kind == .varys, enabled, !address.isEmpty, !agentId.isEmpty, let token = secret(Varys.tokenName) else { return nil }
        let key = [address, agentId, token].joined(separator: "\n")
        if varysConnection?.key != key {
            varysConnection?.client.disconnect()
            varysConnection = (key, Varys(address: address, agentId: agentId, token: token))
        }
        return varysConnection?.client
    }

    /** In the background the sockets close; the agent goes on, and its turns are picked up on return. */
    func suspend() {
        gateway?.disconnect()
        varysConnection?.client.disconnect()
    }

    /** Its connections go: its address or pairing changed, or it's gone. */
    func close() {
        suspend()
        gateway = nil
        varysConnection = nil
    }

    // MARK: An OpenClaw gateway's agents

    var gatewayAgentsFile: URL { URL.cachesDirectory.appending(path: "openclaw-agents-\(id).json") }

    func keep(gatewayAgents agents: [OpenClaw.GatewayAgent]) {
        let changed = agents != gatewayAgents
        gatewayAgents = agents
        showGatewayAgents()
        guard changed else { return }
        if agents.isEmpty {
            try? FileManager.default.removeItem(at: gatewayAgentsFile)
        } else {
            try? JSONEncoder().encode(agents).write(to: gatewayAgentsFile, options: .atomic)
        }
    }

    private func showGatewayAgents() {
        models = gatewayAgents.map {
            Hermes.Model(slug: $0.id, name: $0.name, isDefault: $0.isDefault, reasoning: false, canDisableReasoning: false, fast: false)
        }
        faces = Dictionary(gatewayAgents.map { ($0.id, ($0.avatar, $0.emoji)) }) { first, _ in first }
    }
}
