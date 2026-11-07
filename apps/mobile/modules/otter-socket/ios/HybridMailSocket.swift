import Foundation
import NitroModules

final class HybridMailSocket: HybridMailSocketSpec, @unchecked Sendable {
  private var transport: (any MailTransport)?

  private func open() throws -> any MailTransport {
    guard let transport else { throw RuntimeError.error(withMessage: "The connection isn't open.") }
    return transport
  }

  func connect(host: String, port: Double, tls: Bool) throws -> Promise<Void> {
    let transport: any MailTransport =
      tls ? NWTransport(host: host, port: Int(port)) : StreamTransport(host: host, port: Int(port))
    self.transport = transport
    return Promise.async { try await transport.start() }
  }

  func read() throws -> Promise<ArrayBuffer?> {
    let transport = try open()
    return Promise.async {
      while true {
        guard let data = try await transport.receive() else { return nil }
        if !data.isEmpty { return try ArrayBuffer.copy(data: data) }
      }
    }
  }

  func write(data: ArrayBuffer) throws -> Promise<Void> {
    let transport = try open()
    let bytes = data.toData(copyIfNeeded: true)
    return Promise.async { try await transport.send(bytes) }
  }

  func startTls() throws -> Promise<Void> {
    let transport = try open()
    return Promise.async { try await transport.startTLS() }
  }

  func close() throws {
    transport?.close()
    transport = nil
  }
}
