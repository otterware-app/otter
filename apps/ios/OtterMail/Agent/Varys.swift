import Foundation

/**
 * The user's varys agent, reached with this iPhone's app grant, as the Mac and the web reach it
 * through varys's SDK (`extensions/varys`): commands over HTTP, the threads and their inbox over
 * one Live socket (`VarysLive.swift`), and a turn read from them (`VarysTurns.swift`).
 *
 * Every request goes to the address the iPhone paired with, without cookies, refusing a
 * redirect, and names the agent's id; before a credential goes there, the address must answer
 * as that agent at `/.well-known/varys`. A command carries a request id and is done once per id:
 * one that got no answer is looked up by its receipt before it's sent again.
 */
final class Varys {
    nonisolated struct Failure: LocalizedError {
        var code: String
        var message: String
        var errorDescription: String? { message }

        static let unreachable = Failure(code: "unreachable", message: "varys doesn't answer. Try again once it's reachable.")
        static let signedOut = Failure(code: "signed_out", message: "varys revoked this iPhone's access. Pair it again with a new code.")
    }

    /** What pairing gives this iPhone to keep: the token is shown only this once. */
    struct Pairing {
        var address: String
        var agentId: String
        var token: String
        var actsAs: String?
        var scopes: [String]
    }

    struct Me {
        var name: String
        var actsAs: String?
        var scopes: [String]
    }

    struct Thread {
        var id: String
        var title: String
        /** The routine that made the thread (one of its runs, or where it reports), by its name. */
        var routine: String?
        var preview: String?
        var status: String
        var updatedAt: Date
    }

    nonisolated struct Step: Equatable {
        var id: String
        var name: String
        var output: String?
    }

    nonisolated struct Reply: Equatable {
        var text = ""
        var steps: [Step] = []
    }

    struct Approval: Equatable {
        var id: String
        var title: String
        var detail: String?
        var why: String?
        /** Whether varys offers to allow it for the rest of the thread. */
        var inThread: Bool
    }

    struct Question: Equatable {
        var id: String
        var text: String
        var deadline: Date?
    }

    /** A turn as Otter shows it: the reply so far, what it asks, and how it ended. */
    enum Event {
        case reply(Reply)
        case approval(Approval)
        case question(Question)
        case resolved(String)
        case done
        case stopped
        case failed(String)
        /** It couldn't be followed now (varys didn't answer): it's picked up again later. */
        case detached
    }

    enum Status: Equatable {
        case idle
        case connecting
        case open
        case offline
        case refused(String)
    }

    /** What Otter needs its grant to do: chats, and what they ask of you. */
    static let scopes = ["threads:read", "threads:write", "inbox"]
    static let tokenName = "varys-token"
    private static let readItems = 500
    private static let pingSeconds: Double = 15
    private static let pongSeconds: Double = 5
    private static let helloSeconds: Double = 10
    private static let readSeconds: Double = 20

    let address: String
    let agentId: String
    private let token: String

    init(address: String, agentId: String, token: String) {
        self.address = address
        self.agentId = agentId
        self.token = token
    }

    // MARK: Addresses and pairing

