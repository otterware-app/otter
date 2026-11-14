import Foundation
import Testing
@testable import Otter_Agents

/** The account's agents and chats as entries (contracts' agent-sync.ts), and two devices keeping them through a relay (core's agent-sync.test.ts). */
@MainActor
@Suite(.serialized)
struct AgentSyncTests {
    private func turn(_ id: String, _ text: String = "") -> JSON { .object(["id": .string(id), "role": "user", "text": .string(text)]) }
    private func newChat(_ id: String, title: String = "Plan the offsite") -> JSON {
        AgentMutation.setChat(["id": .string(id), "title": .string(title), "provider": "hermes-1", "createdAt": .number(1), "updatedAt": .number(10)])
    }
    private func ids(_ copy: AgentCopy, _ chat: String) -> [String] { copy.turns(of: chat).compactMap { $0["id"]?.string } }

    // MARK: Mutations

    @Test func turnsWrittenElsewhereKeepTheirPlace() {
        let copy = AgentCopy(directory: nil)
        for mutation in [newChat("c"), AgentMutation.turns("c", put: [turn("u1"), turn("a1")], order: ["u1", "a1"]),
                         // Another device adds x after a1; this one, not knowing of it, adds u2.
                         AgentMutation.turns("c", put: [turn("x")], order: ["u1", "a1", "x"]),
                         AgentMutation.turns("c", put: [turn("u2")], order: ["u1", "a1", "u2"])] {
            AgentEntries.apply(mutation, to: copy)
        }
        #expect(ids(copy, "c") == ["u1", "a1", "x", "u2"])

        AgentEntries.apply(AgentMutation.turns("c", put: [], order: ["u1", "u2"], removed: ["a1"]), to: copy)
        #expect(ids(copy, "c") == ["u1", "x", "u2"], "what followed a turn removed follows the one before it")
        #expect(copy.get("turn/c/a1") == .null)
    }

    @Test func aChatDeletedStaysGone() {
        let copy = AgentCopy(directory: nil)
        AgentEntries.apply(AgentMutation.setChat(["id": "n", "title": "no provider"]), to: copy)
        #expect(copy.get("chat/n") == nil, "a new chat needs its agent and when it was made")

        AgentEntries.apply(newChat("c"), to: copy)
        AgentEntries.apply(AgentMutation.turns("c", put: [turn("u1")], order: ["u1"]), to: copy)
        AgentEntries.apply(AgentMutation.deleteChat("c"), to: copy)
        #expect(copy.get("chat/c") == .null && copy.turnKeys("c").isEmpty)
        AgentEntries.apply(newChat("c", title: "Still going"), to: copy)
        AgentEntries.apply(AgentMutation.turns("c", put: [turn("u2")], order: ["u2"]), to: copy)
        #expect(copy.get("chat/c") == .null && copy.turnKeys("c").isEmpty)
    }

