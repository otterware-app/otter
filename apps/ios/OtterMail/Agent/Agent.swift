import Foundation
import Observation

@Observable
final class Agent {
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

    struct OpenRouterSettings: Codable, Equatable {
        var enabled = true
        var model = ""
        var runtimeMode = "approval-required"

        init() {}
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
            model = try c.decodeIfPresent(String.self, forKey: .model) ?? ""
            runtimeMode = try c.decodeIfPresent(String.self, forKey: .runtimeMode) ?? "approval-required"
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
        /** Otter Mail on this iPhone, the same each time it pairs: pairing again replaces its grant. */
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

    struct Tool: Identifiable {
        let id = UUID()
        var name: String
        var output: String?
    }

    /** An agent asking before it does something: Hermes running a command, varys using a tool. */
    struct Approval: Equatable {
        var id: String
        var question: String
        var detail: String?
        var isCommand = false
        var reason: String?
        var choices: [String]
    }

    struct Turn: Identifiable {
        enum Role { case user, agent }
        let id = UUID()
        var role: Role
        var text: String
        var tools: [Tool] = []
        var context: [String] = []
        var approval: Approval?
        var question: OpenClaw.Question?
        var error: String?
        var note: String?
    }

    var hermes: HermesSettings { didSet { settingsChanged() } }
    var openrouter: OpenRouterSettings { didSet { settingsChanged() } }
    var openclaw: OpenClawSettings {
        didSet {
            UserDefaults.standard.set(try? JSONEncoder().encode(openclaw), forKey: Self.openClawKey)
            if !isOn && running { stop() }
        }
    }
    var varys: VarysSettings {
        didSet {
            UserDefaults.standard.set(try? JSONEncoder().encode(varys), forKey: Self.varysKey)
            if !isOn && running { stop() }
        }
    }
    var selected: String {
        didSet {
            guard oldValue != selected else { return }
            newChat()
            models = []
            history = []
            if !applying { section["selected"] = selected }
            settingsChanged()
            Task { await check() }
        }
    }
    private(set) var hasKey: Bool
    private(set) var hasOpenRouterKey = false
    @ObservationIgnored var relay: Relay?
    @ObservationIgnored var mailStore: () -> MailStore? = { nil }
    @ObservationIgnored var onChange: (String) -> Void = { _ in }
    /** The account's whole `assistant` section, kept so writes don't drop the Mac's Codex and Claude settings. */
    @ObservationIgnored private var section: [String: Any]
    @ObservationIgnored private var applying = false

    // Keep the old storage key so existing synced settings remain readable.
    private static let settingsKey = "assistant"
    private static let keychainKey = "hermes-key"
    private static let openClawKey = "openclaw"
    private static let openRunKey = "openclaw-run"
    private static let varysKey = "varys"
    private static let varysRunKey = "varys-run"
    private static let providers = ["openrouter", "hermes", "openclaw", "varys"]

    init() {
        let data = UserDefaults.standard.data(forKey: Self.settingsKey) ?? Data()
        let savedSection = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        section = savedSection
        let hermesSettings = Self.decode(savedSection["hermes"]) ?? HermesSettings()
        hermes = hermesSettings
        openrouter = Self.decode(savedSection["openrouter"]) ?? OpenRouterSettings()
        openclaw = UserDefaults.standard.data(forKey: Self.openClawKey)
            .flatMap { try? JSONDecoder().decode(OpenClawSettings.self, from: $0) } ?? OpenClawSettings()
        varys = UserDefaults.standard.data(forKey: Self.varysKey)
            .flatMap { try? JSONDecoder().decode(VarysSettings.self, from: $0) } ?? VarysSettings()
        let saved = savedSection["selected"] as? String ?? ""
        selected = Self.providers.contains(saved) ? saved : (hermesSettings.baseUrl.isEmpty ? "openrouter" : "hermes")
        hasKey = Keychain.get(Self.keychainKey) != nil
        openRun = UserDefaults.standard.data(forKey: Self.openRunKey).flatMap { try? JSONDecoder().decode(OpenRun.self, from: $0) }
        varysRun = UserDefaults.standard.data(forKey: Self.varysRunKey).flatMap { try? JSONDecoder().decode(OpenRun.self, from: $0) }
    }

    private static func decode<T: Decodable>(_ value: Any?) -> T? {
        guard let value, let data = try? JSONSerialization.data(withJSONObject: value) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }

    /** The section as this device would write it. */
    var syncedSection: [String: Any] {
        var section = section
        let own = ((try? JSONSerialization.jsonObject(with: JSONEncoder().encode(hermes))) as? [String: Any]) ?? [:]
        section["hermes"] = ((section["hermes"] as? [String: Any]) ?? [:]).merging(own) { _, mine in mine }
        let router = ((try? JSONSerialization.jsonObject(with: JSONEncoder().encode(openrouter))) as? [String: Any]) ?? [:]
        section["openrouter"] = ((section["openrouter"] as? [String: Any]) ?? [:]).merging(router) { _, mine in mine }
        if Self.providers.contains(section["selected"] as? String ?? "") || section["selected"] == nil {
            section["selected"] = selected
        }
        return section
    }