    /** The agent's origin: an HTTPS address, or plain HTTP only on this device, where nothing crosses a network. */
    nonisolated static func origin(_ address: String) -> String? {
        guard let url = URL(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme?.lowercased(), let host = url.host() else { return nil }
        let loopback = ["localhost", "127.0.0.1", "::1"].contains(host.lowercased())
        guard scheme == "https" || (scheme == "http" && loopback) else { return nil }
        return "\(scheme)://\(host.contains(":") ? "[\(host)]" : host)\(url.port.map { ":\($0)" } ?? "")"
    }

    /** A pairing link, such as `https://mac.tail.ts.net/pair#code=…&agent=…`: the agent's address, a code and its id. */
    nonisolated static func pairingLink(_ link: String) -> (address: String, code: String, agentId: String)? {
        guard let url = URL(string: link.trimmingCharacters(in: .whitespacesAndNewlines)), url.path() == "/pair",
              let fragment = url.fragment(percentEncoded: false) else { return nil }
        var fields: [String: String] = [:]
        for pair in fragment.split(separator: "&") {
            let parts = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if parts.count == 2 { fields[parts[0]] = parts[1] }
        }
        guard let code = fields["code"], !code.isEmpty, let agent = fields["agent"], !agent.isEmpty,
              let address = origin(url.absoluteString) else { return nil }
        return (address, code, agent)
    }

    /**
     * Trades varys's app code for this iPhone's grant. `installation` stays the same each time it
     * pairs, so pairing again replaces the grant it had.
     */
    static func pair(address: String, code: String, agentId: String?, name: String, installation: String) async throws -> Pairing {
        let agent = try await agent(at: address, id: agentId)
        let body: JSON = .object(["code": .string(code), "name": .string(name), "installation": .string(installation)])
        let paired = try await call("POST", address: address, path: "/pairing/app", agentId: agent, token: nil, body: body)
        guard let agentId = paired["agentId"]?.string, let token = paired["token"]?.string else { throw Failure.unreachable }
        return Pairing(address: address, agentId: agentId, token: token, actsAs: paired["grant"]?["actsAs"]?.string,
                       scopes: paired["grant"]?["scopes"]?.array?.compactMap(\.string) ?? [])
    }

    /** The agent at `address`, once it answers as `id` (any agent without one) and speaks Live's major. */
    private static func agent(at address: String, id: String?) async throws -> String {
        var request = URLRequest(url: URL(string: address + "/.well-known/varys")!)
        request.timeoutInterval = 15
        guard let (data, response) = try? await session.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200,
              let agent = try? JSON(parsing: data), let found = agent["id"]?.string else { throw Failure.unreachable }
        if let id, found != id {
            throw Failure(code: "wrong_agent", message: "\(address) doesn't answer as the agent this iPhone paired with.")
        }
        if let major = agent["protocol"]?["major"]?.count, major != Live.protocolVersion.major {
            throw Failure(code: "update_needed", message: major > Live.protocolVersion.major
                ? "This varys is newer than Otter Mail. Update Otter Mail to talk to it."
                : "This varys is older than Otter Mail. Update varys to talk to it.")
        }
        return found
    }

    // MARK: HTTP

    /** Without cookies, a cache or redirects: a credential goes only to the address it was paired with. */
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    private nonisolated final class NoRedirects: NSObject, URLSessionTaskDelegate, Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }

