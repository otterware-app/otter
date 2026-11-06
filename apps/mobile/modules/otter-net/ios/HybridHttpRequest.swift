import Foundation
import NitroModules

/**
 * One URLSession for every request; its delegate hands each task's head,
 * chunks and end to the request that started it, as they arrive.
 */
private final class Sessions: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  static let shared = Sessions()

  struct Handlers {
    var followRedirects: Bool
    var onResponse: (HttpResponseHead) -> Void
    var onData: (ArrayBuffer) -> Void
    var onComplete: (String?) -> Void
  }

  private let lock = NSLock()
  private var handlers: [Int: Handlers] = [:]
  private(set) lazy var session: URLSession = {
    let configuration = URLSessionConfiguration.default
    configuration.timeoutIntervalForRequest = 60
    // fetch with `credentials: "include"` (the agent server's session cookie) keeps cookies, as a browser does.
    configuration.httpCookieStorage = .shared
    configuration.httpShouldSetCookies = true
    configuration.urlCache = nil
    return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
  }()

  func start(_ task: URLSessionDataTask, _ handler: Handlers) {
    lock.withLock { handlers[task.taskIdentifier] = handler }
    task.resume()
  }

  private func handler(_ task: URLSessionTask) -> Handlers? { lock.withLock { handlers[task.taskIdentifier] } }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    let http = response as? HTTPURLResponse
    var headers: [String: String] = [:]
    for (key, value) in http?.allHeaderFields ?? [:] {
      if let key = key as? String { headers[key.lowercased()] = "\(value)" }
    }
    handler(dataTask)?.onResponse(
      HttpResponseHead(status: Double(http?.statusCode ?? 200), url: response.url?.absoluteString ?? "", headers: headers))
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    guard let handler = handler(dataTask), let chunk = try? ArrayBuffer.copy(data: data) else { return }
    handler.onData(chunk)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(handler(task)?.followRedirects == false ? nil : request)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let handler = lock.withLock { handlers.removeValue(forKey: task.taskIdentifier) }
    handler?.onComplete(error.map { ($0 as NSError).localizedDescription })
  }
}

final class HybridHttpRequest: HybridHttpRequestSpec, @unchecked Sendable {
  private var task: URLSessionDataTask?

  func start(
    url: String, method: String, headers: [String: String], body: ArrayBuffer?, followRedirects: Bool,
    onResponse: @escaping (HttpResponseHead) -> Void, onData: @escaping (ArrayBuffer) -> Void,
    onComplete: @escaping (String?) -> Void
  ) throws {
    guard let target = URL(string: url) else { throw RuntimeError.error(withMessage: "Invalid URL: \(url)") }
    var request = URLRequest(url: target)
    request.httpMethod = method
    for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
    if let body { request.httpBody = body.toData(copyIfNeeded: true) }
    let task = Sessions.shared.session.dataTask(with: request)
    self.task = task
    Sessions.shared.start(
      task, .init(followRedirects: followRedirects, onResponse: onResponse, onData: onData, onComplete: onComplete))
  }

  func cancel() throws { task?.cancel() }
}