    private func settingsChanged() {
        section = syncedSection
        UserDefaults.standard.set(try? JSONSerialization.data(withJSONObject: section), forKey: Self.settingsKey)
        if !applying { onChange("assistant") }
        if !isOn && running { stop() }
    }

    func apply(section remote: [String: Any]?, key: String?) {
        applying = true
        defer { applying = false }
        if let remote {
            section = remote
            let next = Self.decode(remote["hermes"]) ?? HermesSettings()
            if next != hermes { hermes = next }
            let router = Self.decode(remote["openrouter"]) ?? OpenRouterSettings()
            if router != openrouter { openrouter = router }
            if let provider = remote["selected"] as? String, Self.providers.contains(provider) { selected = provider }
        }
        if let key, key != Keychain.get(Self.keychainKey) {
            Keychain.set(Self.keychainKey, key)
            hasKey = true
        }
        Task { await check() }
    }

    var key: String? { Keychain.get(Self.keychainKey) }

    func connect(url: String, key: String) async {
        Keychain.set(Self.keychainKey, key)
        hasKey = true
        hermes.baseUrl = Hermes.normalized(url)
        section["selected"] = "hermes"
        selected = "hermes"
        onChange("hermesKey")
        await check()
    }

    func disconnect() {
        Keychain.set(Self.keychainKey, nil)
        hasKey = false
        hermes.baseUrl = ""
        status = .notConfigured
        onChange("hermesKey")
    }

    func forgetKey() {
        newChat()
        models = []
        history = []
        hasOpenRouterKey = false
        Keychain.set(Self.keychainKey, nil)
        hasKey = false
        status = .notConfigured
    }

    private(set) var status: Status = .notConfigured
    private(set) var models: [Hermes.Model] = []

    var isOn: Bool {
        switch selected {
        case "openrouter": openrouter.enabled
        case "openclaw": openclaw.enabled
        case "varys": varys.enabled
        default: hermes.enabled
        }
    }
    var providerName: String {
        switch selected {
        case "openrouter": "OpenRouter"
        case "openclaw": "OpenClaw"
        case "varys": "varys"
        default: "Hermes"
        }
    }
    var chosenModel: String {
        get {
            switch selected {
            case "openrouter": openrouter.model
            case "openclaw": openclaw.model
            case "varys": ""
            default: hermes.model
            }
        }
        set {
            switch selected {
            case "openrouter": openrouter.model = newValue
            case "openclaw": openclaw.model = newValue
            case "varys": break
            default: hermes.model = newValue
            }
        }
    }
    private var routerClient: OpenRouter? { relay.flatMap { try? OpenRouter(relay: $0) } }

    func connectOpenRouter(key: String) async throws {
        guard let client = routerClient else { throw Hermes.Failure(message: "Sign in to your Otter account first.") }
        let connection = try await client.connection(key: key.trimmingCharacters(in: .whitespacesAndNewlines))
        guard relay?.token == client.token else { return }
        section["selected"] = "openrouter"
        selected = "openrouter"
        openrouter.enabled = true
        models = connection.models
        hasOpenRouterKey = connection.connected
        status = connection.connected ? .ready : .notConfigured
    }

    func disconnectOpenRouter() async throws {
        guard let client = routerClient else { return }
        try await client.disconnect()
        newChat()
        hasOpenRouterKey = false
        models = []
        status = .notConfigured
    }

    private var client: Hermes? {
        guard hermes.enabled, !hermes.baseUrl.isEmpty, let key else { return nil }
        return Hermes(baseURL: Hermes.normalized(hermes.baseUrl), key: key)
    }

    func check() async {
        if selected == "openclaw" { return await checkOpenClaw() }
        if selected == "varys" { return await checkVarys() }
        if selected == "openrouter" {
            guard let client = routerClient, openrouter.enabled else { status = .notConfigured; return }
            status = .checking
            do {
                let connection = try await client.connection()
                guard selected == "openrouter", relay?.token == client.token else { return }
                hasOpenRouterKey = connection.connected
                models = connection.models
                status = connection.connected ? .ready : .notConfigured
            } catch { if selected == "openrouter", relay?.token == client.token { status = .failed(error.localizedDescription) } }
            return
        }
        guard let client else { status = .notConfigured; return }
        status = .checking
        do {
            let (models, sessions) = try await client.check()
            guard selected == "hermes" else { return }
            self.models = models
            if hermes.sessions != sessions {
                applying = true
                hermes.sessions = sessions
                applying = false
            }
            status = .ready
        } catch {
            if selected == "hermes" { status = .failed("Can't reach Hermes: \(error.localizedDescription)") }
        }
    }

    var model: Hermes.Model? {
        models.first { $0.slug == chosenModel && !chosenModel.isEmpty } ?? models.first(where: \.isDefault) ?? models.first
    }