    @Test func anAgentsSettingsMergeAndItsRemovalTakesAllOfIt() throws {
        Keychain.memory = [:]
        defer { Keychain.memory = nil }
        let copy = AgentCopy(directory: nil)
        let picture = "data:image/png;base64,AAAA"
        AgentEntries.apply(AgentMutation.setAgent("h", kind: "hermes", settings: ["x": true]), to: copy)
        #expect(copy.get("agent/h") == nil, "a new agent needs its name")
        for mutation in [AgentMutation.setAgent("h", kind: "hermes", name: "brokk", avatar: .string(picture), settings: ["baseUrl": "x", "enabled": true], addedAt: 3),
                         AgentMutation.setAgent("h", kind: "hermes", settings: ["enabled": false], addedAt: 9),
                         AgentMutation.device("h", device: "phone", settings: ["path": "/a"]),
                         AgentMutation.secret("h", "key", "sk-brokk"),
                         AgentMutation.select("h")] {
            AgentEntries.apply(mutation, to: copy)
        }
        let agent = try #require(AgentEntry(copy.get("agent/h")!, device: copy.get("agent-device/h/phone")))
        #expect(agent.name == "brokk" && agent.avatar == picture && agent.addedAt == 3)
        #expect(agent.settings == ["baseUrl": "x", "enabled": false, "path": "/a"])
        #expect(copy.get("secret/h/key") == true, "the copy marks the secret")
        #expect(Keychain.get("agent:h:key") == "sk-brokk")
        AgentEntries.apply(AgentMutation.setAgent("h", kind: "hermes", avatar: .null), to: copy)
        #expect(copy.get("agent/h")?["avatar"] == nil)

        AgentEntries.apply(AgentMutation.removeAgent("h"), to: copy)
        for key in ["agent/h", "agent-device/h/phone", "secret/h/key", "selected"] { #expect(copy.get(key) == .null, "\(key)") }
        #expect(Keychain.get("agent:h:key") == nil)
        AgentEntries.apply(AgentMutation.setAgent("h", kind: "hermes", name: "brokk"), to: copy)
        #expect(copy.get("agent/h") == .null)
    }

    @Test func aTurnTooBigGivesUpItsOutputsFirst() {
        let steps = (0..<300).map { _ in JSON.object(["kind": "step", "step": .object(["kind": "command", "title": "ls"]), "output": .string(String(repeating: "x", count: 5000))]) }
        let fitted = AgentEntries.fitTurn(.object(["id": "a1", "role": "assistant", "text": "Done", "items": .array(steps)]))
        #expect(fitted["items"]?.array?.first?["output"]?.string?.count == 2001)
        #expect(fitted["text"] == "Done")
        #expect(AgentEntries.bytes(fitted) <= 1_000_000)
        let small: JSON = .object(["id": "a2", "role": "assistant", "text": "Hi"])
        #expect(AgentEntries.fitTurn(small) == small)
    }

    @Test func importedTurnsKeepWhatTheAccountHas() {
        let copy = AgentCopy(directory: nil)
        let clipped = String(repeating: "x", count: 2000), whole = String(repeating: "x", count: 5000)
        func answer(_ text: String, output: String, thumb: String?) -> JSON {
            var picture: [String: JSON] = ["name": "plan.png", "mimeType": "image/png"]
            picture["thumb"] = thumb.map(JSON.string)
            return .object(["id": "a1", "role": "assistant", "text": .string(text), "attachments": .array([.object(picture)]),
                            "items": .array([.object(["kind": "step", "step": .object(["kind": "command", "title": "ls"]), "output": .string(output)])])])
        }
        for mutation in [newChat("c"), AgentMutation.turns("c", put: [turn("u1"), answer("Edited elsewhere", output: "\(clipped)…", thumb: nil), turn("u2")], order: ["u1", "a1", "u2"]),
                         AgentMutation.turns("c", put: [], order: ["u1", "a1"], removed: ["u2"]),
                         AgentMutation.turns("c", put: [turn("u1", "kept here"), answer("As it was", output: whole, thumb: "data:image/png;base64,AAAA"), turn("u2"), turn("u3")],
                                             order: ["u1", "a1", "u2", "u3"], imported: true)] {
            AgentEntries.apply(mutation, to: copy)
        }
        let a1 = copy.get("turn/c/a1")?["turn"]
        #expect(copy.get("turn/c/u1")?["turn"]?["text"] == "", "a turn the account has keeps its content")
        #expect(a1?["text"] == "Edited elsewhere")
        #expect(a1?["items"]?.array?.first?["output"]?.string == whole, "what the old copy cut comes back")
        #expect(a1?["attachments"]?.array?.first?["thumb"] == "data:image/png;base64,AAAA")
        #expect(copy.get("turn/c/u2") == .null, "a turn removed stays removed")
        #expect(ids(copy, "c") == ["u1", "a1", "u3"])
    }

    @Test func partsOfAnUploadStayParts() {
        let phone = AgentSync()
        let big = { (id: String) in self.turn(id, String(repeating: "x", count: 600_000)) }
        phone.mutate([newChat("c"), AgentMutation.turns("c", put: [big("t1"), big("t2")], order: ["t1", "t2"])], delay: .seconds(60))
        #expect(phone.outbox.count == 3, "joined, the parts would be more than the relay takes")
        phone.mutate([AgentMutation.turns("c", put: [turn("t3")], order: ["t1", "t2", "t3"])], delay: .seconds(60))
        #expect(phone.outbox.count == 3, "a small change still joins the last")
        phone.mutate([AgentMutation.turns("c", put: [turn("t4")], order: ["t1", "t2", "t3", "t4"], imported: true)], delay: .seconds(60))
        #expect(phone.outbox.count == 4, "an import joins nothing")
        phone.mutate([newChat("d"), AgentMutation.turns("d", put: [turn("d1")], order: ["d1"], imported: true),
                      AgentMutation.turns("d", put: [turn("d2")], order: ["d1", "d2"])], delay: .seconds(60))
        #expect(phone.outbox.count == 7, "and nothing joins it")
    }

    // MARK: Two devices

    private func signedIn() -> Relay {
        TestRelay.shared.reset()
        Keychain.memory = ["otter-session": "test"]
        return Relay()
    }

    @Test func anotherDeviceGetsAChatWholeAndItsTurnsInOrder() async throws {
        URLProtocol.registerClass(RelayStub.self)
        defer {
            URLProtocol.unregisterClass(RelayStub.self)
            Keychain.memory = nil
        }
        let relay = signedIn()
        let phone = AgentSync(relay: relay), other = AgentSync(relay: relay)
        let store = ChatStore(agents: Agents())
        let chats = ChatSync(store: store, sync: phone)
        var chat = Chat(provider: "hermes-1", now: 1)
        chat.title = "Plan the offsite"
        chat.turns = (0..<150).map { index in
            var turn = ChatTurn(id: "t-\(index)", role: index % 2 == 0 ? .user : .assistant, text: "message \(index)", now: index)
            turn.items = [.step(id: nil, ChatStep(kind: "command", title: "ls"), output: String(repeating: "x", count: 6000))]
            return turn
        }
        store.insert(chat)
        chats.changed(chat.id, settled: true)
        try await Task.sleep(for: .milliseconds(150))
        await phone.sync()

        await other.sync()
        let elsewhere = ChatStore(agents: Agents())
        let otherChats = ChatSync(store: elsewhere, sync: other)
        #expect(elsewhere.chat(chat.id)?.loaded == false, "the list opens without turns")
        otherChats.load(chat.id)
        #expect(elsewhere.chat(chat.id)?.json == store.chat(chat.id)?.json, "every turn as it was written")

        // A turn added here reaches the other device's open chat.
        store.update(chat.id) { $0.turns.append(ChatTurn(id: "t-150", role: .user, text: "one more", now: 150)) }
        chats.changed(chat.id, settled: true)
        try await Task.sleep(for: .milliseconds(150))
        await phone.sync()
        other.onChange = { otherChats.heard($0) }
        await other.sync()
        #expect(elsewhere.chat(chat.id)?.turns.last?.text == "one more")
        #expect(elsewhere.chat(chat.id)?.turns.count == 151)
    }

    @Test func twoDevicesChangingAChatApartEndTheSame() async {
        URLProtocol.registerClass(RelayStub.self)
        defer {
            URLProtocol.unregisterClass(RelayStub.self)
            Keychain.memory = nil
        }
        let relay = signedIn()
        let phone = AgentSync(relay: relay), mac = AgentSync(relay: relay)
        phone.mutate([newChat("c1"), AgentMutation.turns("c1", put: [turn("u-1", "Find a venue")], order: ["u-1"])], delay: .seconds(60))
        await phone.sync()
        await mac.sync()

        phone.mutate([AgentMutation.setChat(["id": "c1", "title": "Offsite in May", "updatedAt": .number(20)])], delay: .seconds(60))
        mac.mutate([AgentMutation.setChat(["id": "c1", "pinnedAt": .number(30), "updatedAt": .number(30)]),
                    AgentMutation.turns("c1", put: [turn("a-1", "Cedar Hall")], order: ["u-1", "a-1"])], delay: .seconds(60))
        #expect(phone.copy.get("chat/c1")?["title"] == "Offsite in May", "each shows its own change at once")
        await phone.sync()
        await mac.sync()
        await phone.sync()
        for copy in [phone.copy, mac.copy] {
            #expect(copy.get("chat/c1")?["title"] == "Offsite in May" && copy.get("chat/c1")?["pinnedAt"] == .number(30))
            #expect(ids(copy, "c1") == ["u-1", "a-1"])
        }
    }

    @Test func aStreamingTurnGoesAsItsLatest() async {
        URLProtocol.registerClass(RelayStub.self)
        defer {
            URLProtocol.unregisterClass(RelayStub.self)
            Keychain.memory = nil
        }
        let relay = signedIn()
        let phone = AgentSync(relay: relay)
        phone.mutate([newChat("c1"), AgentMutation.turns("c1", put: [turn("u-1")], order: ["u-1"])], delay: .seconds(60))
        await phone.sync()
        let sent = TestRelay.shared.applied
        for words in 1...20 {
            phone.mutate([AgentMutation.turns("c1", put: [turn("a-1", String(repeating: "word ", count: words))], order: ["u-1", "a-1"])], delay: .seconds(60))
        }
        await phone.sync()
        #expect(TestRelay.shared.applied - sent == 1)
        #expect(TestRelay.shared.get("turn/c1/a-1")?["turn"]?["text"]?.string == String(repeating: "word ", count: 20))
    }

    @Test func agentsAndTheirKeysFollowTheAccountButNotAnotherDevicesOwn() async throws {
        URLProtocol.registerClass(RelayStub.self)
        defer {
            URLProtocol.unregisterClass(RelayStub.self)
            Keychain.memory = nil
        }
        let relay = signedIn()
        let phone = AgentSync(relay: relay)
        let agents = Agents()
        agents.use(phone)
        let hermes = agents.add(.hermes)
        agents.setSecret(hermes, "key", "sk-brokk")
        agents.set(hermes, "baseUrl", .string("https://brokk.invalid/v1"))
        let varys = agents.add(.varys)
        agents.set(varys, "address", .string("https://mine.invalid"))
        agents.setSecret(varys, Varys.tokenName, "grant-for-this-iphone")
        AgentEntries.apply(AgentMutation.device(varys.id, device: "another-device", settings: ["address": "https://theirs.invalid"]), to: TestRelay.shared)
        await phone.sync()
        #expect(TestRelay.shared.get("agent/\(varys.id)")?["settings"]?["address"] == nil, "varys's address is each device's own")
        #expect(TestRelay.shared.get("secret/\(varys.id)/token") == nil, "and so is its grant")

        // Another iPhone of the account, with its own Keychain.
        Keychain.memory = ["otter-session": "test"]
        let other = AgentSync(relay: relay)
        let elsewhere = Agents()
        elsewhere.use(other)
        other.onChange = { elsewhere.heard($0) }
        await other.sync()
        #expect(elsewhere.all.map(\.name) == ["Hermes", "varys"])
        #expect(elsewhere.selected == hermes.id)
        #expect(Keychain.get("agent:\(hermes.id):key") == "sk-brokk")
        #expect(elsewhere.agent(varys.id)?.string("address") != "https://theirs.invalid", "another device's own settings stay its own")

        // Removed there, gone here, with its key.
        elsewhere.remove(try #require(elsewhere.agent(hermes.id)))
        await other.sync()
        Keychain.memory?["agent:\(hermes.id):key"] = "sk-brokk"
        phone.onChange = { agents.heard($0) }
        await phone.sync()
        #expect(agents.agent(hermes.id) == nil && agents.all.map(\.id) == [varys.id])
        #expect(Keychain.get("agent:\(hermes.id):key") == nil)
    }

    @Test func aChangeJoinedAfterAnAnswerLostStillGoes() async {
        URLProtocol.registerClass(RelayStub.self)
        defer {
            URLProtocol.unregisterClass(RelayStub.self)
            Keychain.memory = nil
        }
        let relay = signedIn()
        let phone = AgentSync(relay: relay)
        phone.mutate([newChat("c1"), AgentMutation.turns("c1", put: [turn("a-1", "Cedar")], order: ["a-1"])], delay: .seconds(60))
        TestRelay.shared.loseAnswer = true
        await phone.sync()
        #expect(TestRelay.shared.get("turn/c1/a-1")?["turn"]?["text"] == "Cedar", "the relay applied it, but its answer was lost")

        phone.mutate([AgentMutation.turns("c1", put: [turn("a-1", "Cedar Hall")], order: ["a-1"])], delay: .seconds(60))
        await phone.sync()
        #expect(TestRelay.shared.get("turn/c1/a-1")?["turn"]?["text"] == "Cedar Hall")
    }

    @Test func whatThisIPhoneKeptBeforeGoesToTheAccountOnce() throws {
        Keychain.memory = [:]
        let user = "import-\(UUID().uuidString)"
        let folder = AgentSync.folder(user)
        let defaults = UserDefaults.standard
        let cache = URL.applicationSupportDirectory.appending(path: "Chats/\(folder)", directoryHint: .isDirectory)
        defer {
            Keychain.memory = nil
            try? FileManager.default.removeItem(at: cache)
            for key in ["agents", "chat-pending:\(folder)", "chat-deleted:\(folder)"] { defaults.removeObject(forKey: key) }
        }
        let list: JSON = .object([
            "selected": "o",
            "agents": .array([
                .object(["id": "h", "kind": "hermes", "name": "brokk", "settings": .object(["baseUrl": "https://brokk.invalid/v1"])]),
                .object(["id": "o", "kind": "openclaw", "name": "OpenClaw", "settings": .object(["url": "wss://claw.invalid"])]),
                .object(["id": "v", "kind": "varys", "name": "varys", "settings": .object(["address": "https://mine.invalid", "enabled": true])]),
            ]),
            "removed": .array(["gone"]),
        ])
        defaults.set(list.data, forKey: "agents")
        Keychain.set("agent:h:key", "sk-brokk")
        Keychain.set("agent:v:token", "grant-for-this-iphone")
        try FileManager.default.createDirectory(at: cache, withIntermediateDirectories: true)
        var chat = Chat(provider: "h", now: 1)
        chat.title = "Plan the offsite"
        chat.turns = [ChatTurn(id: "u-1", role: .user, text: "Find a venue", now: 1)]
        try chat.json.data.write(to: cache.appending(path: "\(chat.id).json"))
        try JSON.array([]).data.write(to: cache.appending(path: "list.json"))
        defaults.set(["deleted-here"], forKey: "chat-deleted:\(folder)")

        let phone = AgentSync()
        phone.mutate([newChat("deleted-here")], delay: .seconds(60))
        phone.importLocalData(user: user)
        let copy = phone.copy
        #expect(copy.get("agent/h")?["settings"]?["baseUrl"] == "https://brokk.invalid/v1")
        #expect(copy.get("agent/o")?["settings"]?["url"] == "wss://claw.invalid", "OpenClaw's settings, this iPhone's alone before, go to the account")
        #expect(copy.get("agent/v")?["settings"]?["address"] == nil && copy.get("agent-device/v/\(phone.device)")?["address"] == "https://mine.invalid")
        #expect(copy.get("agent/h")?["addedAt"] == .number(0) && copy.get("agent/v")?["addedAt"] == .number(2))
        #expect(copy.get("secret/h/key") == true && copy.get("secret/v/token") == nil)
        #expect(copy.get("agent/gone") == .null && copy.get("selected") == "o")
        #expect(copy.get("chat/\(chat.id)")?["title"] == "Plan the offsite" && copy.get("chat/\(chat.id)")?["turns"] == nil)
        #expect(ids(copy, chat.id) == ["u-1"])
        #expect(copy.get("chat/deleted-here") == .null)
        #expect(!FileManager.default.fileExists(atPath: cache.path(percentEncoded: false)) && defaults.data(forKey: "agents") == nil)
        #expect(defaults.stringArray(forKey: "chat-deleted:\(folder)") == nil)

        let sent = phone.outbox.count
        phone.importLocalData(user: user)
        #expect(phone.outbox.count == sent, "once")
    }

    @Test func aChangeTheRelayRefusesIsDroppedAndTheRestGoes() async {
        URLProtocol.registerClass(RelayStub.self)
        defer {
            URLProtocol.unregisterClass(RelayStub.self)
            Keychain.memory = nil
        }
        let relay = signedIn()
        let phone = AgentSync(relay: relay)
        phone.mutate([newChat("c1"), newChat("c2", title: "refused"), newChat("c3")], delay: .seconds(60))
        #expect(phone.copy.get("chat/c2") != nil)
        await phone.sync()
        #expect(TestRelay.shared.get("chat/c1") != nil && TestRelay.shared.get("chat/c3") != nil)
        #expect(TestRelay.shared.get("chat/c2") == nil)
        #expect(phone.copy.get("chat/c2") == nil, "what it did here goes too")
        #expect(phone.copy.get("chat/c3")?["title"] == "Plan the offsite")
    }
}

/** The relay, as infra/relay keeps the entries: each numbered by the write that last changed it, a page at a time. */
final class TestRelay: AgentStore {
    static let shared = TestRelay()
    private var entries: [String: (version: Int, value: JSON)] = [:]
    private var head = 0
    private var clients: [String: Int] = [:]
    /** Mutations applied. */
    private(set) var applied = 0
    /** The next request is applied, but its answer never comes back. */
    var loseAnswer = false

    func reset() {
        entries = [:]
        head = 0
        clients = [:]
        applied = 0
        loseAnswer = false
    }

    func get(_ key: String) -> JSON? { entries[key]?.value }
    func set(_ key: String, _ value: JSON) {
        head += 1
        entries[key] = (head, value)
    }
    func turnKeys(_ chat: String) -> [String] { entries.keys.filter { $0.hasPrefix("turn/\(chat)/") } }
    func removeTurns(_ chat: String) { for key in turnKeys(chat) { entries[key] = nil } }
    func deviceKeys(_ agent: String) -> [String] { entries.keys.filter { $0.hasPrefix("agent-device/\(agent)/") } }
    func secretKeys(_ agent: String) -> [String] { entries.keys.filter { $0.hasPrefix("secret/\(agent)/") } }

    /** A chat titled "refused" is one it can't take: the whole request is refused, as its validation does. */
    func answer(_ request: JSON) -> (status: Int, body: JSON) {
        let client = request["client"]?.string ?? ""
        let mutations = request["mutations"]?.array ?? []
        if mutations.contains(where: { $0["mutation"]?["chat"]?["title"] == "refused" }) { return (400, .object(["error": "Invalid."])) }
        let last = clients[client] ?? 0
        for row in mutations where (row["id"]?.count ?? 0) > last {
            AgentEntries.apply(row["mutation"] ?? .null, to: self)
            applied += 1
        }
        clients[client] = max(last, mutations.compactMap { $0["id"]?.count }.max() ?? 0)
        if loseAnswer {
            loseAnswer = false
            return (503, .object(["error": "Lost."]))
        }
        let since = request["since"]?.count ?? 0
        let newer = entries.filter { $0.value.version > since }.sorted { $0.value.version < $1.value.version }
        let page = newer.prefix(3)
        let more = page.count < newer.count
        return (200, .object([
            "version": .number(Double(more ? page.last!.value.version : head)),
            "lastMutationId": .number(Double(clients[client] ?? 0)),
            "changes": .array(page.map { .object(["key": .string($0.key), "value": $0.value.value]) }),
            "more": .bool(more),
        ]))
    }
}

/** `/v1/agent-sync`, answered by `TestRelay`. */
nonisolated private final class RelayStub: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.path() == "/v1/agent-sync" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var body = request.httpBody ?? Data()
        if body.isEmpty, let stream = request.httpBodyStream {
            stream.open()
            var buffer = [UInt8](repeating: 0, count: 65_536)
            while stream.hasBytesAvailable {
                let read = stream.read(&buffer, maxLength: buffer.count)
                if read <= 0 { break }
                body.append(buffer, count: read)
            }
            stream.close()
        }
        let request = (try? JSON(parsing: body)) ?? .null
        nonisolated(unsafe) let stub = self
        DispatchQueue.main.async {
            let (status, answer) = MainActor.assumeIsolated { TestRelay.shared.answer(request) }
            stub.client?.urlProtocol(stub, didReceive: HTTPURLResponse(url: stub.request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!,
                                     cacheStoragePolicy: .notAllowed)
            stub.client?.urlProtocol(stub, didLoad: answer.data)
            stub.client?.urlProtocolDidFinishLoading(stub)
        }
    }

    override func stopLoading() {}
}
