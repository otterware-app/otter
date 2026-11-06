import Foundation
import Network
import NitroModules
import Synchronization

/**
 * The Swift app's MailSocket transports. TLS from the start (993, 465) runs over
 * Network.framework's NWConnection. STARTTLS (143, 587) upgrades a plaintext
 * connection mid-stream, which an NWConnection can't do: its protocol stack is
 * fixed when it starts. URLSessionStreamTask's `startSecureConnection()` begins
 * TLS on the open connection, so those servers go through it.
 *
 * The development variant (Info.plist `OtterTrustLocalMailServers`) trusts any
 * certificate from localhost, for `pnpm dev:mail`; the others only the system's.
 */
protocol MailTransport: AnyObject, Sendable {
  func start() async throws
  /** Nil once the server has closed. */
  func receive() async throws -> Data?
  func send(_ data: Data) async throws
  func startTLS() async throws
  func close()
}

private let trustsLocalServers = Bundle.main.object(forInfoDictionaryKey: "OtterTrustLocalMailServers") as? Bool == true

private func trustsAnyCertificate(_ host: String) -> Bool {
  trustsLocalServers && ["localhost", "127.0.0.1", "::1"].contains(host.lowercased())
}

final class NWTransport: MailTransport, @unchecked Sendable {
  private let connection: NWConnection
  private let queue = DispatchQueue(label: "dev.otterware.mail.socket")
  /** Why the state handler cancelled the connection, if the network failed it. */
  private let failure = Mutex<NWError?>(nil)

  init(host: String, port: Int) {
    let tls = NWProtocolTLS.Options()
    if trustsAnyCertificate(host) {
      sec_protocol_options_set_verify_block(tls.securityProtocolOptions, { _, _, complete in complete(true) }, queue)
    }
    let tcp = NWProtocolTCP.Options()
    tcp.connectionTimeout = 15
    connection = NWConnection(
      host: NWEndpoint.Host(host),
      port: NWEndpoint.Port(rawValue: UInt16(clamping: port)) ?? .imaps,
      using: NWParameters(tls: tls, tcp: tcp)
    )
  }

  func start() async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      // State changes all come on `queue`, so this needs no lock.
      final class Once: @unchecked Sendable { var done = false }
      let once = Once()
      let finish = { @Sendable (error: Error?) in
        guard !once.done else { return }
        once.done = true
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
      }
      connection.stateUpdateHandler = { [connection, weak self] state in
        switch state {
        case .ready: finish(nil)
        // Unreachable, refused or a bad certificate: fail now rather than wait for the network.
        case .waiting(let error), .failed(let error):
          self?.failure.withLock { $0 = error }
          finish(RuntimeError.error(withMessage: "\(error)"))
          connection.cancel()
        case .cancelled: finish(RuntimeError.error(withMessage: "The connection closed."))
        default: break
        }
      }
      connection.start(queue: queue)
    }
  }

  func receive() async throws -> Data? {
    try await withCheckedThrowingContinuation { continuation in
      connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, isComplete, error in
        if let data, !data.isEmpty {
          continuation.resume(returning: data)
        } else if let error, !isComplete {
          continuation.resume(throwing: self.lost(error))
        } else {
          continuation.resume(returning: nil)
        }
      }
    }
  }

  func send(_ data: Data) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      connection.send(content: data, completion: .contentProcessed { error in
        if let error { continuation.resume(throwing: self.lost(error)) } else { continuation.resume() }
      })
    }
  }

  func startTLS() async throws { throw RuntimeError.error(withMessage: "Already using TLS.") }

  func close() { connection.cancel() }

  /**
   * The Swift app's NWTransport.lost: a connection the network failed (iOS
   * aborting a backgrounded app's socket, Wi-Fi handing over) is cancelled
   * by the state handler, which ends what was waiting on it, and anything
   * sent after, as ECANCELED. That failure is reported instead, so core
   * says the connection was lost and why, not "Operation canceled".
   */
  private func lost(_ error: NWError) -> Error {
    let cause = error == .posix(.ECANCELED) ? failure.withLock { $0 } ?? error : error
    return RuntimeError.error(withMessage: "\(cause)")
  }
}

final class StreamTransport: NSObject, MailTransport, URLSessionTaskDelegate, @unchecked Sendable {
  private let host: String
  private var session: URLSession!
  private var task: URLSessionStreamTask!

  init(host: String, port: Int) {
    self.host = host
    super.init()
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 15
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    task = session.streamTask(withHostName: host, port: port)
  }

  func start() async throws { task.resume() }

  func receive() async throws -> Data? {
    let (data, atEOF) = try await task.readData(ofMinLength: 1, maxLength: 65_536, timeout: 0)
    if let data, !data.isEmpty { return data }
    if atEOF { return nil }
    return Data()
  }

  func send(_ data: Data) async throws { try await task.write(data, timeout: 0) }

  func startTLS() async throws { task.startSecureConnection() }

  func close() {
    task.cancel()
    session.invalidateAndCancel()
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge
  ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
    if trustsAnyCertificate(host), let trust = challenge.protectionSpace.serverTrust {
      return (.useCredential, URLCredential(trust: trust))
    }
    return (.performDefaultHandling, nil)
  }
}