    private var modelFields: [String: Any] {
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

    private(set) var turns: [Turn] = []
    private(set) var session: String?
    private(set) var running = false
    var synced: [SyncedChat] = []
    @ObservationIgnored var chatID: String?
    @ObservationIgnored var chatBase: [String: Any]?
    @ObservationIgnored var baseTurns = 0
    /** Why this chat can only be read here (it ran in Claude on a Mac, or needs another agent). */
    var readOnly: String?
    @ObservationIgnored private var run: String?
    @ObservationIgnored private var streaming: Task<Void, Never>?
    @ObservationIgnored private var openRouterRunClient: OpenRouter?
    @ObservationIgnored private var approvalAnswer: CheckedContinuation<Bool, Never>?
    @ObservationIgnored private var allowedTools: Set<String> = []
    @ObservationIgnored private var approvalTool: String?
    @ObservationIgnored private var generation = UUID()
    @ObservationIgnored private var gateway: OpenClaw?
    private(set) var openClawPairing: String?
    private(set) var openClawFullAccess: Bool?
    private(set) var openClawFullAccessRequest: String?
    @ObservationIgnored private var openRun: OpenRun? {
        didSet { if openRun != oldValue { Self.keep(openRun, Self.openRunKey) } }
    }
    @ObservationIgnored private var varysRun: OpenRun? {
        didSet { if varysRun != oldValue { Self.keep(varysRun, Self.varysRunKey) } }
    }
    @ObservationIgnored private var varysConnection: (key: String, client: Varys)?
    @ObservationIgnored private var varysResuming: Task<Void, Never>?
    /** The last item of the open varys chat's thread that it shows: what varys writes after it is caught up on. */
    @ObservationIgnored private var varysSeen: Int?

    private static func keep(_ run: OpenRun?, _ key: String) {
        if let run { UserDefaults.standard.set(try? JSONEncoder().encode(run), forKey: key) }
        else { UserDefaults.standard.removeObject(forKey: key) }
    }

    func newChat() {
        stop()
        turns = []
        session = nil
        allowedTools = []
        chatID = nil
        chatBase = nil
        baseTurns = 0
        readOnly = nil
        varysSeen = nil
    }

    func send(_ text: String, context: [MailContext] = []) {
        if selected == "openrouter" { sendOpenRouter(text, context: context); return }
        if selected == "openclaw" { sendOpenClaw(text, context: context); return }
        if selected == "varys" { sendVarys(text, context: context); return }
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let client, !question.isEmpty || !context.isEmpty else { return }
        if running, let run {
            Task { if await client.steer(run: run, question) { self.turns.append(Turn(role: .user, text: question)) } }
            return
        }
        turns.append(Turn(role: .user, text: question, context: context.map(\.subject)))
        turns.append(Turn(role: .agent, text: ""))
        running = true
        let message = MailContext.handoff(question, context)
        let fields = modelFields
        let generation = self.generation
        streaming = Task {
            do {
                let currentSession: String
                if let session { currentSession = session }
                else {
                    currentSession = try await client.createSession(title: String(question.prefix(60)))
                    guard self.generation == generation else { return }
                    session = currentSession
                }
                for try await event in client.turn(session: currentSession, message: message, model: fields) {
                    guard self.generation == generation else { return }
                    handle(event)
                }
            } catch is CancellationError {
            } catch {
                if self.generation == generation { updateLast { $0.error = error.localizedDescription } }
            }
            guard self.generation == generation else { return }
            running = false
            run = nil
            await loadHistory()
            await saveChat()
        }
    }

    private func sendOpenRouter(_ text: String, context: [MailContext]) {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !running, openrouter.enabled, let client = routerClient, let model, let store = mailStore(),
              !question.isEmpty || !context.isEmpty else { return }
        turns.append(Turn(role: .user, text: question, context: context.map(\.subject)))
        turns.append(Turn(role: .agent, text: ""))
        let requestID = UUID().uuidString
        run = requestID
        running = true
        openRouterRunClient = client
        var body: [String: Any] = ["requestId": requestID, "input": MailContext.handoff(question, context, reader: "get_thread"),
                                   "title": String(question.prefix(60)), "model": model.slug, "tools": AgentMailTools.definitions]
        if let session { body["sessionId"] = session }
        streaming = Task { [self] in
            let tools = AgentMailTools(store: store, confirm: { [weak self] name, detail in
                guard let self, self.run == requestID, !Task.isCancelled else { return false }
                if self.openrouter.runtimeMode == "full-access" || self.allowedTools.contains(name) { return true }
                self.approvalTool = name
                let approved = await withCheckedContinuation { continuation in
                    self.approvalAnswer = continuation
                    self.updateLast { $0.approval = Approval(id: UUID().uuidString, question: "Allow OpenRouter to use \(name.replacingOccurrences(of: "_", with: " "))?", detail: detail, choices: ["once", "session", "deny"]) }
                }
                self.approvalTool = nil
                return approved && !Task.isCancelled && self.run == requestID
            })
            do {
                try await client.turn(body, event: { [weak self] value in
                    guard let self, self.run == requestID else { return }
                    switch value["type"] as? String {
                    case "session": self.session = value["sessionId"] as? String
                    case "delta": self.updateLast { $0.text += value["text"] as? String ?? "" }
                    case "tool": self.updateLast { $0.tools.append(Tool(name: (value["step"] as? [String: Any])?["title"] as? String ?? "Tool")) }
                    case "toolResult": self.handle(.toolResult(value["output"] as? String ?? ""))
                    case "error":
                        let message = (value["message"] as? String) ?? "The agent could not finish."
                        if message != "cancelled" { self.updateLast { $0.error = message.replacingOccurrences(of: "agent_error: ", with: "") } }
                    default: break
                    }
                }, tool: { name, input in await tools.run(name, input) })
            } catch is CancellationError {
            } catch {
                await client.stop(requestID)
                if run == requestID { updateLast { $0.error = error.localizedDescription } }
            }
            guard run == requestID else { return }
            running = false
            run = nil
            openRouterRunClient = nil
            await loadHistory()
            await saveChat()
        }
    }

    private func handle(_ event: Hermes.Event) {
        switch event {
        case .run(let id): run = id
        case .delta(let text): updateLast { $0.text += text }
        case .tool(let name): updateLast { $0.tools.append(Tool(name: name)) }
        case .toolResult(let output): updateLast { t in if !t.tools.isEmpty { t.tools[t.tools.count - 1].output = output } }
        case .approval(let id, let command, let reason, let choices):
            updateLast {
                $0.approval = Approval(id: id, question: "Allow Hermes to run this command?", detail: command, isCommand: true, reason: reason, choices: choices)
            }
        case .completed(let steer):
            if let steer { turns.append(Turn(role: .user, text: steer, error: "Hermes finished before this; send it again.")) }
        case .failed(let message): updateLast { $0.error = message }
        }
    }

    var pendingApproval: Approval? { turns.last { $0.role == .agent }?.approval }
    var pendingQuestion: OpenClaw.Question? { turns.last { $0.role == .agent }?.question }

    private func updateLast(_ change: (inout Turn) -> Void) {
        guard let i = turns.lastIndex(where: { $0.role == .agent }) else { return }
        change(&turns[i])
    }

    func stop() {
        generation = UUID()
        if run != nil, selected == "varys", let session, let client = varysClient {
            varysRun = nil
            Task { try? await client.stop(thread: session) }
        } else if let run, selected == "openclaw", let session, let gateway = openClawClient {
            openRun = nil
            Task { await gateway.abort(session: session, run: run) }
        } else if let run, let client = openRouterRunClient { Task { await client.stop(run) } }
        else if let run, let client { Task { await client.stop(run: run) } }
        approvalAnswer?.resume(returning: false)
        approvalAnswer = nil
        updateLast { $0.approval = nil; $0.question = nil }
        streaming?.cancel()
        streaming = nil
        running = false
        run = nil
        openRouterRunClient = nil
    }

    func answer(_ approval: Approval, _ choice: String) {
        if let answer = approvalAnswer, pendingApproval?.id == approval.id {
            if choice == "session", let tool = approvalTool { allowedTools.insert(tool) }
            approvalAnswer = nil
            updateLast { $0.approval = nil }
            answer.resume(returning: ["once", "session"].contains(choice))
            return
        }
        if selected == "varys" { return answerVarys(approval, choice) }
        if selected == "openclaw", let gateway = openClawClient {
            Task {
                try? await gateway.approve(approval.id, choice: choice)
                updateLast { if $0.approval?.id == approval.id { $0.approval = nil } }
            }
            return
        }
        guard let client, let run else { return }
        Task {
            try? await client.approve(run: run, request: approval.id, choice: choice)
            updateLast { $0.approval = nil }
        }
    }

    private(set) var history: [Hermes.Session] = []

    func loadHistory() async {
        if selected == "varys" {
            guard let client = varysClient, let threads = try? await client.threads(), selected == "varys" else { return }
            history = threads.map { thread in
                Hermes.Session(id: thread.id, title: thread.title, preview: thread.routine.map { "Scheduled · \($0)" } ?? thread.preview,
                               lastActive: thread.updatedAt, messageCount: thread.preview == nil ? 0 : 1)
            }
            return
        }
        if selected == "openclaw" {
            guard let gateway = openClawClient, let chats = try? await gateway.chats() else { return }
            if selected == "openclaw" {
                history = chats.map { Hermes.Session(id: $0.id, title: $0.title, preview: $0.preview, lastActive: $0.lastActive, messageCount: $0.preview == nil ? 0 : 1) }
            }
            return
        }
        if selected == "openrouter" {
            guard let client = routerClient else { return }
            let chats = try? await client.sessions()
            if selected == "openrouter", relay?.token == client.token, let chats { history = chats }
            return
        }
        guard let client else { return }
        history = (try? await client.sessions()) ?? history
    }

    func open(_ chat: Hermes.Session) async {
        newChat()
        let generation = self.generation
        let provider = selected
        let token = relay?.token
        session = chat.id
        chatID = synced.first { $0.provider == provider && $0.sessionId == chat.id }?.id
        let messages: [Hermes.Message]
        if selected == "openrouter", let client = routerClient { messages = (try? await client.messages(of: chat.id)) ?? [] }
        else if selected == "openclaw", let gateway = openClawClient {
            messages = ((try? await gateway.messages(of: chat.id)) ?? []).map { Hermes.Message(role: $0.role, text: $0.text, tools: $0.steps.map(\.name)) }
        }
        else if selected == "varys", let client = varysClient {
            let items = (try? await client.items(of: chat.id)) ?? []
            messages = Varys.messages(items)
            if self.generation == generation { varysSeen = Self.lastPlaced(items) }
        }
        else if let client { messages = (try? await client.messages(of: chat.id)) ?? [] }
        else { return }
        guard self.generation == generation, selected == provider, relay?.token == token else { return }
        var turns: [Turn] = []
        for message in messages {
            switch message.role {
            case "user":
                // Show the question, not the context block sent with it.
                let text = message.text.components(separatedBy: MailContext.marker).first ?? message.text
                turns.append(Turn(role: .user, text: text.trimmingCharacters(in: .whitespacesAndNewlines)))
            case "assistant":
                if let last = turns.last, last.role == .agent {
                    turns[turns.count - 1].text += (last.text.isEmpty ? "" : "\n\n") + message.text
                    turns[turns.count - 1].tools += message.tools.map { Tool(name: $0) }
                } else {
                    turns.append(Turn(role: .agent, text: message.text, tools: message.tools.map { Tool(name: $0) }))
                }
            default:
                break
            }
        }
        self.turns = turns
    }

    func loadSynced() async {
        guard let relay, relay.token != nil, let objects = try? await relay.chats() else { return }
        synced = objects.compactMap(SyncedChat.init).sorted { $0.updatedAt > $1.updatedAt }
    }

    func open(synced chat: SyncedChat) async {
        newChat()
        let generation = self.generation
        guard let relay, let object = try? await relay.chat(chat.id), self.generation == generation else { return }
        let shown = ChatJSON.turns(object["turns"] as? [[String: Any]] ?? [])
        turns = shown
        chatID = chat.id
        chatBase = object
        baseTurns = shown.count
        if chat.isLocalToMac {
            readOnly = "This chat ran in \(chat.providerName) on \(chat.device ?? "a Mac"). Continue it there."
        } else if chat.provider != selected {
            readOnly = "This is a \(chat.providerName) chat. Pick \(chat.providerName) in Settings › Agents to continue it."
        } else {
            session = chat.sessionId
        }
    }

    func delete(synced chat: SyncedChat) async {
        try? await relay?.deleteChat(chat.id)
        if chatID == chat.id { newChat() }
        synced.removeAll { $0.id == chat.id }
    }

    func saveChat() async {
        guard let relay, relay.token != nil, readOnly == nil, turns.contains(where: { $0.role == .user }) else { return }
        let fresh: [String: Any]? = if let chatID { try? await relay.chat(chatID) } else { nil }
        if chatBase == nil, fresh != nil { baseTurns = max(0, turns.count - 2) }
        let id = chatID ?? UUID().uuidString.lowercased()
        var chat = fresh ?? chatBase ?? [:]
        chat["id"] = id
        if chat["title"] == nil {
            chat["title"] = String((turns.first { $0.role == .user }?.text ?? "New chat").prefix(56))
        }
        chat["provider"] = selected
        chat["sessionId"] = session ?? NSNull()
        if chat["sessionOwned"] == nil { chat["sessionOwned"] = true }
        if chat["lastResponseId"] == nil { chat["lastResponseId"] = NSNull() }
        if chat["device"] == nil { chat["device"] = NSNull() }
        if chat["createdAt"] == nil { chat["createdAt"] = ChatJSON.now }
        if chat["tabs"] == nil { chat["tabs"] = [Any]() }
        chat["updatedAt"] = ChatJSON.now
        chat.removeValue(forKey: "deletedAt")
        let before = chat["turns"] as? [[String: Any]] ?? []
        chat["turns"] = Array((before + ChatJSON.objects(Array(turns.dropFirst(baseTurns)))).suffix(80))
        do {
            try await relay.putChat(chat)
            chatID = id
            chatBase = chat
            baseTurns = turns.count
            await loadSynced()
        } catch {
        }
    }

    func delete(_ chat: Hermes.Session) async {
        // Deleting a varys thread is for the user's own devices, in varys: the chat goes, the thread stays.
        if selected == "varys" {}
        else if selected == "openrouter", let client = routerClient { try? await client.delete(session: chat.id) }
        else if selected == "openclaw", let gateway = openClawClient { try? await gateway.delete(session: chat.id) }
        else if let client { try? await client.delete(session: chat.id) }
        else { return }
        if session == chat.id { newChat() }
        history.removeAll { $0.id == chat.id }
    }
}

extension Agent {
    /** The run in flight, kept so one the app left (in the background, or quit) is picked up again. */
    struct OpenRun: Codable, Equatable {
        var session: String
        var run: String
    }

