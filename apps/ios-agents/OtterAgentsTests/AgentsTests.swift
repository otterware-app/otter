import Foundation
import Synchronization
import Testing
@testable import Otter_Agents

/** The agents you added, as the account and this iPhone keep them (core's service.ts tests, for the phone's port). */
@MainActor
struct AgentsTests {
    private func entry(_ id: String, _ kind: String, _ name: String, avatar: String? = nil, _ settings: [String: JSON] = [:]) -> AgentList.Entry {
        AgentList.Entry(id: id, kind: kind, name: name, avatar: avatar, settings: settings)
    }

    @Test func theAccountsSectionReadsAsAList() throws {
        let section = try JSON(parsing: Data("""
        {"selected": "a1", "removed": ["gone", 7],
         "agents": [
           {"id": "a1", "kind": "hermes", "name": "brokk", "avatar": "data:image/webp;base64,UklGRg==", "settings": {"baseUrl": "https://brokk/v1", "mutedJobs": "j1"}},
           {"id": "a2", "kind": "claude", "name": "Claude", "settings": {"runtimeMode": "full-access"}},
           {"id": "a3", "kind": "hermes", "name": "\(String(repeating: "x", count: 80))", "avatar": "https://example.com/a.png", "settings": {}},
           {"id": "a4", "kind": "hermes", "name": "no settings"}
         ]}
        """.utf8))
        let list = try #require(AgentList(section))
        #expect(list.selected == "a1")
        #expect(list.removed == ["gone"])
        #expect(list.agents.map(\.id) == ["a1", "a2", "a3"])
        #expect(list.agents[0].avatar == "data:image/webp;base64,UklGRg==")
        #expect(list.agents[0].settings["mutedJobs"] == .string("j1"))
        // A kind only a Mac runs is kept as it comes, to be written back unchanged.
        #expect(list.agents[1].kind == "claude" && list.agents[1].settings["runtimeMode"] == .string("full-access"))
        #expect(list.agents[2].name.count == 60)
        #expect(list.agents[2].avatar == nil, "a picture that's a link isn't one")
        #expect(AgentList(list.json) == list)
        // Apps from before agents had ids wrote another shape: it isn't a list.
        #expect(AgentList(try JSON(parsing: Data(#"{"selected": "hermes", "hermes": {"baseUrl": "x"}}"#.utf8))) == nil)
        #expect(AgentList(nil) == nil)
    }

    @Test func whatStaysOnThisIPhoneDoesNotFollowTheAccount() {
        let list = AgentList(selected: "v", agents: [
            entry("h", "hermes", "brokk", ["baseUrl": .string("https://brokk/v1"), "enabled": .bool(true)]),
            entry("o", "openclaw", "Home", ["url": .string("wss://home"), "model": .string("main")]),
            entry("v", "varys", "varys", ["address": .string("https://v"), "agentId": .string("a"), "installation": .string("i"),
                                         "relayChannel": .string("c"), "mutedRoutines": .string("r1")]),
            entry("c", "codex", "Codex (work)", ["binaryPath": .string("/usr/local/bin/codex")]),
        ])
        let synced = list.synced
        #expect(synced.agents[0].settings == list.agents[0].settings)
        #expect(synced.agents[1].settings.isEmpty, "each device pairs with OpenClaw on its own")
        #expect(synced.agents[1].name == "Home")
        #expect(synced.agents[2].settings == ["mutedRoutines": .string("r1")])
        #expect(synced.agents[3].settings == list.agents[3].settings, "a Mac's agent is written back as the account has it")
    }

    @Test func theAccountWinsAndWhatsThisIPhonesStays() {
        let mine = AgentList(selected: "o", agents: [
            entry("h", "hermes", "Hermes", ["baseUrl": .string("https://old/v1"), "model": .string("a::b"), "sessions": .bool(true)]),
            entry("o", "openclaw", "OpenClaw", ["url": .string("wss://home"), "model": .string("main")]),
            entry("v", "varys", "varys", ["address": .string("https://v"), "agentId": .string("a"), "mutedRoutines": .string("")]),
        ])
        let account = AgentList(selected: "h", agents: [
            entry("c", "claude", "Claude", ["runtimeMode": .string("full-access")]),
            entry("v", "varys", "varys at home", avatar: "data:image/png;base64,AAAA", ["mutedRoutines": .string("r1"), "address": .string("https://elsewhere")]),
            entry("h", "hermes", "brokk", ["baseUrl": .string("https://brokk/v1")]),
            entry("o", "openclaw", "Home OpenClaw", ["url": .string("wss://someone-elses")]),
        ])
        let merged = mine.merged(with: account)
        #expect(merged.agents.map(\.id) == ["c", "v", "h", "o"], "in the account's order")
        #expect(merged.selected == "h")
        let hermes = merged.agents[2], openClaw = merged.agents[3], varys = merged.agents[1]
        #expect(hermes.name == "brokk")
        #expect(hermes.settings["baseUrl"] == .string("https://brokk/v1"))
        #expect(hermes.settings["model"] == .string("a::b"), "what the account doesn't say stays as it was")
        #expect(openClaw.name == "Home OpenClaw")
        #expect(openClaw.settings == ["url": .string("wss://home"), "model": .string("main")], "an OpenClaw pairing is this iPhone's")
        #expect(varys.name == "varys at home" && varys.avatar == "data:image/png;base64,AAAA")
        #expect(varys.settings["mutedRoutines"] == .string("r1"))
        #expect(varys.settings["address"] == .string("https://v"), "varys's pairing is this iPhone's")
        #expect(merged.agents[0].settings == ["runtimeMode": .string("full-access")])
        #expect(merged.synced != account.synced, "what this iPhone had that the account didn't (brokk's model) goes to it")
        #expect(merged.merged(with: merged.synced).synced == merged.synced, "once it has, there's nothing more to tell")
    }

