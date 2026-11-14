import Foundation
import Network
import Observation

/**
 * The agents you added and how this iPhone reaches each. Which agents, their names, pictures,
 * settings and keys are the Otter account's (`AgentSync`, as the Mac and the web keep them); what
 * pairs this iPhone alone (varys's grant, an OpenClaw device key) stays here. Every connected
 * agent is ready at once: a chat runs on the one it started with, named by its id.
 */
@Observable
final class Agents {
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

    /** In the order they were added; those only a Mac runs (Claude, Codex) too, kept as the account has them. */
    private(set) var all: [Agent] = []
    /** The agent a new chat starts on. */
    private(set) var selected: String?
    /** What a message sent while the agent runs does: waits its turn, or joins the run. */
    var followUp: FollowUp { didSet { if followUp != oldValue { uiChanged() } } }
    /** Starred models, as `<agent id>:<slug>`. */
    var favorites: [String] { didSet { if favorites != oldValue { uiChanged() } } }
    /** The demo's pretend agents stand in for yours. */
    private(set) var demo = false

    @ObservationIgnored var relay: Relay?
    /** Where the agents are read and written: the account's copy, the demo's, or none (in memory). */
    @ObservationIgnored private(set) var sync = AgentSync()
    /** The `ui` keys changed: what to write to the account. */
    @ObservationIgnored var onChange: () -> Void = {}
    /** An agent was just reached: turns it was left with are picked up, and what it wrote meanwhile read. */
    @ObservationIgnored var onReady: (Agent) -> Void = { _ in }
    @ObservationIgnored private var applying = false
    @ObservationIgnored private let network = NWPathMonitor()

    private static let followUpKey = "assistant:follow-up-behavior"
    private static let favoritesKey = "assistant:favorite-models"
    private static let appName = "Otter Agents on iPhone"

    init() {
        let defaults = UserDefaults.standard
        followUp = defaults.string(forKey: Self.followUpKey).flatMap(FollowUp.init) ?? .queue
        favorites = Self.strings(defaults.string(forKey: Self.favoritesKey))
        // A new network (Wi-Fi to cellular, the VPN coming up) can leave a gateway's socket open and dead.
        network.pathUpdateHandler = { [weak self] _ in
            Task { @MainActor in await self?.probe() }
        }
        network.start(queue: .main)
    }

    private static func strings(_ json: String?) -> [String] {
        (try? JSONDecoder().decode([String].self, from: Data((json ?? "[]").utf8))) ?? []
    }

    // MARK: Which agents

    /** The agents this iPhone runs. */
    var runnable: [Agent] { all.filter { $0.kind != nil } }
    /** The agents a chat can start on now. */
    var usable: [Agent] { runnable.filter(\.isUsable) }

    func agent(_ id: String?) -> Agent? { all.first { $0.id == id } }

    func isUsable(_ id: String) -> Bool { agent(id)?.isUsable ?? false }

    func isUsable(_ chat: Chat) -> Bool {
        guard let agent = agent(chat.provider), agent.isUsable else { return false }
        guard agent.kind == .openclaw else { return true }
        return chat.openClawAgent.map(agent.isGatewayAgentEnabled) ?? agent.canStartChat
    }

    /** Where a new chat starts: the chosen agent while it works here, else the first that does. */
    var starting: Agent? {
        let chosen = agent(selected).flatMap { $0.kind == nil ? nil : $0 }
        if let chosen, chosen.isUsable, chosen.canStartChat { return chosen }
        return usable.first(where: \.canStartChat) ?? chosen ?? runnable.first
    }

    /** A new agent of this kind, named for it ("Hermes 2" when that's taken): its page connects it. */
    func add(_ kind: AgentKind) -> Agent {
        let names = Set(all.map(\.name))
        let name = names.contains(kind.name) ? (2...).lazy.map { "\(kind.name) \($0)" }.first { !names.contains($0) }! : kind.name
        let id = UUID().uuidString.lowercased()
        let addedAt = Int(sync.copy.entries("agent/").compactMap { $0.value["addedAt"]?.number }.max() ?? 0) + 1
        mutate([AgentMutation.setAgent(id, kind: kind.rawValue, name: name, settings: [:], addedAt: addedAt)]
            + (selected == nil ? [AgentMutation.select(id)] : []))
        return agent(id)!
    }

    /** It goes from every device, with its secrets; its chats stay, with no agent to run on. */
    func remove(_ agent: Agent) {
        mutate([AgentMutation.removeAgent(agent.id)])
    }

