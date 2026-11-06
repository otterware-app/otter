import Foundation
import NitroModules

private final class SocketDelegate: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
  var onOpen: ((String) -> Void)?
  var onClose: ((Double, String) -> Void)?
  var onError: ((String) -> Void)?
  private var closed = false
  private let lock = NSLock()

  func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
    onOpen?(`protocol` ?? "")
  }

  func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    finish(Double(closeCode.rawValue), reason.flatMap { String(data: $0, encoding: .utf8) } ?? "")
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if let error { onError?((error as NSError).localizedDescription) }
    finish(1006, "")
  }

  func finish(_ code: Double, _ reason: String) {
    let first = lock.withLock {
      defer { closed = true }
      return !closed
    }
    if first { onClose?(code, reason) }
  }
}

final class HybridWebSocketConnection: HybridWebSocketConnectionSpec, @unchecked Sendable {
  private var task: URLSessionWebSocketTask?
  private var session: URLSession?
  private let delegate = SocketDelegate()

  func open(
    url: String, protocols: [String], headers: [String: String], onOpen: @escaping (String) -> Void,
    onText: @escaping (String) -> Void, onBinary: @escaping (ArrayBuffer) -> Void,
    onClose: @escaping (Double, String) -> Void, onError: @escaping (String) -> Void
  ) throws {
    guard let target = URL(string: url) else { throw RuntimeError.error(withMessage: "Invalid URL: \(url)") }
    var request = URLRequest(url: target)
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    if !protocols.isEmpty { request.setValue(protocols.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol") }
    delegate.onOpen = onOpen
    delegate.onClose = onClose
    delegate.onError = onError
    let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
    let task = session.webSocketTask(with: request)
    self.session = session
    self.task = task
    task.resume()
    receive(task, onText: onText, onBinary: onBinary)
  }

  private func receive(
    _ task: URLSessionWebSocketTask, onText: @escaping (String) -> Void, onBinary: @escaping (ArrayBuffer) -> Void
  ) {
    task.receive { [weak self] result in
      switch result {
      case .success(.string(let text)): onText(text)
      case .success(.data(let data)): if let buffer = try? ArrayBuffer.copy(data: data) { onBinary(buffer) }
      case .success: break
      case .failure: return
      }
      self?.receive(task, onText: onText, onBinary: onBinary)
    }
  }

  func sendText(text: String) throws {
    task?.send(.string(text)) { [delegate] error in
      if let error { delegate.onError?((error as NSError).localizedDescription) }
    }
  }

  func sendBinary(data: ArrayBuffer) throws {
    task?.send(.data(data.toData(copyIfNeeded: true))) { [delegate] error in
      if let error { delegate.onError?((error as NSError).localizedDescription) }
    }
  }

  func close(code: Double, reason: String) throws {
    let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: Int(code)) ?? .normalClosure
    task?.cancel(with: closeCode, reason: reason.data(using: .utf8))
    session?.finishTasksAndInvalidate()
    delegate.finish(code, reason)
  }
}