    @Test func aRemovalIsForGoodOnEitherSide() {
        let mine = AgentList(selected: "h1", agents: [entry("h1", "hermes", "brokk"), entry("h2", "hermes", "rata")], removed: ["o1"])
        let account = AgentList(selected: "h1", agents: [entry("h2", "hermes", "rata"), entry("o1", "openclaw", "Old gateway")], removed: ["h1"])
        let merged = mine.merged(with: account)
        #expect(merged.agents.map(\.id) == ["h2"], "removed here, the account's copy doesn't bring it back; removed there, it goes here")
        #expect(Set(merged.removed) == ["o1", "h1"])
        #expect(merged.selected == nil, "the chosen agent was removed")
        // The account later lists one again: still removed.
        let later = merged.merged(with: AgentList(agents: [entry("h1", "hermes", "brokk"), entry("h2", "hermes", "rata")]))
        #expect(later.agents.map(\.id) == ["h2"])
        #expect(later.synced != AgentList(agents: [entry("h1", "hermes", "brokk"), entry("h2", "hermes", "rata")]), "the removals go back to the account")
    }

    @Test func anAgentAddedHereBeforeItSyncedStaysAndGoesToTheAccount() {
        let mine = AgentList(selected: "new", agents: [entry("new", "hermes", "Hermes 2", ["baseUrl": .string("https://rata/v1")])])
        let account = AgentList(selected: "h", agents: [entry("h", "hermes", "brokk")])
        let merged = mine.merged(with: account)
        #expect(merged.agents.map(\.id) == ["h", "new"])
        #expect(merged.selected == "h", "the account's choice, as it names an agent")
        #expect(merged.synced != account.synced, "so it's written to the account")
        // Nothing in the account yet (or only the old shape): this iPhone's list is the account's to be.
        #expect(mine.merged(with: AgentList()).agents.map(\.id) == ["new"])
        #expect(mine.merged(with: AgentList()).selected == "new")
    }

    @Test func agentKeysComeInByAgentAndGoOutForTheHermesAgentsHere() throws {
        let saved = UserDefaults.standard.data(forKey: "agents")
        Keychain.memory = [:]
        defer {
            UserDefaults.standard.set(saved, forKey: "agents")
            Keychain.memory = nil
        }
        UserDefaults.standard.removeObject(forKey: "agents")
        let agents = Agents()
        var told: [String] = []
        agents.onChange = { told.append($0) }
        let brokk = "test-\(UUID().uuidString.lowercased())", gateway = "test-\(UUID().uuidString.lowercased())"
        let section = AgentList(selected: brokk, agents: [
            entry(brokk, "hermes", "brokk", ["baseUrl": .string("https://brokk.invalid/v1")]),
            entry(gateway, "openclaw", "Home"),
        ]).json
        agents.apply(assistant: section, ui: [:], agentKeys: [brokk: "sk-brokk", "elsewhere": "sk-other"])
        let hermes = try #require(agents.agent(brokk))
        #expect(hermes.secret("key") == "sk-brokk")
        #expect(agents.agentKeys == [brokk: "sk-brokk"])
        #expect(told.contains("agentKeys"), "a key for an agent that isn't here leaves the account's map")
        #expect(agents.selected == brokk)

        told = []
        agents.remove(hermes)
        #expect(hermes.secret("key") == nil, "its key goes with it")
        #expect(agents.agent(brokk) == nil && agents.removed.contains(brokk))
        #expect(told == ["assistant", "agentKeys"])
        #expect(agents.agentKeys.isEmpty)
        #expect(agents.selected == nil)
        // The account still listing it doesn't bring it back.
        agents.apply(assistant: section, ui: [:], agentKeys: [brokk: "sk-brokk"])
        #expect(agents.agent(brokk) == nil)
        #expect(agents.agent(gateway) != nil)
        agents.remove(agents.agent(gateway)!)
    }

    @Test func aNewAgentIsNamedForItsKind() {
        let saved = UserDefaults.standard.data(forKey: "agents")
        defer { UserDefaults.standard.set(saved, forKey: "agents") }
        UserDefaults.standard.removeObject(forKey: "agents")
        let agents = Agents()
        let first = agents.add(.hermes), second = agents.add(.hermes), varys = agents.add(.varys)
        #expect([first.name, second.name, varys.name] == ["Hermes", "Hermes 2", "varys"])
        #expect(agents.selected == first.id, "the first is where new chats start")
        agents.rename(second, to: "  rata  ")
        #expect(second.name == "rata")
        agents.rename(second, to: "   ")
        #expect(second.name == "rata")
        agents.setAvatar(second, "https://example.com/rata.png")
        #expect(second.avatar == nil, "a picture is a data URL")
        for agent in [first, second, varys] { agents.remove(agent) }
    }

