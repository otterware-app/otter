import Foundation
import Network
import Security
import Synchronization

nonisolated final class MailSockets: Sendable {
    private let sockets = Mutex<[String: any MailTransport]?>([:])

    func open(host: String, port: Int, tls: Bool) async throws -> String {
        guard !host.isEmpty, let port = UInt16(exactly: port), port != 0 else { throw MailSocketError.address }
        let transport: any MailTransport = tls
            ? ImplicitTLS(host: host, port: port)
            : StartTLS(host: host, port: port)
        let id = UUID().uuidString
        let inserted = sockets.withLock { sockets in
            sockets?[id] = transport
            return sockets != nil
        }
        guard inserted else {
            transport.close()
            throw MailSocketError.closed
        }
        do {
            try await withTaskCancellationHandler {
                try await transport.start()
                try Task.checkCancellation()
            } onCancel: { self.close(id) }
            return id
        } catch {
            close(id)
            throw error
        }
    }

    func read(_ id: String) async throws -> String? {
        guard let transport = sockets.withLock({ $0?[id] }) else { return nil }
        return try await run(id) {
            guard let data = try await transport.read() else {
                self.close(id)
                return nil
            }
            return data.base64EncodedString()
        }
    }

    func write(_ id: String, base64: String) async throws {
        guard let bytes = Data(base64Encoded: base64) else { throw MailSocketError.bytes }
        guard let transport = sockets.withLock({ $0?[id] }) else { throw MailSocketError.closed }
        try await run(id) { try await transport.write(bytes) }
    }

    func startTLS(_ id: String) async throws {
        guard let transport = sockets.withLock({ $0?[id] }) else { throw MailSocketError.closed }
        try await run(id) { try await transport.upgrade() }
    }

    private func run<T>(_ id: String, _ body: () async throws -> T) async throws -> T {
        do {
            return try await withTaskCancellationHandler(operation: body, onCancel: { self.close(id) })
        } catch {
            close(id)
            throw error
        }
    }

    func close(_ id: String) {
        sockets.withLock { $0?.removeValue(forKey: id) }?.close()
    }

    func closeAll() {
        let remaining = sockets.withLock { sockets in
            defer { sockets = nil }
            return sockets
        }
        for socket in remaining?.values ?? [:].values { socket.close() }
    }
}

nonisolated private enum MailSocketError: LocalizedError {
    case address, bytes, certificate, closed, secured, timeout

    var errorDescription: String? {
        switch self {
        case .address: "Invalid mail server address or port."
        case .bytes: "Invalid mail socket bytes."
        case .certificate: "The mail server’s TLS certificate failed verification."
        case .closed: "The mail connection closed."
        case .secured: "The mail connection is already using TLS."
        case .timeout: "The mail server didn't answer in time."
        }
    }
}

nonisolated private protocol MailTransport: Sendable {
    func start() async throws
    func read() async throws -> Data?
    func write(_ bytes: Data) async throws
    func upgrade() async throws
    func close()
}

nonisolated private final class ImplicitTLS: MailTransport {
    private let connection: NWConnection
    private let queue = DispatchQueue(label: "dev.otterware.mail.socket")

    init(host: String, port: UInt16) {
        let tls = NWProtocolTLS.Options()
        sec_protocol_options_set_min_tls_protocol_version(tls.securityProtocolOptions, .TLSv12)
        let tcp = NWProtocolTCP.Options()
        tcp.connectionTimeout = 15
        connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!,
                                  using: NWParameters(tls: tls, tcp: tcp))
    }

    func start() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            let pending = Mutex<CheckedContinuation<Void, Error>?>(continuation)
            let finish: @Sendable (Result<Void, Error>) -> Bool = { result in
                let continuation = pending.withLock {
                    let previous = $0
                    $0 = nil
                    return previous
                }
                continuation?.resume(with: result)
                return continuation != nil
            }
            connection.stateUpdateHandler = { [weak self] state in
                switch state {
                case .ready: _ = finish(.success(()))
                case .waiting(let error), .failed(let error):
                    _ = finish(.failure(Self.tlsError(error)))
                    self?.close()
                case .cancelled: _ = finish(.failure(MailSocketError.closed))
                default: break
                }
            }
            connection.start(queue: queue)
            queue.asyncAfter(deadline: .now() + 15) { [weak self] in
                if finish(.failure(MailSocketError.timeout)) { self?.close() }
            }
        }
    }

    func read() async throws -> Data? {
        try await withCheckedThrowingContinuation { continuation in
            connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { data, _, eof, error in
                if let data, !data.isEmpty { continuation.resume(returning: data) }
                else if let error { continuation.resume(throwing: Self.tlsError(error)) }
                else if eof { continuation.resume(returning: nil) }
                else { continuation.resume(throwing: MailSocketError.closed) }
            }
        }
    }

    func write(_ bytes: Data) async throws {
        try await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask {
                try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                    self.connection.send(content: bytes, completion: .contentProcessed { error in
                        if let error { continuation.resume(throwing: Self.tlsError(error)) } else { continuation.resume() }
                    })
                }
            }
            group.addTask {
                try await Task.sleep(for: .seconds(60))
                self.close()
                throw MailSocketError.timeout
            }
            defer { group.cancelAll() }
            try await group.next()
        }
    }

    private static func tlsError(_ error: NWError) -> Error {
        if case .tls(let status) = error,
           [errSSLXCertChainInvalid, errSSLBadCert, errSSLUnknownRootCert, errSSLNoRootCert,
            errSSLCertExpired, errSSLCertNotYetValid, errSSLHostNameMismatch].contains(status) {
            return MailSocketError.certificate
        }
        return error
    }

    func upgrade() async throws { throw MailSocketError.secured }

    func close() { connection.cancel() }
}

nonisolated private final class StartTLS: MailTransport {
    private let session: URLSession
    private let task: URLSessionStreamTask
    private let upgraded = Mutex(false)

    init(host: String, port: UInt16) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.tlsMinimumSupportedProtocolVersion = .TLSv12
        session = URLSession(configuration: configuration)
        task = session.streamTask(withHostName: host, port: Int(port))
    }

    func start() async throws { task.resume() }

    func read() async throws -> Data? {
        let (data, eof) = try await task.readData(ofMinLength: 1, maxLength: 64 * 1024, timeout: 0)
        if let data, !data.isEmpty { return data }
        if eof { return nil }
        throw MailSocketError.closed
    }

    func write(_ bytes: Data) async throws { try await task.write(bytes, timeout: 60) }

    func upgrade() async throws {
        let started = upgraded.withLock { previous in
            if previous { return false }
            previous = true
            return true
        }
        guard started else { throw MailSocketError.secured }
        // The stream task queues the handshake ahead of subsequent reads and writes.
        task.startSecureConnection()
    }

    func close() {
        task.cancel()
        session.invalidateAndCancel()
    }
}