    private static func call(_ method: String, address: String, path: String, agentId: String, token: String?,
                             body: JSON? = nil) async throws -> JSON {
        var request = URLRequest(url: URL(string: address + "/api/v1" + path)!)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue(agentId, forHTTPHeaderField: "x-varys-agent-id")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = body.data
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: request) } catch { throw Failure.unreachable }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let value = (try? JSON(parsing: data)) ?? .null
        // A proxy answers these when the agent didn't: it may or may not have taken it.
        if status == 502 || status == 504 { throw Failure.unreachable }
        guard (200..<300).contains(status) else {
            if status == 401 { throw Failure.signedOut }
            throw Failure(code: value["code"]?.string ?? "HTTP_\(status)", message: value["message"]?.string ?? "varys refused (\(status)).")
        }
        return value
    }

    private var checked: Task<Void, Error>?

    /** Checked before the first call, and again after one got no answer: the name may point elsewhere by then. */
    private func pinned() async throws {
        if checked == nil {
            let address = address, agentId = agentId
            checked = Task { _ = try await Self.agent(at: address, id: agentId) }
        }
        do { try await checked!.value } catch {
            checked = nil
            throw error
        }
    }

    private func query(_ method: String, _ path: String, _ body: JSON? = nil) async throws -> JSON {
        try await pinned()
        do { return try await Self.call(method, address: address, path: path, agentId: agentId, token: token, body: body) } catch let failure as Failure {
            if failure.code == Failure.unreachable.code { checked = nil }
            throw failure
        }
    }

    /** Sent until the agent answers, at most twice, asking for its receipt in between. */
    @discardableResult
    private func command(_ method: String, _ path: String, _ fields: [String: JSON], requestId: String = UUID().uuidString.lowercased()) async throws -> JSON {
        var body = fields
        body["requestId"] = .string(requestId)
        for _ in 0..<2 {
            do { return try await query(method, path, .object(body)) } catch let failure as Failure where failure.code == Failure.unreachable.code {
                do { return try await query("GET", "/receipts/\(Self.segment(requestId))") } catch let looked as Failure where looked.code == "RECEIPT_NOT_FOUND" {
                    continue
                } catch { break }
            }
        }
        throw Failure(code: "outcome_unknown", message: "varys didn't answer, so it's not known whether it took this.")
    }

    private static func segment(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(["/"])) ?? id
    }

    func me() async throws -> Me {
        let me = try await query("GET", "/me")
        return Me(name: me["name"]?.string ?? "", actsAs: me["actsAs"]?.string, scopes: me["scopes"]?.array?.compactMap(\.string) ?? [])
    }

    /** Whether varys stored the command sent with this request id. */
    func received(_ requestId: String) async throws -> Bool {
        do {
            _ = try await query("GET", "/receipts/\(Self.segment(requestId))")
            return true
        } catch let failure as Failure where failure.code == "RECEIPT_NOT_FOUND" {
            return false
        }
    }

    /** Sends the user's message: a new thread's first, or into a thread, where it waits for an answer being written. */
    func send(_ text: String, thread: String, requestId: String, first: Bool) async throws {
        var fields: [String: JSON] = ["text": .string(text)]
        if first {
            fields["id"] = .string(thread)
            try await command("POST", "/threads", fields, requestId: requestId)
        } else {
            try await command("POST", "/threads/\(Self.segment(thread))/messages", fields, requestId: requestId)
        }
    }

    /** Joins the answer being written, after its current step. */
    func steer(_ text: String, thread: String) async -> Bool {
        (try? await command("POST", "/threads/\(Self.segment(thread))/messages", ["text": .string(text), "steer": .bool(true)])) != nil
    }

    func stop(thread: String) async throws {
        try await command("POST", "/threads/\(Self.segment(thread))/stop", [:])
    }

    /** Approves or declines what an approval proposes; one answered already (elsewhere too) is no failure. */
    func decide(_ approval: String, approve: Bool, inThread: Bool) async throws {
        var fields: [String: JSON] = ["approve": .bool(approve)]
        if inThread { fields["inThread"] = .bool(true) }
        try await closing { try await self.command("POST", "/inbox/\(Self.segment(approval))/decision", fields) }
    }

    func answer(_ question: String, _ text: String) async throws {
        try await closing { try await self.command("POST", "/inbox/\(Self.segment(question))/answer", ["text": .string(text)]) }
    }

    private func closing(_ work: () async throws -> JSON) async throws {
        do { _ = try await work() } catch let failure as Failure where failure.code == "INBOX_ITEM_CLOSED" {}
    }

    /** Tells Otter's relay which thread to read when varys has something for the user, never what's in it. */
    func setRelay(address: String, token: String) async throws {
        _ = try await query("PUT", "/me/relay", .object(["address": .string(address), "token": .string(token)]))
    }

    func removeRelay() async throws {
        _ = try await query("DELETE", "/me/relay")
    }

    /** Ends this iPhone's grant in varys, its relay first: the token opens nothing after it. */
    func revoke() async throws {
        _ = try await query("DELETE", "/me")
        disconnect()
    }

    // MARK: Threads

    func threads() async throws -> [Thread] {
        let list = try await read("threads", .object([:]))
        return (list["threads"]?.array ?? []).compactMap { thread in
            guard let id = thread["id"]?.string else { return nil }
            return Thread(id: id, title: thread["title"]?.string ?? "", routine: thread["routine"]?["title"]?.string,
                          preview: thread["preview"]?["text"]?.string,
                          status: thread["status"]?.string ?? "", updatedAt: Self.date(thread["updatedAt"]?.string) ?? .distantPast)
        }
    }

    /** A thread's items, the older ones too, up to `readItems`. */
    func items(of thread: String) async throws -> [JSON] {
        let view = try await read("thread", .object(["id": .string(thread)]))
        var items = view["conversation"]?["items"]?.array ?? []
        var earlier = view["conversation"]?["earlier"]?.bool == true
        while earlier, items.count < Self.readItems, let before = items.first?["id"]?.string {
            let page = try await query("GET", "/threads/\(Self.segment(thread))/messages?before=\(Self.segment(before))&limit=100")
            let older = page["items"]?.array ?? []
            if older.isEmpty { break }
            items = older + items
            earlier = page["earlier"]?.bool == true
        }
        return items
    }

    /** A thread's items as a chat's messages: the user's, and the agent's replies with their tool steps. */
    nonisolated static func messages(_ items: [JSON]) -> [Hermes.Message] {
        items.compactMap { item in
            switch item["type"]?.string {
            case "message":
                return Hermes.Message(role: "user", text: item["text"]?.string ?? "", tools: [])
            case "answer":
                let calls = (item["calls"]?.array ?? []).map { stepName($0["tool"]?.string ?? "", $0["summary"]?.string) }
                return Hermes.Message(role: "assistant", text: item["text"]?.string ?? "", tools: calls)
            case "note" where item["from"].map { !$0.isNull } == true:
                return Hermes.Message(role: "assistant", text: item["text"]?.string ?? "", tools: [])
            default:
                return nil
            }
        }
    }

    /** A tool call as a chat lists it: varys's own summary, or its tool's name as words. */
    nonisolated static func stepName(_ tool: String, _ summary: String?) -> String {
        if let summary, !summary.isEmpty { return summary }
        let words = tool.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return words.prefix(1).uppercased() + words.dropFirst()
    }

    nonisolated static func date(_ text: String?) -> Date? {
        guard let text else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }

    // MARK: Live

    private(set) var status = Status.idle
    private lazy var live = Live { [weak self] message in
        guard let self, let socket = self.socket else { return }
        socket.send(.string(String(decoding: message.data, as: UTF8.self))) { _ in }
    }
    private var socket: URLSessionWebSocketTask?
    /** Fences every callback of a socket, timer or ticket to the try it belongs to. */
    private var generation = 0
    private var attempt = 0
    private var timers: [String: Task<Void, Never>] = [:]
    private var watchers: [String: () -> Void] = [:]
    private var nextID = 0

    /**
     * Follows view `name` with `params`: `listener` hears it as it stands, and on each change,
     * until the returned function is called. The socket opens on the first.
     */
    func watch(_ name: String, _ params: JSON, _ listener: @escaping (View) -> Void) -> () -> Void {
        nextID += 1
        let id = "otter-\(nextID)"
        var last: (view: View, status: Status)?
        watchers[id] = { [weak self] in
            guard let self, let view = live.view(id) else { return }
            if let last, last.view.status == view.status, last.view.rev == view.rev, last.status == status { return }
            last = (view, status)
            listener(view)
        }
        live.subscribe(id, view: name, params: params)
        if status == .idle { connect() }
        watchers[id]?()
        return { [weak self] in
            self?.watchers[id] = nil
            self?.live.unsubscribe(id)
        }
    }

    /** View `name`'s fresh value, read once. */
    func read(_ name: String, _ params: JSON) async throws -> JSON {
        if case .refused(let message) = status { throw Failure(code: "refused", message: message) }
        let reading = Reading()
        return try await withCheckedThrowingContinuation { continuation in
            reading.continuation = continuation
            let stop = watch(name, params) { [weak self] view in
                if case .refused(let message)? = self?.status { reading.settle(.failure(Failure(code: "refused", message: message))) }
                if view.status == .fresh, let value = view.value { reading.settle(.success(value)) }
                if view.status == .error {
                    reading.settle(.failure(Failure(code: view.error?.code ?? "refused", message: view.error?.message ?? "varys refused.")))
                }
            }
            // It can settle while it's set up.
            if reading.continuation == nil { stop() } else { reading.stop = stop }
            Task {
                try? await Task.sleep(for: .seconds(Self.readSeconds))
                reading.settle(.failure(Failure.unreachable))
            }
        }
    }

    private final class Reading {
        var continuation: CheckedContinuation<JSON, Error>?
        var stop: (() -> Void)?

        func settle(_ result: Result<JSON, Error>) {
            guard let continuation else { return }
            self.continuation = nil
            stop?()
            stop = nil
            continuation.resume(with: result)
        }
    }

    /** Closes the socket. Views stay as they were, stale, until the next watch opens it again. */
    func disconnect() {
        end()
        live.closed()
        status = .idle
        changed()
    }

    private func connect() {
        end()
        live.closed()
        status = .connecting
        let generation = generation
        timer("hello", Self.helloSeconds) { [weak self] in
            guard let self else { return }
            if case .open = live.connection { return }
            lost()
        }
        Task {
            do {
                try await pinned()
                let ticket = try await query("POST", "/live/tickets")["ticket"]?.string ?? ""
                guard generation == self.generation else { return }
                var url = URLComponents(string: address + "/live")!
                url.scheme = url.scheme == "https" ? "wss" : "ws"
                let socket = Self.session.webSocketTask(with: url.url!)
                self.socket = socket
                socket.resume()
                live.opened(ticket: ticket)
                Task { await receive(socket, generation) }
            } catch let failure as Failure where ["signed_out", "update_needed", "wrong_agent"].contains(failure.code) {
                guard generation == self.generation else { return }
                end()
                status = .refused(failure.message)
                changed()
            } catch {
                guard generation == self.generation else { return }
                end()
                retryLater()
            }
        }
    }

    private func receive(_ socket: URLSessionWebSocketTask, _ generation: Int) async {
        while true {
            guard let message = try? await socket.receive() else {
                if generation == self.generation { lost() }
                return
            }
            guard generation == self.generation else { return }
            guard case .string(let text) = message, let value = try? JSON(parsing: Data(text.utf8)) else { continue }
            let wasOpen = status == .open
            live.receive(value)
            switch live.connection {
            case .open(let agentId, _) where agentId != self.agentId:
                end()
                live.closed()
                status = .refused("Another agent answered at \(address).")
            case .open where !wasOpen:
                attempt = 0
                status = .open
                heartbeat(generation)
            case .refused(let error) where error.code == "PROTOCOL_MISMATCH":
                end()
                status = .refused(error.message)
            default:
                break
            }
            changed()
        }
    }

    /** The socket closed, or is dead: views go stale, and a new ticket and socket come after a wait. */
    private func lost() {
        end()
        live.closed()
        if case .refused(let error) = live.connection, error.code == "PROTOCOL_MISMATCH" {
            status = .refused(error.message)
        } else {
            retryLater()
        }
        changed()
    }

    private func retryLater() {
        status = .offline
        // Doubling from half a second up to 30, each wait drawn between half and all of it.
        let ceiling = min(30, 0.5 * pow(2, Double(attempt)))
        attempt += 1
        timer("retry", ceiling / 2 + ceiling / 2 * Double.random(in: 0...1)) { [weak self] in self?.connect() }
        changed()
    }

    private func heartbeat(_ generation: Int) {
        timer("heartbeat", Self.pingSeconds) { [weak self] in
            guard let self else { return }
            live.ping()
            timer("pong", Self.pongSeconds) { [weak self] in if self?.live.awaitingPong == true { self?.lost() } }
            heartbeat(generation)
        }
    }

    private func end() {
        generation += 1
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        for timer in timers.values { timer.cancel() }
        timers = [:]
    }

    private func timer(_ name: String, _ seconds: Double, _ run: @escaping () -> Void) {
        timers[name]?.cancel()
        let generation = generation
        timers[name] = Task {
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled, generation == self.generation else { return }
            timers[name] = nil
            run()
        }
    }

    private func changed() {
        for watcher in Array(watchers.values) { watcher() }
    }

    // MARK: Turns

    /** Sends the user's message, then follows the turn it starts. */
    func send(_ text: String, thread: String, requestId: String, first: Bool) -> AsyncStream<Event> {
        AsyncStream { continuation in
            let work = Task {
                do {
                    try await send(text, thread: thread, requestId: requestId, first: first)
                } catch {
                    continuation.yield(.failed(error.localizedDescription))
                    return continuation.finish()
                }
                for await event in turn(thread: thread, requestId: requestId) {
                    continuation.yield(event)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }

    /** A turn the app left (in the background, or quit during), followed again once varys says it got its message. */
    func resume(thread: String, requestId: String) -> AsyncStream<Event> {
        AsyncStream { continuation in
            let work = Task {
                do {
                    guard try await received(requestId) else {
                        continuation.yield(.failed("varys never got this message; send it again."))
                        return continuation.finish()
                    }
                } catch {
                    continuation.yield(.detached)
                    return continuation.finish()
                }
                for await event in turn(thread: thread, requestId: requestId) {
                    continuation.yield(event)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in work.cancel() }
        }
    }

    /**
     * Follows the turn the user's message sent with `requestId` starts or joins: the work so
     * far, then the rest. Work that stops to ask (an approval, a question) waits for the answer
     * and goes on in the same turn.
     */
    func turn(thread: String, requestId: String) -> AsyncStream<Event> {
        AsyncStream { continuation in
            let following = Following(varys: self, thread: thread, requestId: requestId) { continuation.yield($0) } finished: {
                continuation.finish()
            }
            continuation.onTermination = { _ in Task { @MainActor in following.close() } }
        }
    }
}

/** One turn, read from its thread's view and its inbox's, as the reader tells it. */
private final class Following {
    private let varys: Varys
    private let emit: (Varys.Event) -> Void
    private let finished: () -> Void
    private let reader: Varys.TurnReader
    private var reply = Varys.Reply()
    /** Finished answers and notes, then the answer being written. */
    private var said: [String] = []
    private var writing = ""
    private var asks = Set<String>()
    private var stops: [() -> Void] = []
    private var over = false

    init(varys: Varys, thread: String, requestId: String, emit: @escaping (Varys.Event) -> Void, finished: @escaping () -> Void) {
        self.varys = varys
        self.emit = emit
        self.finished = finished
        reader = Varys.TurnReader(.request(requestId))
        stops.append(varys.watch("thread", .object(["id": .string(thread)])) { [weak self] view in self?.onThread(view) })
        // Without the inbox scope it's refused: the turn goes on without approvals.
        stops.append(varys.watch("threadInbox", .object(["thread": .string(thread)])) { [weak self] view in self?.onInbox(view) })
    }

    func close() {
        guard !over else { return }
        over = true
        for stop in stops { stop() }
        stops = []
        finished()
    }

    private func end(_ event: Varys.Event) {
        guard !over else { return }
        emit(event)
        close()
    }

    private func onThread(_ view: Varys.View) {
        guard !over else { return }
        if view.status == .error { return end(.failed(view.error?.message ?? "varys refused this chat.")) }
        if case .refused(let message) = varys.status { return end(.failed(message)) }
        guard let value = view.value, view.status != .loading else { return }
        for event in reader.thread(value) where !over { apply(event) }
    }

    private func onInbox(_ view: Varys.View) {
        guard !over, let value = view.value, view.status == .fresh || view.status == .stale else { return }
        for event in reader.inbox(value) where !over { apply(event) }
    }

    private func apply(_ event: Varys.TurnEvent) {
        switch event {
        case .started, .waiting:
            break
        case .message, .resumed:
            // A message sent into the run (a steer), or the run the user's answer started: a new reply.
            commit()
        case .text(let delta):
            writing += delta
            show()
        case .answer(let answer):
            writing = answer["text"]?.string ?? ""
            commit()
            show()
        case .note(let note):
            // What the agent wrote here from another thread (a routine's report).
            if note["from"].map({ !$0.isNull }) == true {
                commit()
                said.append(note["text"]?.string ?? "")
                show()
            }
        case .step(let id, let tool, let summary):
            reply.steps.append(Varys.Step(id: id, name: Varys.stepName(tool, summary)))
            show()
        case .result(let result):
            guard let i = reply.steps.lastIndex(where: { $0.id == result["callId"]?.string }) else { return }
            let text = result["text"]?.string ?? ""
            reply.steps[i].output = text.isEmpty ? (result["failed"]?.bool == true ? "(failed)" : "(done)") : String(text.suffix(400))
            show()
        case .approval(let item):
            ask(item)
        case .question(let item):
            ask(item)
        case .approvalResolved(let id), .questionResolved(let id):
            if asks.remove(id) != nil { emit(.resolved(id)) }
        case .done:
            end(.done)
        case .stopped:
            end(.stopped)
        case .failed(_, let message):
            end(.failed(message))
        }
    }

    private func commit() {
        if !writing.isEmpty { said.append(writing) }
        writing = ""
    }

    private func show() {
        reply.text = (said + [writing]).filter { !$0.isEmpty }.joined(separator: "\n\n")
        emit(.reply(reply))
    }

    private func ask(_ item: Varys.JSON) {
        guard let id = item["id"]?.string, asks.insert(id).inserted else { return }
        if item["type"]?.string == "approval" {
            let presentation = item["presentation"]
            let fields = (presentation?["fields"]?.array ?? []).compactMap { field -> String? in
                guard let label = field["label"]?.string, let value = field["value"]?.string else { return nil }
                return "\(label): \(value)"
            }
            emit(.approval(Varys.Approval(
                id: id, title: presentation?["title"]?.string ?? item["headline"]?.string ?? "Allow this?",
                detail: fields.isEmpty ? item["input"]?.string : fields.joined(separator: "\n"),
                why: presentation?["why"]?.string ?? item["why"]?.string,
                inThread: item["offer"].map { !$0.isNull } == true)))
        } else {
            emit(.question(Varys.Question(id: id, text: item["text"]?.string ?? "", deadline: Varys.date(item["deadline"]?.string))))
        }
    }
}