    private static let openClawSecrets = OpenClaw.Secrets(
        get: { Keychain.get($0) },
        set: { Keychain.set($0, $1, thisDeviceOnly: true) }
    )

    var openClawClient: OpenClaw? {
        guard openclaw.enabled, !openclaw.url.isEmpty, let url = URL(string: openclaw.url) else { return nil }
        if gateway?.url != url {
            gateway?.disconnect()
            gateway = OpenClaw(url: url, secrets: Self.openClawSecrets,
                               appVersion: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")
        }
        return gateway
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
        status = .notConfigured
    }

    private func useOpenClaw(url: String) async {
        openclaw.url = OpenClaw.normalized(url)
        openclaw.enabled = true
        if selected == "openclaw" { await check() } else { selected = "openclaw" }
    }

    private func forgetOpenClawDevice() {
        gateway?.disconnect()
        gateway = nil
        openClawPairing = nil
        openClawFullAccess = nil
        openClawFullAccessRequest = nil
        openRun = nil
        Keychain.set(OpenClaw.deviceTokenName, nil)
        Keychain.set(OpenClaw.scopesName, nil)
    }

    func checkOpenClaw() async {
        guard let gateway = openClawClient, gateway.hasCredentials else {
            status = .notConfigured
            models = []
            return
        }
        status = .checking
        do {
            let agents = try await gateway.agents()
            guard selected == "openclaw" else { return }
            models = agents.map {
                Hermes.Model(slug: $0.id, name: $0.name, isDefault: $0.isDefault, reasoning: false, canDisableReasoning: false, fast: false)
            }
            openClawPairing = nil
            openClawFullAccess = gateway.fullAccess
            status = .ready
            await resumeOpenClaw()
        } catch {
            guard selected == "openclaw" else { return }
            openClawPairing = gateway.pairingRequest
            status = .failed(Self.openClawProblem(error))
        }
    }

    private static func openClawProblem(_ error: Error) -> String {
        let failure = error as? OpenClaw.Failure
        switch failure?.code {
        case "PAIRING_REQUIRED": return "Approve this iPhone on the gateway."
        case "unreachable", "timeout": return "Can't reach the gateway. Are you on Tailscale?"
        default:
            let message = error.localizedDescription
            return message.range(of: "token|unauthori[sz]ed", options: [.regularExpression, .caseInsensitive]) != nil
                ? "The gateway refused the setup code or token. Make a new setup code."
                : message
        }
    }

    func sendOpenClaw(_ text: String, context: [MailContext]) {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let gateway = openClawClient, !question.isEmpty || !context.isEmpty else { return }
        if running, let session, let run {
            Task { if await gateway.steer(session: session, run: run, question) { self.turns.append(Turn(role: .user, text: question)) } }
            return
        }
        turns.append(Turn(role: .user, text: question, context: context.map(\.subject)))
        turns.append(Turn(role: .agent, text: ""))
        let chat = session ?? "agent:\(model?.slug ?? "main"):otter-mail:\(UUID().uuidString.lowercased())"
        session = chat
        let run = UUID().uuidString.lowercased()
        follow(gateway.send(MailContext.handoff(question, context), session: chat, run: run), session: chat, run: run)
    }

    func resumeOpenClaw() async {
        guard selected == "openclaw", !running, let pending = openRun, let gateway = openClawClient else { return }
        if session != pending.session {
            await open(Hermes.Session(id: pending.session, title: nil, preview: nil, lastActive: .now, messageCount: 0))
            guard selected == "openclaw", session == pending.session, !running, openRun == pending else { return }
            if turns.last?.role != .agent { turns.append(Turn(role: .agent, text: "")) }
        }
        updateLast { $0.note = nil }
        follow(gateway.resume(session: pending.session, run: pending.run), session: pending.session, run: pending.run)
    }

    func suspendOpenClaw() {
        guard selected == "openclaw" else { return }
        if running {
            generation = UUID()
            streaming?.cancel()
            streaming = nil
            running = false
            run = nil
        }
        gateway?.disconnect()
    }

    private func follow(_ events: AsyncStream<OpenClaw.Event>, session: String, run: String) {
        self.run = run
        running = true
        openRun = OpenRun(session: session, run: run)
        let generation = self.generation
        streaming = Task {
            for await event in events {
                guard self.generation == generation else { return }
                switch event {
                case .reply(let reply):
                    updateLast {
                        $0.text = reply.text
                        $0.tools = reply.steps.map { Tool(name: $0.name, output: $0.output) }
                    }
                case .approval(let approval):
                    updateLast {
                        $0.approval = Approval(id: approval.id, question: "Allow OpenClaw to run this command?", detail: approval.command,
                                               isCommand: approval.command != nil, choices: ["once", "always", "deny"])
                    }
                case .approvalResolved(let id):
                    updateLast { if $0.approval?.id == id { $0.approval = nil } }
                case .question(let question):
                    updateLast { $0.question = question }
                case .questionResolved(let id):
                    updateLast { if $0.question?.id == id { $0.question = nil } }
                // The turn stays running while it waits on a yield; this app doesn't say so.
                case .waiting, .working:
                    break
                case .done:
                    openRun = nil
                case .failed(let message):
                    openRun = nil
                    updateLast { $0.error = message }
                case .detached:
                    updateLast { $0.note = "Lost OpenClaw mid-reply. The rest shows here once it's back." }
                }
            }
            guard self.generation == generation else { return }
            running = false
            self.run = nil
            updateLast { $0.approval = nil; $0.question = nil }
            await loadHistory()
            await saveChat()
        }
    }

    func answer(_ question: OpenClaw.Question, _ answers: [String: [String]]?) {
        if selected == "varys" { return answerVarys(question, answers) }
        guard let gateway = openClawClient else { return }
        Task {
            do {
                try await gateway.answer(question.id, answers)
                updateLast { if $0.question?.id == question.id { $0.question = nil } }
            } catch {
                updateLast { $0.error = "Couldn't send the answer: \(error.localizedDescription)" }
            }
        }
    }

    func allowOpenClawFullAccess() async {
        guard let gateway = openClawClient else { return }
        do {
            let allowed = try await gateway.allowFullAccess { self.openClawFullAccessRequest = $0 }
            openClawFullAccessRequest = nil
            if allowed { await check() }
        } catch {
            openClawFullAccessRequest = nil
            status = .failed(Self.openClawProblem(error))
        }
    }
}

extension Agent {
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

