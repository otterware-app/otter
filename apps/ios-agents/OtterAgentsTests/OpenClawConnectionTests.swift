import Foundation
import Network
import Synchronization
import Testing
@testable import Otter_Agents

/** A socket that stops answering, as one does after the network changes under it, is found and replaced. */
@MainActor
struct OpenClawConnectionTests {
    @Test func dropsASocketThatNoLongerAnswersAndConnectsAgain() async throws {
        let gateway = try await FakeGateway.start()
        defer { gateway.stop() }
        let client = OpenClaw(url: gateway.url, secrets: .memory([OpenClaw.tokenName: "token"]), appVersion: "test")

        try await client.connected()
        await client.probe(within: 2)
        #expect(gateway.connections == 1)

        gateway.silent = true
        let asked = Date()
        await client.probe(within: 1)
        #expect(Date().timeIntervalSince(asked) < 3)

        gateway.silent = false
        try await client.connected()
        #expect(gateway.connections == 2)
    }
}

extension OpenClaw.Secrets {
    static func memory(_ values: [String: String]) -> Self {
        final class Store { var values: [String: String]; init(_ values: [String: String]) { self.values = values } }
        let store = Store(values)
        return .init(get: { store.values[$0] }, set: { store.values[$0] = $1 })
    }
}

/** Just enough of OpenClaw's gateway: the challenge, `connect`, and pongs until it goes silent. */
nonisolated private final class FakeGateway: Sendable {
    private let listener: NWListener
    private let state = Mutex((connections: 0, silent: false))
    private let queue = DispatchQueue(label: "fake-gateway")

    var url: URL { URL(string: "ws://127.0.0.1:\(listener.port!.rawValue)")! }
    var connections: Int { state.withLock { $0.connections } }
    var silent: Bool {
        get { state.withLock { $0.silent } }
        set { state.withLock { $0.silent = newValue } }
    }

    private init(listener: NWListener) {
        self.listener = listener
    }

    static func start() async throws -> FakeGateway {
        let websocket = NWProtocolWebSocket.Options()
        websocket.autoReplyPing = false
        let parameters = NWParameters.tcp
        parameters.defaultProtocolStack.applicationProtocols.insert(websocket, at: 0)
        let gateway = FakeGateway(listener: try NWListener(using: parameters, on: .any))
        gateway.listener.newConnectionHandler = { connection in gateway.accept(connection) }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let started = Started()
            gateway.listener.stateUpdateHandler = { state in
                let first = { started.once() }
                switch state {
                case .ready: if first() { continuation.resume() }
                case .failed(let error): if first() { continuation.resume(throwing: error) }
                default: break
                }
            }
            gateway.listener.start(queue: gateway.queue)
        }
        return gateway
    }

    func stop() {
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        state.withLock { $0.connections += 1 }
        connection.start(queue: queue)
        send(["type": "event", "event": "connect.challenge", "payload": ["nonce": "nonce", "ts": 1]], on: connection)
        receive(on: connection)
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [self] content, context, _, error in
            guard error == nil else { return connection.cancel() }
            let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if !silent {
                switch metadata?.opcode {
                case .ping:
                    let pong = NWProtocolWebSocket.Metadata(opcode: .pong)
                    connection.send(content: content, contentContext: .init(identifier: "pong", metadata: [pong]), isComplete: true, completion: .idempotent)
                case .text:
                    if let content, let frame = try? JSONSerialization.jsonObject(with: content) as? [String: Any], let id = frame["id"] as? String {
                        let payload: [String: Any] = frame["method"] as? String == "connect" ? ["auth": ["scopes": ["operator.read"]]] : [:]
                        send(["type": "res", "id": id, "ok": true, "payload": payload], on: connection)
                    }
                default:
                    break
                }
            }
            receive(on: connection)
        }
    }

    private func send(_ frame: [String: Any], on connection: NWConnection) {
        let text = NWProtocolWebSocket.Metadata(opcode: .text)
        let data = try! JSONSerialization.data(withJSONObject: frame)
        connection.send(content: data, contentContext: .init(identifier: "text", metadata: [text]), isComplete: true, completion: .idempotent)
    }
}

nonisolated private final class Started: Sendable {
    private let done = Mutex(false)

    /** True the first time only. */
    func once() -> Bool {
        done.withLock { done in
            defer { done = true }
            return !done
        }
    }
}
