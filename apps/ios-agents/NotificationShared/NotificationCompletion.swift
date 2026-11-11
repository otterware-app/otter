import Foundation

nonisolated final class NotificationCompletion<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: ((Value) -> Void)?

    init(_ handler: @escaping (Value) -> Void) { self.handler = handler }

    func finish(_ value: Value) {
        lock.lock()
        let callback = handler
        handler = nil
        lock.unlock()
        callback?(value)
    }
}
