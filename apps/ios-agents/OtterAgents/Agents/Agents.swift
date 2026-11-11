import Foundation
import Observation

/**
 * The agents and how this iPhone reaches each: Hermes on your server (its settings and sealed
 * key follow the Otter account, in the `assistant` section the
 * Mac and the web keep too), OpenClaw and varys as a device of their own (paired here, kept here).
 * Every connected agent is ready at once: a chat runs on the one it started with.
 */
@Observable
final class Agents {
    struct HermesSettings: Codable, Equatable {
        var enabled = true
        var baseUrl = ""
        var agentModel = ""
        var model = ""
        var reasoningEffort = ""
        var serviceTier = ""
        var sessions: Bool?

        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            baseUrl = try c.decodeIfPresent(String.self, forKey: .baseUrl) ?? ""
            agentModel = try c.decodeIfPresent(String.self, forKey: .agentModel) ?? ""
            model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
            reasoningEffort = try c.decodeIfPresent(String.self, forKey: .reasoningEffort) ?? ""
            serviceTier = try c.decodeIfPresent(String.self, forKey: .serviceTier) ?? ""
            sessions = try c.decodeIfPresent(Bool.self, forKey: .sessions)
        }
    }

    struct OpenClawSettings: Codable, Equatable {
        var enabled = true
        var url = ""
        var model = ""

        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
            model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
        }
    }

    /** This iPhone's pairing with varys: its own grant, so it stays here, with the token in the Keychain. */
    struct VarysSettings: Codable, Equatable {
        var enabled = true
        var address = ""
        var agentId = ""
        /** Otter Agents on this iPhone, the same each time it pairs: pairing again replaces its grant. */
        var installation = ""
        /** The account's agent channel this iPhone's grant tells. */
        var relayChannel = ""

        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            address = try c.decodeIfPresent(String.self, forKey: .address) ?? ""
            agentId = try c.decodeIfPresent(String.self, forKey: .agentId) ?? ""
            installation = try c.decodeIfPresent(String.self, forKey: .installation) ?? ""
            relayChannel = try c.decodeIfPresent(String.self, forKey: .relayChannel) ?? ""
        }
    }

    enum Status: Equatable {
        case notConfigured
        case checking
        case ready
        case failed(String)
    }

    enum FollowUp: String, CaseIterable, Identifiable {
        case queue, steer
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    var hermes: HermesSettings { didSet { if hermes != oldValue { assistantChanged() } } }
    var openclaw: OpenClawSettings {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(openclaw), forKey: Self.openClawKey) }
    }
    var varys: VarysSettings {
        didSet { UserDefaults.standard.set(try? JSONEncoder().encode(varys), forKey: Self.varysKey) }
    }
    /** The agent a new chat starts on. */
    var selected: String {
        didSet {
            guard oldValue != selected else { return }
            if !applying { section["selected"] = selected }
            assistantChanged()
        }
    }
    /** What a message sent while the agent runs does: waits its turn, or joins the run. */
    var followUp: FollowUp { didSet { if followUp != oldValue { uiChanged() } } }
    /** Starred models, as `kind:slug`. */
    var favorites: [String] { didSet { if favorites != oldValue { uiChanged() } } }

    private(set) var status: [AgentKind: Status] = [:]
    private(set) var models: [AgentKind: [Hermes.Model]] = [:]
    private(set) var hasHermesKey: Bool
    /** OpenClaw's agents as they show themselves: a picture or an emoji, by agent. */
    private(set) var openClawFaces: [String: (avatar: String?, emoji: String?)] = [:]
    private(set) var openClawPairing: String?
    private(set) var openClawFullAccess: Bool?
    private(set) var openClawFullAccessRequest: String?
    /** The demo's pretend agent stands in for all of them. */
    private(set) var demo = false

    @ObservationIgnored var relay: Relay?
    /** `assistant`, `hermesKey` or `ui`: what to write to the account. */
    @ObservationIgnored var onChange: (String) -> Void = { _ in }
    /** varys was just reached: turns it was left with are picked up, and what it wrote meanwhile read. */
    @ObservationIgnored var onReady: (AgentKind) -> Void = { _ in }
    /** The account's whole `assistant` section, kept so writes don't drop the Mac's Codex and Claude settings. */
    @ObservationIgnored private var section: [String: Any]
    @ObservationIgnored private var applying = false
    @ObservationIgnored private var gateway: OpenClaw?
    /** OpenClaw's agents as the gateway last listed them, kept on this iPhone: their names and pictures are there before it answers. */
    @ObservationIgnored private var openClawAgents: [OpenClaw.GatewayAgent] = []
    @ObservationIgnored private var varysConnection: (key: String, client: Varys)?
    @ObservationIgnored private var skillsCache: [AgentKind: (at: Date, skills: [Skill])] = [:]

    private static let settingsKey = "assistant"
    private static let hermesKeyName = "hermes-key"
    private static let openClawKey = "openclaw"
    private static let varysKey = "varys"
    private static let followUpKey = "assistant:follow-up-behavior"
    private static let favoritesKey = "assistant:favorite-models"
    private static let appName = "Otter Agents on iPhone"
    static let openClawAgentsFile = URL.cachesDirectory.appending(path: "openclaw-agents.json")

    init() {
        let defaults = UserDefaults.standard
        let saved = (try? JSONSerialization.jsonObject(with: defaults.data(forKey: Self.settingsKey) ?? Data()) as? [String: Any]) ?? [:]
        section = saved
        let hermesSettings: HermesSettings = Self.decode(saved["hermes"]) ?? HermesSettings()
        hermes = hermesSettings
        openclaw = defaults.data(forKey: Self.openClawKey).flatMap { try? JSONDecoder().decode(OpenClawSettings.self, from: $0) } ?? OpenClawSettings()
        varys = defaults.data(forKey: Self.varysKey).flatMap { try? JSONDecoder().decode(VarysSettings.self, from: $0) } ?? VarysSettings()
        let chosen = saved["selected"] as? String ?? ""
        selected = AgentKind(rawValue: chosen) != nil ? chosen : "hermes"
        followUp = defaults.string(forKey: Self.followUpKey).flatMap(FollowUp.init) ?? .queue
        favorites = Self.strings(defaults.string(forKey: Self.favoritesKey))
        hasHermesKey = Keychain.get(Self.hermesKeyName) != nil
        openClawAgents = (try? JSONDecoder().decode([OpenClaw.GatewayAgent].self, from: Data(contentsOf: Self.openClawAgentsFile))) ?? []
        showOpenClawAgents()
    }

    private static func decode<T: Decodable>(_ value: Any?) -> T? {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    private static func strings(_ json: String?) -> [String] {
        (try? JSONDecoder().decode([String].self, from: Data((json ?? "[]").utf8))) ?? []
    }

    // MARK: The account's settings

    /** The section as this device would write it. */
    var syncedSection: [String: Any] {
        var section = section
        let own = ((try? JSONSerialization.jsonObject(with: JSONEncoder().encode(hermes))) as? [String: Any]) ?? [:]
        section["hermes"] = ((section["hermes"] as? [String: Any]) ?? [:]).merging(own) { _, mine in mine }
        // An agent only the Mac runs stays the account's choice.
        if !["claude", "codex"].contains(section["selected"] as? String ?? "") {
            section["selected"] = selected
        }
        return section
    }

    var uiSection: [String: String] {
        [Self.followUpKey: followUp.rawValue,
         Self.favoritesKey: String(decoding: (try? JSONEncoder().encode(favorites)) ?? Data("[]".utf8), as: UTF8.self)]
    }

    private func assistantChanged() {
        section = syncedSection
        UserDefaults.standard.set(try? JSONSerialization.data(withJSONObject: section), forKey: Self.settingsKey)
        if !applying { onChange("assistant") }
    }

    private func uiChanged() {
        for (key, value) in uiSection { UserDefaults.standard.set(value, forKey: key) }
        if !applying { onChange("ui") }
    }

    func apply(assistant remote: [String: Any]?, ui: [String: Any], hermesKey: String?) {
        applying = true
        defer { applying = false }
        if let remote {
            section = remote
            hermes = Self.decode(remote["hermes"]) ?? HermesSettings()
            if let provider = remote["selected"] as? String, AgentKind(rawValue: provider) != nil { selected = provider }
        }
        if let value = (ui[Self.followUpKey] as? String).flatMap(FollowUp.init) { followUp = value }
        if let value = ui[Self.favoritesKey] as? String { favorites = Self.strings(value) }
        if let hermesKey, hermesKey != Keychain.get(Self.hermesKeyName) {
            Keychain.set(Self.hermesKeyName, hermesKey)
            hasHermesKey = true
        }
        Task { await checkAll() }
    }

    /** Signed out: what followed the account goes, what was paired here stays. */
    func forgetAccount() {
        applying = true
        defer { applying = false }
        Keychain.set(Self.hermesKeyName, nil)
        hasHermesKey = false
        section = [:]
        hermes = HermesSettings()
        status[.hermes] = .notConfigured
        models[.hermes] = []
    }

    func startDemo() {
        demo = true
        openClawFaces = ["research": (nil, "🔭")]
        status = [.hermes: .ready, .openclaw: .ready, .varys: .ready]
        models = [
            .hermes: [
                Hermes.Model(slug: "anthropic::claude-opus-5.5", name: "claude-opus-5.5", subProvider: "Anthropic", isDefault: true, reasoning: true, canDisableReasoning: true, fast: true),
                Hermes.Model(slug: "openai::gpt-5.5", name: "gpt-5.5", subProvider: "OpenAI", isDefault: false, reasoning: true, canDisableReasoning: false, fast: true),
            ],
            .openclaw: [
                Hermes.Model(slug: "main", name: "Molty", isDefault: true, reasoning: false, canDisableReasoning: false, fast: false),
                Hermes.Model(slug: "research", name: "Scout", isDefault: false, reasoning: false, canDisableReasoning: false, fast: false),
            ],
            .varys: [Hermes.Model(slug: "", name: "varys", isDefault: true, reasoning: false, canDisableReasoning: false, fast: false)],
        ]
    }

    func endDemo() {
        demo = false
        status = [:]
        models = [:]
        showOpenClawAgents()
    }

    // MARK: What each agent is

    func isEnabled(_ kind: AgentKind) -> Bool {
        switch kind {
        case .hermes: hermes.enabled
        case .openclaw: openclaw.enabled
        case .varys: varys.enabled
        }
    }

    func setEnabled(_ kind: AgentKind, _ enabled: Bool) {
        switch kind {
        case .hermes: hermes.enabled = enabled
        case .openclaw: openclaw.enabled = enabled
        case .varys: varys.enabled = enabled
        }
        Task { await check(kind) }
    }

    func status(of kind: AgentKind) -> Status { status[kind] ?? .notConfigured }
    func isUsable(_ kind: AgentKind) -> Bool { isEnabled(kind) && status(of: kind) == .ready }
    func isUsable(_ provider: String) -> Bool { AgentKind(rawValue: provider).map(isUsable) ?? false }

    /** The agents a chat can start on now. */
    var usable: [AgentKind] { AgentKind.allCases.filter(isUsable) }

    /** Where a new chat starts: the account's choice while it works here, else the first that does. */
    var starting: AgentKind {
        if let chosen = AgentKind(rawValue: selected), isUsable(chosen) { return chosen }
        return usable.first ?? AgentKind(rawValue: selected) ?? .hermes
    }

    func statusText(_ kind: AgentKind) -> String {
        guard isEnabled(kind) else { return "Off" }
        if kind == .openclaw, openClawPairing != nil { return "Waiting for approval" }
        return switch status(of: kind) {
        case .notConfigured: "Not connected"
        case .checking: "Checking…"
        case .ready: "Connected"
        case .failed: "Not answering"
        }
    }

    func models(of kind: AgentKind) -> [Hermes.Model] { models[kind] ?? [] }

    /** Who runs a chat, by name: OpenClaw's agent (the chat's own, or the one a new chat would get), else the agent. */
    func name(of provider: String, agent: String?) -> String {
        if provider == "openclaw", let agent, let name = models(of: .openclaw).first(where: { $0.slug == agent })?.name { return name }
        return AgentKind.name(of: provider)
    }

    /** The OpenClaw agent a chat runs on: its session's, or for one not started, the one chosen. */
    func agent(of chat: Chat) -> String? {
        guard chat.provider == "openclaw" else { return nil }
        return chat.openClawAgent ?? model(of: .openclaw)?.slug
    }

    func chosenModel(_ kind: AgentKind) -> String {
        switch kind {
        case .hermes: hermes.model
        case .openclaw: openclaw.model
        case .varys: ""
        }
    }

    func choose(model slug: String, for kind: AgentKind) {
        switch kind {
        case .hermes: hermes.model = slug
        case .openclaw: openclaw.model = slug
        case .varys: break
        }
    }

    /** The model a turn runs on: the one chosen, else the agent's default. */
    func model(of kind: AgentKind) -> Hermes.Model? {
        let all = models(of: kind), chosen = chosenModel(kind)
        return all.first { $0.slug == chosen && !chosen.isEmpty } ?? all.first(where: \.isDefault) ?? all.first
    }

    func isFavorite(_ kind: AgentKind, _ model: Hermes.Model) -> Bool { favorites.contains("\(kind.rawValue):\(model.slug)") }

    func toggleFavorite(_ kind: AgentKind, _ model: Hermes.Model) {
        let key = "\(kind.rawValue):\(model.slug)"
        if let at = favorites.firstIndex(of: key) { favorites.remove(at: at) } else { favorites.append(key) }
    }

    static func efforts(_ model: Hermes.Model) -> [(id: String, label: String)] {
        [("", "Default")] + (model.canDisableReasoning ? [("none", "Off")] : [])
            + [("minimal", "Minimal"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra High")]
    }

    /** What the model picker shows beside the model: "High · Fast". */
    func traits(of kind: AgentKind) -> String? {
        guard kind == .hermes, let model = model(of: .hermes) else { return nil }
        var parts: [String] = []
        if model.reasoning, let effort = Self.efforts(model).first(where: { $0.id == hermes.reasoningEffort && !$0.id.isEmpty }) { parts.append(effort.label) }
        if model.fast, hermes.serviceTier == "priority" { parts.append("Fast") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var hermesModelFields: [String: Any] {
        var fields: [String: Any] = [:]
        let parts = hermes.model.components(separatedBy: "::")
        if parts.count == 2 {
            fields["provider"] = parts[0]
            fields["model"] = parts[1]
        }
        var options: [String: Any] = [:]
        if hermes.reasoningEffort == "none" {
            options["reasoning"] = ["enabled": false]
        } else if !hermes.reasoningEffort.isEmpty {
            options["reasoning"] = ["effort": hermes.reasoningEffort]
        }
        if !hermes.serviceTier.isEmpty, hermes.serviceTier != "default" { options["service_tier"] = hermes.serviceTier }
        if !options.isEmpty { fields["model_options"] = options }
        return fields
    }

    // MARK: Reaching them

    var hermesKey: String? { Keychain.get(Self.hermesKeyName) }

    var hermesClient: Hermes? {
        guard hermes.enabled, !hermes.baseUrl.isEmpty, let key = hermesKey else { return nil }
        return Hermes(baseURL: Hermes.normalized(hermes.baseUrl), key: key)
    }

    private static let openClawSecrets = OpenClaw.Secrets(get: { Keychain.get($0) }, set: { Keychain.set($0, $1, thisDeviceOnly: true) })

    var openClawClient: OpenClaw? {
        guard openclaw.enabled, !openclaw.url.isEmpty, let url = URL(string: openclaw.url) else { return nil }
        if gateway?.url != url {
            gateway?.disconnect()
            gateway = OpenClaw(url: url, secrets: Self.openClawSecrets, appVersion: Bundle.main.version)
        }
        return gateway
    }

    var varysClient: Varys? {
        guard varys.enabled, !varys.address.isEmpty, !varys.agentId.isEmpty,
              let token = Keychain.get(Varys.tokenName), !token.isEmpty else { return nil }
        let key = [varys.address, varys.agentId, token].joined(separator: "\n")
        if varysConnection?.key != key {
            varysConnection?.client.disconnect()
            varysConnection = (key, Varys(address: varys.address, agentId: varys.agentId, token: token))
        }
        return varysConnection?.client
    }

    func checkAll() async {
        guard !demo else { return }
        await withTaskGroup(of: Void.self) { group in
            for kind in AgentKind.allCases { group.addTask { await self.check(kind) } }
        }
    }

    func check(_ kind: AgentKind) async {
        guard !demo else { return }
        switch kind {
        case .hermes: await checkHermes()
        case .openclaw: await checkOpenClaw()
        case .varys: await checkVarys()
        }
    }

    private func checkHermes() async {
        guard let client = hermesClient else { status[.hermes] = .notConfigured; return }
        if status[.hermes] != .ready { status[.hermes] = .checking }
        do {
            let (models, sessions) = try await client.check()
            self.models[.hermes] = models
            if hermes.sessions != sessions {
                applying = true
                hermes.sessions = sessions
                applying = false
            }
            status[.hermes] = .ready
            onReady(.hermes)
        } catch {
            status[.hermes] = .failed("Can't reach Hermes: \(error.localizedDescription)")
        }
    }

    private func checkOpenClaw() async {
        guard let gateway = openClawClient, gateway.hasCredentials else {
            status[.openclaw] = .notConfigured
            models[.openclaw] = []
            return
        }
        if status[.openclaw] != .ready { status[.openclaw] = .checking }
        do {
            keep(openClawAgents: try await gateway.agents())
            openClawPairing = nil
            openClawFullAccess = gateway.fullAccess
            status[.openclaw] = .ready
            onReady(.openclaw)
        } catch {
            openClawPairing = gateway.pairingRequest
            status[.openclaw] = .failed(Self.openClawProblem(error))
        }
    }

    private func keep(openClawAgents agents: [OpenClaw.GatewayAgent]) {
        let changed = agents != openClawAgents
        openClawAgents = agents
        showOpenClawAgents()
        guard changed else { return }
        if agents.isEmpty {
            try? FileManager.default.removeItem(at: Self.openClawAgentsFile)
        } else {
            try? JSONEncoder().encode(agents).write(to: Self.openClawAgentsFile, options: .atomic)
        }
    }

    private func showOpenClawAgents() {
        models[.openclaw] = openClawAgents.map {
            Hermes.Model(slug: $0.id, name: $0.name, isDefault: $0.isDefault, reasoning: false, canDisableReasoning: false, fast: false)
        }
        openClawFaces = Dictionary(openClawAgents.map { ($0.id, ($0.avatar, $0.emoji)) }) { first, _ in first }
    }

    private static func openClawProblem(_ error: Error) -> String {
        switch (error as? OpenClaw.Failure)?.code {
        case "PAIRING_REQUIRED": return "Approve this iPhone on the gateway."
        case "unreachable", "timeout": return "Can't reach the gateway. Are you on Tailscale?"
        default:
            let message = error.localizedDescription
            return message.range(of: "token|unauthori[sz]ed", options: [.regularExpression, .caseInsensitive]) != nil
                ? "The gateway refused the setup code or token. Make a new setup code." : message
        }
    }

    private func checkVarys() async {
        guard let client = varysClient else { status[.varys] = .notConfigured; return }
        if status[.varys] != .ready { status[.varys] = .checking }
        do {
            let me = try await client.me()
            guard varysClient === client else { return }
            if me.actsAs != "client" || !Varys.scopes.allSatisfy(me.scopes.contains) {
                let host = URL(string: client.address)?.host() ?? client.address
                status[.varys] = .failed("\(host): this app code doesn't work as you with chats and approvals. Make one with the Chat client preset, and pair again.")
                return
            }
            models[.varys] = [Hermes.Model(slug: "", name: me.name.isEmpty ? "varys" : me.name, isDefault: true, reasoning: false, canDisableReasoning: false, fast: false)]
            status[.varys] = .ready
            await syncVarysRelay()
            onReady(.varys)
        } catch {
            status[.varys] = .failed(error.localizedDescription)
        }
    }

    // MARK: Connecting

    func connectHermes(url: String, key: String) async {
        Keychain.set(Self.hermesKeyName, key.trimmingCharacters(in: .whitespacesAndNewlines))
        hasHermesKey = true
        hermes.baseUrl = Hermes.normalized(url)
        hermes.enabled = true
        onChange("hermesKey")
        await check(.hermes)
        if isUsable(.hermes), !isUsable(selected) { selected = "hermes" }
    }

    func disconnectHermes() {
        Keychain.set(Self.hermesKeyName, nil)
        hasHermesKey = false
        hermes.baseUrl = ""
        status[.hermes] = .notConfigured
        models[.hermes] = []
        onChange("hermesKey")
    }

    func connectOpenClaw(code: String) async throws {
        guard let setup = OpenClaw.setupCode(code) else {
            throw Hermes.Failure(message: "That isn't a setup code. Copy what openclaw qr --setup-code-only prints.")
        }
        if let expires = setup.expires, expires < .now {
            throw Hermes.Failure(message: "That setup code has expired. Make a new one with openclaw qr --setup-code-only.")
        }
        forgetOpenClawDevice()
        Keychain.set(OpenClaw.tokenName, nil)
        Keychain.set(OpenClaw.bootstrapName, setup.bootstrapToken, thisDeviceOnly: true)
        await useOpenClaw(url: setup.url)
    }

    func connectOpenClaw(url: String, token: String) async {
        forgetOpenClawDevice()
        Keychain.set(OpenClaw.bootstrapName, nil)
        Keychain.set(OpenClaw.tokenName, token.trimmingCharacters(in: .whitespacesAndNewlines), thisDeviceOnly: true)
        await useOpenClaw(url: url)
    }

    func disconnectOpenClaw() {
        forgetOpenClawDevice()
        Keychain.set(OpenClaw.tokenName, nil)
        Keychain.set(OpenClaw.bootstrapName, nil)
        openclaw.url = ""
        status[.openclaw] = .notConfigured
    }

    private func useOpenClaw(url: String) async {
        openclaw.url = OpenClaw.normalized(url)
        openclaw.enabled = true
        await check(.openclaw)
        if isUsable(.openclaw), !isUsable(selected) { selected = "openclaw" }
    }

    private func forgetOpenClawDevice() {
        gateway?.disconnect()
        gateway = nil
        openClawPairing = nil
        openClawFullAccess = nil
        openClawFullAccessRequest = nil
        Keychain.set(OpenClaw.deviceTokenName, nil)
        Keychain.set(OpenClaw.scopesName, nil)
        keep(openClawAgents: [])
    }

    func allowOpenClawFullAccess() async {
        guard let gateway = openClawClient else { return }
        do {
            let allowed = try await gateway.allowFullAccess { self.openClawFullAccessRequest = $0 }
            openClawFullAccessRequest = nil
            if allowed { await check(.openclaw) }
        } catch {
            openClawFullAccessRequest = nil
            status[.openclaw] = .failed(Self.openClawProblem(error))
        }
    }

    func connectVarys(link: String) async throws {
        guard let target = Varys.pairingLink(link) else {
            throw Varys.Failure(code: "invalid_pairing_link", message: "That isn't a varys pairing link. Copy the whole link from Settings → Sharing & access.")
        }
        try await pairVarys(address: target.address, code: target.code, agentId: target.agentId)
    }

    func connectVarys(address: String, code: String) async throws {
        guard let origin = Varys.origin(address) else {
            throw Varys.Failure(code: "invalid_address", message: "That isn't varys's address. Give its HTTPS address alone, such as https://mac.tail.ts.net.")
        }
        try await pairVarys(address: origin, code: code.trimmingCharacters(in: .whitespacesAndNewlines), agentId: nil)
    }

    /** Pairing again (a new code) replaces the grant this iPhone had, as it pairs as the same installation. */
    private func pairVarys(address: String, code: String, agentId: String?) async throws {
        let installation = varys.installation.isEmpty ? UUID().uuidString.lowercased() : varys.installation
        let paired = try await Varys.pair(address: address, code: code, agentId: agentId, name: Self.appName, installation: installation)
        // The grant it replaces took its relay with it; the channel goes too.
        await removeVarysRelay(from: nil)
        varysConnection?.client.disconnect()
        varysConnection = nil
        Keychain.set(Varys.tokenName, paired.token, thisDeviceOnly: true)
        varys.address = paired.address
        varys.agentId = paired.agentId
        varys.installation = installation
        varys.enabled = true
        await check(.varys)
        if isUsable(.varys), !isUsable(selected) { selected = "varys" }
    }

    /** Revokes this iPhone's grant in varys (its relay goes with it), and the account's channel for it goes too. */
    func disconnectVarys() async {
        try? await varysClient?.revoke()
        await removeVarysRelay(from: nil)
        varysConnection?.client.disconnect()
        varysConnection = nil
        Keychain.set(Varys.tokenName, nil)
        varys.address = ""
        varys.agentId = ""
        status[.varys] = .notConfigured
        models[.varys] = []
    }

    /**
     * With the Otter account, this iPhone's grant names Otter's relay (an agent channel of the
     * account's), so varys tells the account's devices which thread to read; without it, nothing.
     */
    private func syncVarysRelay() async {
        guard let client = varysClient, let relay else { return }
        if relay.token != nil, varys.relayChannel.isEmpty {
            guard let channel = try? await relay.makeAgentChannel("varys · \(Self.appName)") else { return }
            do {
                try await client.setRelay(address: relay.baseURL.absoluteString, token: channel.token)
                varys.relayChannel = channel.id
            } catch {
                try? await relay.deleteAgentChannel(channel.id)
            }
        } else if relay.token == nil, !varys.relayChannel.isEmpty {
            await removeVarysRelay(from: client)
        }
    }

    private func removeVarysRelay(from client: Varys?) async {
        try? await client?.removeRelay()
        guard !varys.relayChannel.isEmpty else { return }
        try? await relay?.deleteAgentChannel(varys.relayChannel)
        varys.relayChannel = ""
    }

    /** In the background the sockets close; the agents go on, and their turns are picked up on return. */
    func suspend() {
        gateway?.disconnect()
        varysConnection?.client.disconnect()
    }

    // MARK: Results kept away

    private static let mutedKeys: [AgentKind: String] = [.hermes: "mutedJobs", .varys: "mutedRoutines"]

    /** Tasks whose results the account said to leave with the agent (the Mac's and the web's setting too). */
    func muted(_ kind: AgentKind) -> Set<String> {
        guard let key = Self.mutedKeys[kind], let list = (section[kind.rawValue] as? [String: Any])?[key] as? String else { return [] }
        return Set(list.split(separator: ",").map(String.init))
    }

    func setMuted(_ kind: AgentKind, _ id: String, _ on: Bool) {
        guard let key = Self.mutedKeys[kind] else { return }
        var ids = muted(kind)
        guard ids.contains(id) != on else { return }
        if on { ids.insert(id) } else { ids.remove(id) }
        var settings = section[kind.rawValue] as? [String: Any] ?? [:]
        settings[key] = ids.sorted().joined(separator: ",")
        section[kind.rawValue] = settings
        assistantChanged()
    }

    // MARK: Skills

    /** The agent's skills, for the composer's `/`, kept five minutes. */
    func skills(of kind: AgentKind) async -> [Skill] {
        guard kind.skills, isUsable(kind) else { return [] }
        if demo {
            return [Skill(name: "weekly-review", description: "Summarize the week and what's still open"),
                    Skill(name: "inbox-zero", description: "Triage the inbox into reply, read and archive")]
        }
        if let cached = skillsCache[kind], Date.now.timeIntervalSince(cached.at) < 300 { return cached.skills }
        let found: [Skill]? = switch kind {
        case .hermes: await hermesClient?.skills()
        case .varys:
            (try? await varysClient?.get("/turns/skills"))?.array?.compactMap { skill in
                skill["name"]?.string.map { Skill(name: $0, description: skill["description"]?.string ?? "") }
            }
        default: nil
        }
        guard let found else { return skillsCache[kind]?.skills ?? [] }
        skillsCache[kind] = (.now, found)
        return found
    }
}

nonisolated extension Hermes {
    func call(_ method: String, _ url: String, json: [String: Any]? = nil) async throws -> (Data, Int) {
        guard let url = URL(string: url) else { throw Failure(message: "That isn't a URL.") }
        var request = URLRequest(url: url, timeoutInterval: 8)
        request.httpMethod = method
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        if let json {
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }

    var origin: String { String(baseURL.dropLast(3)) }
    private var api: String { "\(origin)/api" }

    func skills() async -> [Skill]? {
        guard let (data, status) = try? await call("GET", "\(baseURL)/skills"), status == 200,
              let body = try? JSONSerialization.jsonObject(with: data) else { return nil }
        let rows = body as? [[String: Any]] ?? (body as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return rows.compactMap { row in
            guard let name = row["name"] as? String, !name.isEmpty else { return nil }
            return Skill(name: name, description: row["description"] as? String ?? "", category: row["category"] as? String)
        }
    }

    func rename(session: String, to title: String) async throws {
        let (_, status) = try await call("PATCH", "\(api)/sessions/\(session)", json: ["title": title])
        guard (200..<300).contains(status) else { throw Failure(message: "Hermes answered \(status).") }
    }

    /** Hermes's own name for the session. */
    func title(of session: String) async -> String? {
        guard let (data, status) = try? await call("GET", "\(api)/sessions/\(session)"), status == 200 else { return nil }
        let title = ((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["session"] as? [String: Any])?["title"] as? String
        return title?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
    }
}

nonisolated extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