    /** How the grant is listed in varys's Settings → Sharing & access. */
    private static let varysAppName = "Otter Mail on iPhone"

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
        let paired = try await Varys.pair(address: address, code: code, agentId: agentId, name: Self.varysAppName, installation: installation)
        // The grant it replaces took its relay with it; the channel goes too.
        await removeVarysRelay(from: nil)
        forgetVarysConnection()
        Keychain.set(Varys.tokenName, paired.token, thisDeviceOnly: true)
        varys.address = paired.address
        varys.agentId = paired.agentId
        varys.installation = installation
        varys.enabled = true
        if selected == "varys" { await check() } else { selected = "varys" }
    }

    /** Revokes this iPhone's grant in varys (its relay goes with it), and the account's channel for it goes too. */
    func disconnectVarys() async {
        try? await varysClient?.revoke()
        await removeVarysRelay(from: nil)
        forgetVarysConnection()
        Keychain.set(Varys.tokenName, nil)
        varys.address = ""
        varys.agentId = ""
        status = .notConfigured
    }

    private func forgetVarysConnection() {
        if selected == "varys", running { stop() }
        varysConnection?.client.disconnect()
        varysConnection = nil
        varysRun = nil
    }

    func checkVarys() async {
        guard let client = varysClient else {
            status = .notConfigured
            return
        }
        status = .checking
        do {
            let me = try await client.me()
            guard selected == "varys", varysClient === client else { return }
            if me.actsAs != "client" || !Varys.scopes.allSatisfy(me.scopes.contains) {
                let host = URL(string: client.address)?.host() ?? client.address
                status = .failed("\(host): this app code doesn't work as you with chats and approvals. Make one with the Chat client preset, and pair again.")
                return
            }
            status = .ready
            await syncVarysRelay()
            await resumeVarys()
        } catch {
            if selected == "varys" { status = .failed(error.localizedDescription) }
        }
    }

