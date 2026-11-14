import Foundation
import Synchronization
import Testing
@testable import Otter_Agents

/** The agents you added, as the account and this iPhone keep them (core's service.ts tests, for the phone's port). */
@MainActor
struct AgentsTests {
    @Test func disabledGatewayAgentsStayResolvedButCannotRunChats() throws {
        let agents = Agents()
        agents.startDemo()
        let gateway = try #require(agents.agent(DemoAgent.openClaw))
        agents.select(gateway)
        agents.set(gateway, "model", .string("research"))
        var existing = Chat(provider: gateway.id)
        existing.sessionId = "agent:research:otter-mail:existing"
        #expect(agents.isUsable(existing))

        agents.setGatewayAgentEnabled(gateway, "research", false)
        #expect(gateway.models.map(\.slug) == ["main", "research"])
        #expect(gateway.enabledModels.map(\.slug) == ["main"])
        #expect(gateway.model?.slug == "main")
        #expect(!agents.isUsable(existing))
        #expect(!Agent(gateway.entry).isGatewayAgentEnabled("research"))
        #expect(agents.sync.copy.get(AgentEntries.agentKey(gateway.id))?["settings"]?["disabledAgents"] == .array(["research"]), "the demo's agents change as yours do")

        agents.setGatewayAgentEnabled(gateway, "main", false)
        #expect(!gateway.canStartChat)
        #expect(agents.starting?.id != gateway.id)
        agents.setGatewayAgentEnabled(gateway, "research", true)
        #expect(gateway.canStartChat && agents.isUsable(existing))
        #expect(gateway.model?.slug == "research")
    }

    private func entry(_ id: String, _ kind: String, _ name: String) -> AgentEntry {
        AgentEntry(id: id, kind: kind, name: name)
    }

    @Test func aNewAgentIsNamedForItsKind() {
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
        #expect(agents.all.map(\.id) == [first.id, second.id, varys.id], "in the order they were added")
        agents.remove(first)
        #expect(agents.all.map(\.id) == [second.id, varys.id])
        #expect(agents.selected == nil, "the chosen agent was removed")
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
