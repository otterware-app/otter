import Foundation
import Network
import Observation

/**
 * The agents you added and how this iPhone reaches each. Which agents, their names, pictures and
 * settings follow the Otter account (its `assistant` section, which the Mac and the web keep
 * too); OpenClaw and varys pair with this iPhone as a device of their own, kept here. Every
 * connected agent is ready at once: a chat runs on the one it started with, named by its id.
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

    /** As you ordered them; those only a Mac runs (Claude, Codex) too, kept as the account has them. */
    private(set) var all: [Agent] = []
    /** Agents removed anywhere, by id, kept for good so no device brings one back. */
    private(set) var removed: [String] = []
    /** The agent a new chat starts on. */
    private(set) var selected: String?
    /** What a message sent while the agent runs does: waits its turn, or joins the run. */
    var followUp: FollowUp { didSet { if followUp != oldValue { uiChanged() } } }
    /** Starred models, as `<agent id>:<slug>`. */
    var favorites: [String] { didSet { if favorites != oldValue { uiChanged() } } }
    /** The demo's pretend agents stand in for yours. */
    private(set) var demo = false

    @ObservationIgnored var relay: Relay?
    /** `assistant`, `agentKeys` or `ui`: what to write to the account. */
    @ObservationIgnored var onChange: (String) -> Void = { _ in }
    /** An agent was just reached: turns it was left with are picked up, and what it wrote meanwhile read. */
    @ObservationIgnored var onReady: (Agent) -> Void = { _ in }
    @ObservationIgnored private var applying = false
    @ObservationIgnored private let network = NWPathMonitor()

    private static let listKey = "agents"
    private static let followUpKey = "assistant:follow-up-behavior"
    private static let favoritesKey = "assistant:favorite-models"
    private static let appName = "Otter Agents on iPhone"

    init() {
        let defaults = UserDefaults.standard
        followUp = defaults.string(forKey: Self.followUpKey).flatMap(FollowUp.init) ?? .queue
        favorites = Self.strings(defaults.string(forKey: Self.favoritesKey))
        show(Self.saved)
        // A new network (Wi-Fi to cellular, the VPN coming up) can leave a gateway's socket open and dead.
        network.pathUpdateHandler = { [weak self] _ in
            Task { @MainActor in await self?.probe() }
        }
        network.start(queue: .main)
    }

    private static var saved: AgentList {
        AgentList(try? JSON(parsing: UserDefaults.standard.data(forKey: listKey) ?? Data())) ?? AgentList()
    }

    private static func strings(_ json: String?) -> [String] {
        (try? JSONDecoder().decode([String].self, from: Data((json ?? "[]").utf8))) ?? []
    }

    // MARK: Which agents

    var list: AgentList { AgentList(selected: selected, agents: all.map(\.entry), removed: removed) }

    /** The agents this iPhone runs. */
    var runnable: [Agent] { all.filter { $0.kind != nil } }
    /** The agents a chat can start on now. */
    var usable: [Agent] { runnable.filter(\.isUsable) }

    func agent(_ id: String?) -> Agent? { all.first { $0.id == id } }

    func isUsable(_ id: String) -> Bool { agent(id)?.isUsable ?? false }

    /** Where a new chat starts: the chosen agent while it works here, else the first that does. */
    var starting: Agent? {
        let chosen = agent(selected).flatMap { $0.kind == nil ? nil : $0 }
        if let chosen, chosen.isUsable { return chosen }
        return usable.first ?? chosen ?? runnable.first
    }

    /** A new agent of this kind, named for it ("Hermes 2" when that's taken): its page connects it. */
    func add(_ kind: AgentKind) -> Agent {
        let names = Set(all.map(\.name))
        let name = names.contains(kind.name) ? (2...).lazy.map { "\(kind.name) \($0)" }.first { !names.contains($0) }! : kind.name
        let agent = Agent(AgentList.Entry(id: UUID().uuidString.lowercased(), kind: kind.rawValue, name: name))
        all.append(agent)
        if selected == nil { selected = agent.id }
        saved()
        return agent
    }

    /** It goes from every device, with its secrets here; its chats stay, with no agent to run on. */
    func remove(_ agent: Agent) {
        forget(agent)
        all.removeAll { $0.id == agent.id }
        if !removed.contains(agent.id) { removed.append(agent.id) }
        if selected == agent.id { selected = nil }
        saved()
        if agent.kind == .hermes { onChange("agentKeys") }
    }

    func select(_ agent: Agent) {
        guard selected != agent.id else { return }
        selected = agent.id
        saved()
    }

    func rename(_ agent: Agent, to name: String) {
        let name = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(AgentList.Entry.maxName))
        guard !name.isEmpty, name != agent.name else { return }
        agent.entry.name = name
        saved()
    }

    func setAvatar(_ agent: Agent, _ picture: String?) {
        guard picture.map(AgentList.Entry.isPicture) != false, picture != agent.avatar else { return }
        agent.entry.avatar = picture
        saved()
    }

    /** Changes one of its settings; what follows the account goes to it. */
    func set(_ agent: Agent, _ key: String, _ value: JSON) {
        guard agent.entry.settings[key] != value else { return }
        agent.entry.settings[key] = value
        saved(push: agent.kind?.isDeviceField(key) != true)
    }

    func setEnabled(_ agent: Agent, _ enabled: Bool) {
        set(agent, "enabled", .bool(enabled))
        if !enabled { agent.close() }
        Task { await check(agent) }
    }

    private func saved(push: Bool = true) {
        guard !demo else { return }
        UserDefaults.standard.set(list.json.data, forKey: Self.listKey)
        if push, !applying { onChange("assistant") }
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

    /** The list as it is: the agents already here keep their connections, unless they're turned off. */
    private func show(_ list: AgentList) {
        all = list.agents.map { entry in
            guard let agent = agent(entry.id) else { return Agent(entry) }
            agent.entry = entry
            if !agent.enabled { agent.close() }
            return agent
        }
        removed = list.removed
        selected = list.selected
    }

    // MARK: The account's settings

    /** The section as this iPhone writes it. */
    var syncedSection: [String: Any] { list.synced.json.anyObject }

    /** The keys that follow the account (Hermes's), by agent: those this iPhone holds. */
    var agentKeys: [String: String] {
        Dictionary(uniqueKeysWithValues: runnable.compactMap { agent in
            agent.kind == .hermes ? agent.secret("key").map { (agent.id, $0) } : nil
        })
    }

    var uiSection: [String: String] {
        [Self.followUpKey: followUp.rawValue,
         Self.favoritesKey: String(decoding: (try? JSONEncoder().encode(favorites)) ?? Data("[]".utf8), as: UTF8.self)]
    }

    private func uiChanged() {
        for (key, value) in uiSection { UserDefaults.standard.set(value, forKey: key) }
        if !applying { onChange("ui") }
    }

    /**
     * What the account says, laid over this iPhone's (`AgentList.merged`): agents removed elsewhere
     * are forgotten here, and what this iPhone has that the account hasn't goes to it.
     */
    func apply(assistant remote: JSON?, ui: [String: Any], agentKeys keys: [String: String]?) {
        applying = true
        let account = AgentList(remote)
        let merged = list.merged(with: account ?? AgentList())
        for agent in all where merged.removed.contains(agent.id) { forget(agent) }
        show(merged)
        saved(push: false)
        if let value = (ui[Self.followUpKey] as? String).flatMap(FollowUp.init) { followUp = value }
        if let value = ui[Self.favoritesKey] as? String { favorites = Self.strings(value) }
        for agent in runnable where agent.kind == .hermes {
            guard let key = keys?[agent.id], !key.isEmpty, key != agent.secret("key") else { continue }
            agent.setSecret("key", key)
        }
        applying = false
        if merged.synced != account { onChange("assistant") }
        if agentKeys != keys ?? [:] { onChange("agentKeys") }
        Task { await checkAll() }
    }

    /** Signed out: what followed the account goes, what was paired here (OpenClaw, varys) stays. */
    func forgetAccount() {
        applying = true
        defer { applying = false }
        for agent in all where agent.kind != .openclaw && agent.kind != .varys {
            agent.forgetSecrets()
            agent.close()
        }
        let kept = all.filter { $0.kind == .openclaw || $0.kind == .varys }.map(\.entry)
        show(AgentList(selected: kept.contains { $0.id == selected } ? selected : nil, agents: kept))
        saved(push: false)
    }

    // MARK: The demo

    func startDemo() {
        demo = true
        all = DemoAgent.agents()
        removed = []
        selected = all.first?.id
    }

    func endDemo() {
        demo = false
        all = []
        show(Self.saved)
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
            let (models, sessions) = try await client.check()
            agent.models = models
            if agent.entry.settings["sessions"]?.bool != sessions {
                agent.entry.settings["sessions"] = .bool(sessions)
                saved(push: false)
            }
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

    func connectHermes(_ agent: Agent, url: String, key: String) async {
        agent.setSecret("key", key.trimmingCharacters(in: .whitespacesAndNewlines))
        set(agent, "baseUrl", .string(Hermes.normalized(url)))
        onChange("agentKeys")
        await connected(agent)
    }

    func disconnectHermes(_ agent: Agent) {
        agent.setSecret("key", nil)
        set(agent, "baseUrl", .string(""))
        agent.status = .notConfigured
        agent.models = []
        onChange("agentKeys")
    }

    func connectOpenClaw(_ agent: Agent, code: String) async throws {
        guard let setup = OpenClaw.setupCode(code) else {
            throw Hermes.Failure(message: "That isn't a setup code. Copy what openclaw qr --setup-code-only prints.")
        }
        if let expires = setup.expires, expires < .now {
            throw Hermes.Failure(message: "That setup code has expired. Make a new one with openclaw qr --setup-code-only.")
        }
        forgetOpenClawDevice(agent)
        agent.setSecret(OpenClaw.tokenName, nil)
        agent.setSecret(OpenClaw.bootstrapName, setup.bootstrapToken, thisDeviceOnly: true)
        await useOpenClaw(agent, url: setup.url)
    }

    func connectOpenClaw(_ agent: Agent, url: String, token: String) async {
        forgetOpenClawDevice(agent)
        agent.setSecret(OpenClaw.bootstrapName, nil)
        agent.setSecret(OpenClaw.tokenName, token.trimmingCharacters(in: .whitespacesAndNewlines), thisDeviceOnly: true)
        await useOpenClaw(agent, url: url)
    }

    func disconnectOpenClaw(_ agent: Agent) {
        forgetOpenClawDevice(agent)
        agent.setSecret(OpenClaw.tokenName, nil)
        agent.setSecret(OpenClaw.bootstrapName, nil)
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
        agent.setSecret(OpenClaw.deviceTokenName, nil)
        agent.setSecret(OpenClaw.scopesName, nil)
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
        agent.setSecret(Varys.tokenName, paired.token, thisDeviceOnly: true)
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
        agent.setSecret(Varys.tokenName, nil)
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