    /**
     * With the Otter account, this iPhone's grant names Otter's relay (an agent channel of the
     * account's), so varys tells the account's devices which thread to read; without it, nothing.
     */
    private func syncVarysRelay() async {
        guard let client = varysClient, let relay else { return }
        if relay.token != nil, varys.relayChannel.isEmpty {
            guard let channel = try? await relay.makeAgentChannel("varys · \(Self.varysAppName)") else { return }
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

    /** Each done as far as it can be. */
    private func removeVarysRelay(from client: Varys?) async {
        try? await client?.removeRelay()
        guard !varys.relayChannel.isEmpty else { return }
        try? await relay?.deleteAgentChannel(varys.relayChannel)
        varys.relayChannel = ""
    }

    func sendVarys(_ text: String, context: [MailContext]) {
        let question = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let client = varysClient, !question.isEmpty || !context.isEmpty else { return }
        if running, let session {
            Task { if await client.steer(question, thread: session) { self.turns.append(Turn(role: .user, text: question)) } }
            return
        }
        turns.append(Turn(role: .user, text: question, context: context.map(\.subject)))
        turns.append(Turn(role: .agent, text: ""))
        let first = session == nil
        let thread = session ?? UUID().uuidString.lowercased()
        session = thread
        let run = UUID().uuidString.lowercased()
        // varys reads the mail itself, through its own mail connection, as the other agents do with theirs.
        let message = MailContext.handoff(question, context, reader: "your mail connection")
        followVarys(session: thread, run: run) { client.send(message, thread: thread, requestId: run, first: first) }
    }

    /**
     * The turn the app left, picked up again; with none, what varys wrote in the open chat
     * meanwhile. Once at a time: the app coming back and its check of varys both ask.
     */
    func resumeVarys() async {
        if let varysResuming { return await varysResuming.value }
        let resuming = Task { await pickUpVarys() }
        varysResuming = resuming
        await resuming.value
        varysResuming = nil
    }

    private func pickUpVarys() async {
        guard selected == "varys", !running, let client = varysClient else { return }
        guard let pending = varysRun else { return await catchUpVarys() }
        if session != pending.session {
            await open(Hermes.Session(id: pending.session, title: nil, preview: nil, lastActive: .now, messageCount: 0))
            guard selected == "varys", session == pending.session, !running, varysRun == pending else { return }
            if turns.last?.role != .agent { turns.append(Turn(role: .agent, text: "")) }
        }
        updateLast { $0.note = nil; $0.error = nil }
        followVarys(session: pending.session, run: pending.run) { client.resume(thread: pending.session, requestId: pending.run) }
    }

    /** In the background, the turn stops being followed here; varys goes on, and it's picked up on return. */
    func suspendVarys() {
        guard selected == "varys" else { return }
        if running {
            generation = UUID()
            streaming?.cancel()
            streaming = nil
            running = false
            run = nil
        }
        varysConnection?.client.disconnect()
    }

    /** varys told Otter's relay it has something: for the chat open here, it shows; anything else shows in Chats. */
    func delivered(agentId: String, sessionKey: String?) async {
        guard selected == "varys", agentId == varys.agentId else { return }
        if let sessionKey, sessionKey == session { await catchUpVarys() }
        await loadHistory()
    }

    /** What varys wrote in the open chat's thread since the chat last read it, when no message of the user's led to it. */
    private func catchUpVarys() async {
        guard selected == "varys", !running, readOnly == nil, let thread = session, let client = varysClient else { return }
        let generation = self.generation
        guard let items = try? await client.items(of: thread), self.generation == generation, session == thread, !running else { return }
        let seen = varysSeen
        varysSeen = Self.lastPlaced(items)
        guard let seen else { return }
        let added = items.filter { ($0["id"]?.string).flatMap { Int($0) }.map { $0 > seen } == true }
        // A message of the user's (from varys's own app) is a turn there, not a delivery.
        guard !added.contains(where: { $0["type"]?.string == "message" }) else { return }
        let said = Varys.messages(added)
        guard said.contains(where: { !$0.text.isEmpty }) else { return }
        turns.append(Turn(role: .agent, text: said.map(\.text).filter { !$0.isEmpty }.joined(separator: "\n\n"),
                          tools: said.flatMap(\.tools).map { Tool(name: $0) }))
        await saveChat()
    }

    fileprivate static func lastPlaced(_ items: [Varys.JSON]) -> Int? {
        items.compactMap { ($0["id"]?.string).flatMap { Int($0) } }.last
    }

    private func followVarys(session: String, run: String, _ events: @escaping () async -> AsyncStream<Varys.Event>) {
        self.run = run
        running = true
        varysRun = OpenRun(session: session, run: run)
        let generation = self.generation
        streaming = Task {
            for await event in await events() {
                guard self.generation == generation else { return }
                switch event {
                case .reply(let reply):
                    updateLast {
                        $0.text = reply.text
                        $0.tools = reply.steps.map { Tool(name: $0.name, output: $0.output) }
                    }
                case .approval(let approval):
                    updateLast {
                        $0.approval = Approval(id: approval.id, question: approval.title, detail: approval.detail, isCommand: approval.detail != nil,
                                               reason: approval.why, choices: approval.inThread ? ["once", "session", "deny"] : ["once", "deny"])
                    }
                case .question(let question):
                    updateLast {
                        $0.question = OpenClaw.Question(
                            id: question.id,
                            items: [.init(id: question.id, header: "", question: question.text, options: [], multiSelect: false, secret: false)],
                            expires: question.deadline ?? .distantFuture)
                    }
                case .resolved(let id):
                    updateLast {
                        if $0.approval?.id == id { $0.approval = nil }
                        if $0.question?.id == id { $0.question = nil }
                    }
                case .done:
                    varysRun = nil
                case .stopped:
                    varysRun = nil
                    updateLast { $0.error = "Stopped." }
                case .failed(let message):
                    varysRun = nil
                    updateLast { $0.error = message }
                case .detached:
                    updateLast { $0.note = "Lost varys mid-reply. The rest shows here once it's back." }
                }
            }
            guard self.generation == generation else { return }
            running = false
            self.run = nil
            updateLast { $0.approval = nil; $0.question = nil }
            if let client = varysClient, let items = try? await client.items(of: session), self.session == session {
                varysSeen = Self.lastPlaced(items)
            }
            await loadHistory()
            await saveChat()
        }
    }

    private func answerVarys(_ approval: Approval, _ choice: String) {
        guard let client = varysClient else { return }
        Task {
            do {
                try await client.decide(approval.id, approve: choice != "deny", inThread: choice == "session")
                updateLast { if $0.approval?.id == approval.id { $0.approval = nil } }
            } catch {
                updateLast { $0.error = "Couldn't send the answer: \(error.localizedDescription)" }
            }
        }
    }

    /** A varys question is answered in words; skipped, it stays in varys's inbox, to answer there. */
    private func answerVarys(_ question: OpenClaw.Question, _ answers: [String: [String]]?) {
        guard let client = varysClient else { return }
        let text = answers?[question.id]?.joined(separator: ", ").trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        Task {
            do {
                if !text.isEmpty { try await client.answer(question.id, text) }
                updateLast { if $0.question?.id == question.id { $0.question = nil } }
            } catch {
                updateLast { $0.error = "Couldn't send the answer: \(error.localizedDescription)" }
            }
        }
    }
}

/**
 * A conversation handed to the agent as a pointer (apps/web's
 * chat-context.ts): the agent reads mail itself (with gog, Otter's tools, or
 * varys's own mail connection), so only ids and a subject leave the app.
 */
struct MailContext: Hashable {
    var account: String
    var threadID: String
    var subject: String
    var from: String
    var messageIDs: [String]

    static let marker = "\n\n— context from Otter Mail —"

    init(_ thread: MailThread) {
        account = thread.mailbox
        threadID = thread.id
        subject = thread.subject.isEmpty ? "(no subject)" : thread.subject
        from = thread.latest.from.email
        messageIDs = [thread.latest.id]
    }

    static func handoff(_ question: String, _ context: [MailContext], reader: String = "gog") -> String {
        guard !context.isEmpty else { return question }
        var lines = [question, "", "— context from Otter Mail —"]
        for c in context {
            lines.append("• [\(c.account)] \"\(c.subject)\" — from \(c.from) (threadId \(c.threadID), message \(c.messageIDs.joined(separator: ", ")))")
        }
        lines.append("Fetch full content with \(reader) if needed.")
        return lines.joined(separator: "\n")
    }
}