    @Test func anOpenClawGatewaysAgentsAreThereBeforeItAnswers() throws {
        let gateway = Agent(entry("test-\(UUID().uuidString.lowercased())", "openclaw", "Home"))
        defer { gateway.forgetSecrets() }
        gateway.keep(gatewayAgents: [OpenClaw.GatewayAgent(id: "main", name: "Rowan", isDefault: true, emoji: "🦊", avatar: "data:image/png;base64,AAAA")])

        let again = Agent(gateway.entry)
        #expect(again.models.map(\.name) == ["Rowan"])
        #expect(again.faces["main"]?.avatar == "data:image/png;base64,AAAA")
        #expect(again.faces["main"]?.emoji == "🦊")
        // Another gateway has its own.
        #expect(Agent(entry("test-other", "openclaw", "Work")).models.isEmpty)
    }

    @Test func aChatGoesToItsAgentById() {
        let agents = Agents()
        agents.startDemo()
        let store = ChatStore(agents: agents)
        store.replace(chats: [])
        let chat = store.newChat()
        #expect(store.chat(chat)?.provider == DemoAgent.brokk, "a new chat starts on the chosen agent")
        store.setAgent(DemoAgent.rata, of: chat)
        store.send("Hello", in: chat)
        let run = store.runs[chat]!
        #expect(run.provider == DemoAgent.rata)
        store.apply(.error("unreachable"), requestId: run.requestId, chatId: chat)
        #expect(store.chat(chat)?.turns.last?.error == "Can't reach rata. Are you on Tailscale?")
        #expect(agents.name(of: store.chat(chat)!) == "rata")

        // A chat named by a kind (from before agents had ids), or by an agent since removed, has no agent here.
        var old = Chat(provider: "hermes")
        old.turns = [ChatTurn(id: "u-1", role: .user, text: "Hi", now: 1)]
        #expect(agents.agent(old.provider) == nil && !agents.isUsable(old.provider))
        #expect(agents.name(of: old) == "Agent")
        // A Mac's Codex chat reads here by the account's name for it.
        var mac = Chat(provider: DemoAgent.codex)
        mac.device = Chat.Device(id: "mac", name: "Chris's MacBook Pro")
        #expect(mac.isElsewhere && agents.name(of: mac) == "Codex")
        // An OpenClaw gateway's own agent names a chat it runs.
        var molty = Chat(provider: DemoAgent.openClaw)
        molty.sessionId = "agent:research:otter-mail:1"
        #expect(agents.gatewayAgent(of: molty) == "research" && agents.name(of: molty) == "Scout")
    }

    @Test func aDeliveredChatHasTheIdEveryDeviceGivesIt() {
        #expect(ChatStore.deliveredId(agent: "6f2c1d", session: "agent:main:otter-mail:x") == "6f2c1d-agent-main-otter-mail-x")
        let long = ChatStore.deliveredId(agent: "6f2c1d0e-0000-4000-8000-000000000001", session: "20261113_120000_abcdef0123456789")
        #expect(long.count == 64 && long.hasPrefix("6f2c1d0e-0000-4000-8000-000000000001-2026"))
    }

    @Test func aHermesServerListsOttersOwnSessionsUnlessAskedForAll() async throws {
        URLProtocol.registerClass(HermesStub.self)
        defer { URLProtocol.unregisterClass(HermesStub.self) }
        let hermes = Hermes(baseURL: "https://hermes.stub/v1", key: "k")

        let own = try await hermes.sessions(limit: 3)
        #expect(own.map(\.id) == ["delivered-new", "started-new", "started-old"], "Otter's and its plugin's, newest first")
        let all = try await hermes.sessions(limit: 3, everywhere: true)
        #expect(all.map(\.id) == ["slack-dm"])
        #expect(HermesStub.asked.withLock { Set($0) } == ["source=api_server&limit=3", "source=otter&limit=3", "limit=3"])
    }
}

/** A Hermes server's `/api/sessions`, by source: Otter's own (`api_server`), its plugin's (`otter`), and a teammate's Slack DM. */
nonisolated private final class HermesStub: URLProtocol {
    static let asked = Mutex<[String]>([])

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host() == "hermes.stub" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let query = request.url?.query() ?? ""
        Self.asked.withLock { $0.append(query) }
        let rows: [[String: Any]] = switch query {
        case "source=api_server&limit=3": [["id": "started-new", "last_active": 300], ["id": "started-old", "last_active": 100]]
        case "source=otter&limit=3": [["id": "delivered-new", "last_active": 400], ["id": "delivered-oldest", "last_active": 50]]
        default: [["id": "slack-dm", "last_active": 500]]
        }
        let data = try! JSONSerialization.data(withJSONObject: ["data": rows])
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