    func select(_ agent: Agent) {
        guard selected != agent.id else { return }
        mutate([AgentMutation.select(agent.id)])
    }

    func rename(_ agent: Agent, to name: String) {
        let name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(AgentEntry.maxName))
        guard !name.isEmpty, name != agent.name else { return }
        mutate([AgentMutation.setAgent(agent.id, kind: agent.entry.kind, name: name)])
    }

    func setAvatar(_ agent: Agent, _ picture: String?) {
        guard picture.map(AgentEntry.isPicture) != false, picture != agent.avatar else { return }
        mutate([AgentMutation.setAgent(agent.id, kind: agent.entry.kind, avatar: picture.map(JSON.string) ?? .null)])
    }

    /** Changes one of its settings: the account's, or this iPhone's own (`AgentKind.deviceFields`). */
    func set(_ agent: Agent, _ key: String, _ value: JSON) {
        guard agent.entry.settings[key] != value else { return }
        mutate([agent.kind?.deviceFields.contains(key) == true
            ? AgentMutation.device(agent.id, device: sync.device, settings: [key: value])
            : AgentMutation.setAgent(agent.id, kind: agent.entry.kind, settings: [key: value])])
    }

    /** Keeps one of its secrets: the account's, or in this iPhone's Keychain alone (`AgentKind.deviceSecrets`). */
    func setSecret(_ agent: Agent, _ name: String, _ value: String?) {
        let value = value?.nilIfEmpty
        let own = agent.kind?.deviceSecrets.contains(name) == true
        if own || (value == nil && (sync.copy.get(AgentEntries.secretKey(agent.id, name)) ?? .null) == .null) {
            agent.setSecret(name, value, thisDeviceOnly: own)
        } else {
            mutate([AgentMutation.secret(agent.id, name, value)])
        }
    }

    func setEnabled(_ agent: Agent, _ enabled: Bool) {
        set(agent, "enabled", .bool(enabled))
        if !enabled { agent.close() }
        Task { await check(agent) }
    }

    func setGatewayAgentEnabled(_ agent: Agent, _ id: String, _ enabled: Bool) {
        var disabled = Set(agent.entry.settings["disabledAgents"]?.array?.compactMap(\.string) ?? [])
        if enabled { disabled.remove(id) } else { disabled.insert(id) }
        set(agent, "disabledAgents", .array(disabled.sorted().map(JSON.string)))
        if enabled, agent.isUsable { onReady(agent) }
    }

    private func mutate(_ mutations: [JSON]) {
        sync.mutate(mutations)
        show()
    }

    /** Its secrets go, and, for varys, its grant there and the account's channel for it. */
    private func forget(_ agent: Agent) {
        let varys = agent.kind == .varys ? agent.varys : nil
        let channel = agent.string("relayChannel")
        agent.forgetSecrets()
        agent.close()
        Task {
            try? await varys?.revoke()
            if !channel.isEmpty { try? await relay?.deleteAgentChannel(channel) }
        }
    }

    /**
     * The agents as the copy has them: those already here keep their connections, unless they're
     * turned off; those removed (here or on another device) are forgotten.
     */
    private func show() {
        let device = sync.device
        let entries = sync.copy.entries("agent/").compactMap { record in
            AgentEntry(record.value, device: sync.copy.get(AgentEntries.agentDeviceKey(record.value["id"]?.string ?? "", device)))
        }.sorted { ($0.addedAt, $0.id) < ($1.addedAt, $1.id) }
        for agent in all where sync.copy.get(AgentEntries.agentKey(agent.id)) == .null { forget(agent) }
        all = entries.map { entry in
            guard let agent = agent(entry.id) else { return Agent(entry) }
            if agent.entry != entry { agent.entry = entry }
            if !agent.enabled { agent.close() }
            return agent
        }
        let chosen = sync.copy.get(AgentEntries.selectedKey)?.string
        if selected != chosen { selected = chosen }
    }

    /** Another device changed these (by key): the agents follow, and those changed are checked again. */
    func heard(_ keys: Set<String>) {
        let ids = Set(keys.compactMap { key -> String? in
            let parts = AgentEntries.segments(key)
            return ["agent", "agent-device", "secret"].contains(parts[0]) && parts.count > 1 ? parts[1] : nil
        })
        guard !ids.isEmpty || keys.contains(AgentEntries.selectedKey) else { return }
        show()
        for agent in runnable where ids.contains(agent.id) { Task { await check(agent) } }
    }

    /** Signed in, signed out, or the demo: the agents are another copy's. */
    func use(_ sync: AgentSync) {
        for agent in all { agent.close() }
        all = []
        self.sync = sync
        show()
    }

    var uiSection: [String: String] {
        [Self.followUpKey: followUp.rawValue,
         Self.favoritesKey: String(decoding: (try? JSONEncoder().encode(favorites)) ?? Data("[]".utf8), as: UTF8.self)]
    }

    private func uiChanged() {
        for (key, value) in uiSection { UserDefaults.standard.set(value, forKey: key) }
        if !applying { onChange() }
    }

    /** The account's `ui` keys for agents. */
    func apply(ui: [String: Any]) {
        applying = true
        if let value = (ui[Self.followUpKey] as? String).flatMap(FollowUp.init) { followUp = value }
        if let value = ui[Self.favoritesKey] as? String { favorites = Self.strings(value) }
        applying = false
    }

    // MARK: The demo

    /** The demo's agents, in a copy of their own: changed as yours are, never sent. */
    func startDemo() {
        demo = true
        let agents = DemoAgent.agents()
        let sync = AgentSync()
        sync.mutate(agents.enumerated().map { index, agent in
            AgentMutation.setAgent(agent.id, kind: agent.entry.kind, name: agent.name, avatar: agent.avatar.map(JSON.string),
                                   settings: agent.entry.settings, addedAt: index + 1)
        } + [AgentMutation.select(agents.first?.id)])
        self.sync = sync
        all = agents
        show()
    }

    func endDemo() {
        demo = false
        use(AgentSync())
    }

    // MARK: Models

    func isFavorite(_ agent: Agent, _ model: Hermes.Model) -> Bool { favorites.contains("\(agent.id):\(model.slug)") }

    func toggleFavorite(_ agent: Agent, _ model: Hermes.Model) {
        let key = "\(agent.id):\(model.slug)"
        if let at = favorites.firstIndex(of: key) { favorites.remove(at: at) } else { favorites.append(key) }
    }

    static func efforts(_ model: Hermes.Model) -> [(id: String, label: String)] {
        [("", "Default")] + (model.canDisableReasoning ? [("none", "Off")] : [])
            + [("minimal", "Minimal"), ("low", "Low"), ("medium", "Medium"), ("high", "High"), ("xhigh", "Extra High")]
    }

    /** The OpenClaw gateway's agent a chat runs on: its session's, or for one not started, the one chosen. */
    func gatewayAgent(of chat: Chat) -> String? {
        guard let agent = agent(chat.provider), agent.kind == .openclaw else { return nil }
        return chat.openClawAgent ?? agent.model?.slug
    }

    /** Who runs a chat, by name: the gateway's agent it runs on, else the agent. */
    func name(of chat: Chat) -> String {
        let agent = agent(chat.provider)
        if let slug = gatewayAgent(of: chat), let name = agent?.models.first(where: { $0.slug == slug })?.name { return name }
        return agent?.name ?? "Agent"
    }

    func name(of id: String) -> String { agent(id)?.name ?? "Agent" }

    func setMuted(_ agent: Agent, _ id: String, _ on: Bool) {
        guard let key = agent.mutedKey else { return }
        var ids = agent.muted
        guard ids.contains(id) != on else { return }
        if on { ids.insert(id) } else { ids.remove(id) }
        set(agent, key, .string(ids.sorted().joined(separator: ",")))
    }

    // MARK: Checking them

    func checkAll() async {
        guard !demo else { return }
        await withTaskGroup(of: Void.self) { group in
            for agent in runnable { group.addTask { await self.check(agent) } }
        }
    }

    func check(_ agent: Agent) async {
        guard !demo else { return }
        switch agent.kind {
        case .hermes: await checkHermes(agent)
        case .openclaw: await checkOpenClaw(agent)
        case .varys: await checkVarys(agent)
        case nil: break
        }
    }

    private func checkHermes(_ agent: Agent) async {
        guard let client = agent.hermes else { agent.status = .notConfigured; return }
        if agent.status != .ready { agent.status = .checking }
        do {
            let (models, _) = try await client.check()
            agent.models = models
            agent.status = .ready
            onReady(agent)
        } catch {
            agent.status = .failed("Can't reach \(agent.name): \(error.localizedDescription)")
        }
    }

    private func checkOpenClaw(_ agent: Agent) async {
        guard let gateway = agent.openClaw, gateway.hasCredentials else {
            agent.status = .notConfigured
            agent.models = []
            return
        }
        if agent.status != .ready { agent.status = .checking }
        do {
            agent.keep(gatewayAgents: try await gateway.agents())
            agent.talks = await OpenClawCall.available(on: gateway)
            agent.pairing = nil
            agent.fullAccess = gateway.fullAccess
            agent.status = .ready
            onReady(agent)
        } catch {
            agent.pairing = gateway.pairingRequest
            agent.status = .failed(Self.openClawProblem(error))
        }
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

    private func checkVarys(_ agent: Agent) async {
        guard let client = agent.varys else { agent.status = .notConfigured; return }
        if agent.status != .ready { agent.status = .checking }
        do {
            let me = try await client.me()
            guard agent.varys === client else { return }
            if me.actsAs != "client" || !Varys.scopes.allSatisfy(me.scopes.contains) {
                let host = URL(string: client.address)?.host() ?? client.address
                agent.status = .failed("\(host): this app code doesn't work as you with chats and approvals. Make one with the Chat client preset, and pair again.")
                return
            }
            agent.models = [Hermes.Model(slug: "", name: me.name.isEmpty ? agent.name : me.name, isDefault: true, reasoning: false, canDisableReasoning: false, fast: false)]
            agent.status = .ready
            await syncVarysRelay(agent)
            onReady(agent)
        } catch {
            agent.status = .failed(error.localizedDescription)
        }
    }

    // MARK: Connecting

    /** Once it answers, it's where new chats start, unless the chosen agent works here. */
    private func connected(_ agent: Agent) async {
        set(agent, "enabled", .bool(true))
        await check(agent)
        if agent.isUsable, !isUsable(selected ?? "") { select(agent) }
    }

    /** Checked before it's kept: a server or key that doesn't answer leaves the agent as it was. */
    func connectHermes(_ agent: Agent, url: String, key: String) async throws {
        let base = Hermes.normalized(url), key = key.trimmingCharacters(in: .whitespacesAndNewlines)
        _ = try await Hermes(baseURL: base, key: key).check()
        setSecret(agent, "key", key)
        set(agent, "baseUrl", .string(base))
        await connected(agent)
    }

    func connectOpenClaw(_ agent: Agent, code: String) async throws {
        guard let setup = OpenClaw.setupCode(code) else {
            throw Hermes.Failure(message: "That isn't a setup code. Copy what openclaw qr --setup-code-only prints.")
        }
        if let expires = setup.expires, expires < .now {
            throw Hermes.Failure(message: "That setup code has expired. Make a new one with openclaw qr --setup-code-only.")
        }
        forgetOpenClawDevice(agent)
        setSecret(agent, OpenClaw.tokenName, nil)
        setSecret(agent, OpenClaw.bootstrapName, setup.bootstrapToken)
        await useOpenClaw(agent, url: setup.url)
    }

    func connectOpenClaw(_ agent: Agent, url: String, token: String) async {
        forgetOpenClawDevice(agent)
        setSecret(agent, OpenClaw.bootstrapName, nil)
        setSecret(agent, OpenClaw.tokenName, token.trimmingCharacters(in: .whitespacesAndNewlines))
        await useOpenClaw(agent, url: url)
    }

    func disconnectOpenClaw(_ agent: Agent) {
        forgetOpenClawDevice(agent)
        setSecret(agent, OpenClaw.tokenName, nil)
        setSecret(agent, OpenClaw.bootstrapName, nil)
        set(agent, "url", .string(""))
        agent.status = .notConfigured
    }

    private func useOpenClaw(_ agent: Agent, url: String) async {
        set(agent, "url", .string(OpenClaw.normalized(url)))
        await connected(agent)
    }

    private func forgetOpenClawDevice(_ agent: Agent) {
        agent.close()
        agent.pairing = nil
        agent.fullAccess = nil
        agent.fullAccessRequest = nil
        setSecret(agent, OpenClaw.deviceTokenName, nil)
        setSecret(agent, OpenClaw.scopesName, nil)
        agent.keep(gatewayAgents: [])
    }

    func allowFullAccess(_ agent: Agent) async {
        guard let gateway = agent.openClaw else { return }
        do {
            let allowed = try await gateway.allowFullAccess { agent.fullAccessRequest = $0 }
            agent.fullAccessRequest = nil
            if allowed { await check(agent) }
        } catch {
            agent.fullAccessRequest = nil
            agent.status = .failed(Self.openClawProblem(error))
        }
    }

    func connectVarys(_ agent: Agent, link: String) async throws {
        guard let target = Varys.pairingLink(link) else {
            throw Varys.Failure(code: "invalid_pairing_link", message: "That isn't a varys pairing link. Copy the whole link from Settings → Sharing & access.")
        }
        try await pairVarys(agent, address: target.address, code: target.code, agentId: target.agentId)
    }

    func connectVarys(_ agent: Agent, address: String, code: String) async throws {
        guard let origin = Varys.origin(address) else {
            throw Varys.Failure(code: "invalid_address", message: "That isn't varys's address. Give its HTTPS address alone, such as https://mac.tail.ts.net.")
        }
        try await pairVarys(agent, address: origin, code: code.trimmingCharacters(in: .whitespacesAndNewlines), agentId: nil)
    }

    /** Pairing again (a new code) replaces the grant this iPhone had, as it pairs as the same installation. */
    private func pairVarys(_ agent: Agent, address: String, code: String, agentId: String?) async throws {
        let installation = agent.string("installation").nilIfEmpty ?? UUID().uuidString.lowercased()
        let paired = try await Varys.pair(address: address, code: code, agentId: agentId, name: Self.appName, installation: installation)
        // The grant it replaces took its relay with it; the channel goes too.
        await removeVarysRelay(agent, from: nil)
        agent.close()
        setSecret(agent, Varys.tokenName, paired.token)
        set(agent, "address", .string(paired.address))
        set(agent, "agentId", .string(paired.agentId))
        set(agent, "installation", .string(installation))
        await connected(agent)
    }

    /** Revokes this iPhone's grant in varys (its relay goes with it), and the account's channel for it goes too. */
    func disconnectVarys(_ agent: Agent) async {
        try? await agent.varys?.revoke()
        await removeVarysRelay(agent, from: nil)
        agent.close()
        setSecret(agent, Varys.tokenName, nil)
        set(agent, "address", .string(""))
        set(agent, "agentId", .string(""))
        agent.status = .notConfigured
        agent.models = []
    }

    /**
     * With the Otter account, this iPhone's grant names Otter's relay (an agent channel of the
     * account's), so varys tells the account's devices which thread to read; without it, nothing.
     */
    private func syncVarysRelay(_ agent: Agent) async {
        guard let client = agent.varys, let relay else { return }
        if relay.token != nil, agent.string("relayChannel").isEmpty {
            guard let channel = try? await relay.makeAgentChannel("\(agent.name) · \(Self.appName)") else { return }
            do {
                try await client.setRelay(address: relay.baseURL.absoluteString, token: channel.token)
                set(agent, "relayChannel", .string(channel.id))
            } catch {
                try? await relay.deleteAgentChannel(channel.id)
            }
        } else if relay.token == nil, !agent.string("relayChannel").isEmpty {
            await removeVarysRelay(agent, from: client)
        }
    }

    private func removeVarysRelay(_ agent: Agent, from client: Varys?) async {
        try? await client?.removeRelay()
        let channel = agent.string("relayChannel")
        guard !channel.isEmpty else { return }
        try? await relay?.deleteAgentChannel(channel)
        set(agent, "relayChannel", .string(""))
    }

    /** In the background the sockets close; the agents go on, and their turns are picked up on return. */
    func suspend() {
        for agent in all { agent.suspend() }
    }

    /** Each gateway's socket, if there is one, is asked whether it's still there. */
    func probe() async {
        for agent in usable where agent.kind == .openclaw { await agent.openClaw?.probe() }
    }

    /** Back in front: the gateways' sockets open now, so what's sent next doesn't wait for them. */
    func reconnect() {
        guard !demo else { return }
        for agent in usable where agent.kind == .openclaw {
            guard let gateway = agent.openClaw else { continue }
            Task { try? await gateway.connected() }
        }
    }

    // MARK: Skills

    /** The agent's skills, for the composer's `/`, kept five minutes. */
    func skills(of agent: Agent) async -> [Skill] {
        guard agent.kind?.skills == true, agent.isUsable else { return [] }
        if demo {
            return [Skill(name: "weekly-review", description: "Summarize the week and what's still open"),
                    Skill(name: "inbox-zero", description: "Triage the inbox into reply, read and archive")]
        }
        if let cached = agent.skills, Date.now.timeIntervalSince(cached.at) < 300 { return cached.skills }
        let found: [Skill]? = switch agent.kind {
        case .hermes: await agent.hermes?.skills()
        case .varys:
            (try? await agent.varys?.get("/turns/skills"))?.array?.compactMap { skill in
                skill["name"]?.string.map { Skill(name: $0, description: skill["description"]?.string ?? "") }
            }
        default: nil
        }
        guard let found else { return agent.skills?.skills ?? [] }
        agent.skills = (.now, found)
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

}

nonisolated extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
