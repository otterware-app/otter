import Foundation

/**
 * varys's Live protocol, the client's side, as varys's `packages/live/PROTOCOL.md` describes it
 * and its TypeScript `LiveClient` does it, without the socket: `Varys` passes in what happens to
 * the connection and what arrives on it, and sends what this hands to `send`. The protocol's
 * shared fixtures replay against it (`VarysLiveTests`). Otter follows no view with a stream (a
 * thread's browser), keeps no views across launches, and waits on no receipt's revision, so
 * frames, the view cache and revision marks are left out.
 */
extension Varys {
    /** Any JSON value: a view's value and the changes to it. */
    nonisolated enum JSON: Hashable, Sendable, Codable {
        case null
        case bool(Bool)
        case number(Double)
        case string(String)
        case array([JSON])
        case object([String: JSON])

        init(from decoder: Decoder) throws {
            let container = try decoder.singleValueContainer()
            if container.decodeNil() { self = .null }
            else if let value = try? container.decode(Bool.self) { self = .bool(value) }
            else if let value = try? container.decode(Double.self) { self = .number(value) }
            else if let value = try? container.decode(String.self) { self = .string(value) }
            else if let value = try? container.decode([JSON].self) { self = .array(value) }
            else { self = .object(try container.decode([String: JSON].self)) }
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .null: try container.encodeNil()
            case .bool(let value): try container.encode(value)
            case .number(let value): try container.encode(value)
            case .string(let value): try container.encode(value)
            case .array(let value): try container.encode(value)
            case .object(let value): try container.encode(value)
            }
        }

        init(parsing data: Data) throws { self = try JSONDecoder().decode(JSON.self, from: data) }

        var data: Data { (try? JSONEncoder().encode(self)) ?? Data() }

        subscript(key: String) -> JSON? {
            if case .object(let object) = self { object[key] } else { nil }
        }

        var string: String? { if case .string(let value) = self { value } else { nil } }
        var bool: Bool? { if case .bool(let value) = self { value } else { nil } }
        var number: Double? { if case .number(let value) = self { value } else { nil } }
        var array: [JSON]? { if case .array(let value) = self { value } else { nil } }
        var object: [String: JSON]? { if case .object(let value) = self { value } else { nil } }
        var isNull: Bool { self == .null }

        /** A whole number that isn't negative, as JSON has only numbers. */
        var count: Int? {
            guard let number, number >= 0, number.rounded() == number, number < 0x1p53 else { return nil }
            return Int(number)
        }
    }

    /**
     * Chord's delta format, as Live sends a view's changes: `r` replaces the value, `s` sets a key
     * or element, `d` deletes one, `a` appends to a string, `t` cuts a string's front (in UTF-16
     * code units, as JavaScript counts), `p` splices an array and `m` reorders one. Nil when an
     * op isn't one, or doesn't fit the value, such as a path that isn't there.
     */
    nonisolated enum Delta {
        static func apply(_ ops: [JSON], to value: JSON) -> JSON? {
            var root = value
            for op in ops {
                guard let next = apply(op, to: root) else { return nil }
                root = next
            }
            return root
        }

        private enum Segment {
            case key(String)
            case index(Int)

            init?(_ value: JSON) {
                if let key = value.string {
                    // Keys Chord refuses, as they'd reach an object's prototype in JavaScript.
                    guard !["__proto__", "constructor", "prototype"].contains(key) else { return nil }
                    self = .key(key)
                } else if let index = value.count {
                    self = .index(index)
                } else {
                    return nil
                }
            }

            /** JavaScript names an object's key by an index too. */
            var key: String {
                switch self {
                case .key(let key): key
                case .index(let index): String(index)
                }
            }
        }

        private static func path(_ value: JSON?, nonEmpty: Bool) -> [Segment]? {
            guard let segments = value?.array, !(nonEmpty && segments.isEmpty) else { return nil }
            let read = segments.compactMap(Segment.init)
            return read.count == segments.count ? read : nil
        }

        private static func apply(_ op: JSON, to root: JSON) -> JSON? {
            guard let parts = op.array, let verb = parts.first?.string else { return nil }
            let args = Array(parts.dropFirst())
            switch (verb, args.count) {
            case ("r", 1):
                return args[0]
            case ("s", 2), ("d", 1), ("a", 2), ("t", 2):
                guard let path = path(args[0], nonEmpty: true) else { return nil }
                if verb == "a", args[1].string == nil { return nil }
                if verb == "t", args[1].count == nil { return nil }
                return update(root, at: path.dropLast()) { parent in
                    leaf(verb, args.count > 1 ? args[1] : .null, parent, path[path.count - 1])
                }
            case ("p", 4):
                guard let path = path(args[0], nonEmpty: false), let index = args[1].count,
                      let remove = args[2].count, let items = args[3].array else { return nil }
                return update(root, at: path[...]) { target in
                    guard var array = target.array else { return nil }
                    let start = min(index, array.count)
                    array.replaceSubrange(start..<min(start + remove, array.count), with: items)
                    return .array(array)
                }
            case ("m", 2):
                guard let path = path(args[0], nonEmpty: false), let values = args[1].array else { return nil }
                let order = values.compactMap(\.count)
                guard order.count == values.count, Set(order).count == order.count, order.allSatisfy({ $0 < order.count })
                else { return nil }
                return update(root, at: path[...]) { target in
                    guard let array = target.array, array.count == order.count else { return nil }
                    return .array(order.map { array[$0] })
                }
            default:
                return nil
            }
        }

        private static func leaf(_ verb: String, _ argument: JSON, _ parent: JSON, _ key: Segment) -> JSON? {
            func changed(_ current: JSON?) -> JSON? {
                switch verb {
                case "s": return argument
                case "a":
                    guard let text = current?.string, let more = argument.string else { return nil }
                    return .string(text + more)
                case "t":
                    guard let text = current?.string, let units = argument.count else { return nil }
                    return .string(String(decoding: text.utf16.dropFirst(units), as: UTF16.self))
                default: return nil
                }
            }
            switch parent {
            case .array(var array):
                // An element by index, which may be one past the end, to add one.
                guard case .index(let index) = key, index <= array.count else { return nil }
                if index == array.count {
                    guard verb == "s" else { return nil }
                    array.append(argument)
                } else if verb == "d" {
                    array.remove(at: index)
                } else {
                    guard let value = changed(array[index]) else { return nil }
                    array[index] = value
                }
                return .array(array)
            case .object(var object):
                if verb == "d" {
                    object[key.key] = nil
                } else {
                    guard let value = changed(object[key.key]) else { return nil }
                    object[key.key] = value
                }
                return .object(object)
            default:
                return nil
            }
        }

        /** `value` with what's at `path` changed: each step an object's key or an array's index within it. */
        private static func update(_ value: JSON, at path: ArraySlice<Segment>, _ change: (JSON) -> JSON?) -> JSON? {
            guard let segment = path.first else { return change(value) }
            switch value {
            case .array(var array):
                guard case .index(let index) = segment, index < array.count,
                      let child = update(array[index], at: path.dropFirst(), change) else { return nil }
                array[index] = child
                return .array(array)
            case .object(var object):
                guard let current = object[segment.key], let child = update(current, at: path.dropFirst(), change) else { return nil }
                object[segment.key] = child
                return .object(object)
            default:
                return nil
            }
        }
    }

    /** Why the server refused a connection or a subscription. */
    nonisolated struct LiveError: Equatable {
        var code: String
        var message: String
        /** With `PROTOCOL_MISMATCH`: `app` or `server`, whichever has to update. */
        var update: String?
    }

    /**
     * A view as the client has it: `loading` (no value yet, or none from this incarnation),
     * `fresh`, `stale` (readable while offline or waiting for a snapshot) or `error` (refused).
     */
    nonisolated struct View: Equatable {
        enum Status: String { case loading, fresh, stale, error }
        var view: String
        var params: JSON
        var status: Status
        var rev: Int?
        var value: JSON?
        var error: LiveError?
    }

    final class Live {
        enum Connection: Equatable {
            case closed
            case connecting
            case open(agentId: String, incarnation: String)
            case refused(LiveError)
        }

        /** The protocol version Otter speaks. */
        static let protocolVersion = (major: 1, minor: 0)

        private struct Subscription {
            var view: View
            /** Whether a snapshot came on this connection, which ops need before they apply. */
            var synced = false
            /** Whether a fresh snapshot was asked for, and ops are ignored until it comes. */
            var resyncing = false
        }

        private let send: (JSON) -> Void
        private let major: Int
        private let minor: Int
        /** In the order they were made, as they're subscribed again on each connection. */
        private var order: [String] = []
        private var subscriptions: [String: Subscription] = [:]
        private var incarnation: String?
        private(set) var connection = Connection.closed
        /** Whether a ping waits for its pong, which tells a dead socket from a quiet one. */
        private(set) var awaitingPong = false

        init(protocol version: (major: Int, minor: Int) = Live.protocolVersion, send: @escaping (JSON) -> Void) {
            self.send = send
            major = version.major
            minor = version.minor
        }

        /** The socket opened: says hello with a fresh ticket. */
        func opened(ticket: String) {
            connection = .connecting
            awaitingPong = false
            send(.object(["type": .string("hello"), "ticket": .string(ticket),
                          "protocol": .object(["major": .number(Double(major)), "minor": .number(Double(minor))])]))
        }

        /** The socket closed: every view stays readable, as stale, until the next connection. */
        func closed() {
            if case .refused = connection {} else { connection = .closed }
            awaitingPong = false
            for id in order {
                if subscriptions[id]?.view.status == .fresh { subscriptions[id]?.view.status = .stale }
                subscriptions[id]?.synced = false
                subscriptions[id]?.resyncing = false
            }
        }

        func subscribe(_ id: String, view: String, params: JSON) {
            if let existing = subscriptions[id] {
                if existing.view.view == view, existing.view.params == params { return }
                unsubscribe(id)
            }
            subscriptions[id] = Subscription(view: View(view: view, params: params, status: .loading))
            order.append(id)
            if isOpen { send(.object(["type": .string("sub"), "id": .string(id), "view": .string(view), "params": params])) }
        }

        func unsubscribe(_ id: String) {
            guard subscriptions.removeValue(forKey: id) != nil else { return }
            order.removeAll { $0 == id }
            if isOpen { send(.object(["type": .string("unsub"), "id": .string(id)])) }
        }

        func ping() {
            guard isOpen else { return }
            awaitingPong = true
            send(.object(["type": .string("ping")]))
        }

        func view(_ id: String) -> View? { subscriptions[id]?.view }

        /** A message from the server. One that can't be read, or of a type from a newer minor, is dropped. */
        func receive(_ message: JSON) {
            switch message["type"]?.string {
            case "hello":
                guard let version = message["protocol"], let major = version["major"]?.count, version["minor"]?.count != nil,
                      let agentId = message["server"]?["agentId"]?.string,
                      let incarnation = message["server"]?["incarnation"]?.string else { return }
                hello(major: major, agentId: agentId, incarnation: incarnation)
            case "snapshot":
                guard let id = message["id"]?.string, let rev = message["rev"]?.count, let value = message["value"],
                      var subscription = live(id) else { return }
                apply(id, &subscription, rev: rev, value: value)
                subscription.synced = true
                subscription.resyncing = false
                subscriptions[id] = subscription
            case "ops":
                guard let id = message["id"]?.string, let base = message["base"]?.count, let rev = message["rev"]?.count,
                      let ops = message["ops"]?.array, var subscription = live(id), !subscription.resyncing else { return }
                // Ops for another base, or that don't fit what the client has, mean it lost track.
                let applied = subscription.synced && subscription.view.rev == base
                    ? subscription.view.value.flatMap { Delta.apply(ops, to: $0) } : nil
                if let applied {
                    apply(id, &subscription, rev: rev, value: applied)
                } else {
                    subscription.resyncing = true
                    if subscription.view.value != nil { subscription.view.status = .stale }
                    send(.object(["type": .string("resync"), "id": .string(id)]))
                }
                subscriptions[id] = subscription
            case "error":
                guard let code = message["error"]?["code"]?.string, let text = message["error"]?["message"]?.string else { return }
                let error = LiveError(code: code, message: text, update: message["error"]?["update"]?.string)
                guard let id = message["id"]?.string else {
                    connection = .refused(error)
                    return
                }
                guard var subscription = subscriptions[id] else { return }
                subscription.view.status = .error
                subscription.view.error = error
                if code == "BAD_PARAMS" {
                    subscription.view.value = nil
                    subscription.view.rev = nil
                }
                subscriptions[id] = subscription
            case "pong":
                awaitingPong = false
            default:
                break
            }
        }

        private var isOpen: Bool { if case .open = connection { true } else { false } }

        private func hello(major server: Int, agentId: String, incarnation: String) {
            guard connection == .connecting else { return }
            if server != major {
                let update = major < server ? "app" : "server"
                connection = .refused(LiveError(code: "PROTOCOL_MISMATCH", message: "The \(update) has to update to talk to this server.", update: update))
                return
            }
            if let known = self.incarnation, known != incarnation {
                // A restore or a move: what the client has may be newer than the agent's state now,
                // and its revisions mean nothing there.
                for id in order where subscriptions[id]?.view.status != .error {
                    subscriptions[id]?.view.status = .loading
                    subscriptions[id]?.view.rev = nil
                    subscriptions[id]?.view.value = nil
                }
            }
            self.incarnation = incarnation
            connection = .open(agentId: agentId, incarnation: incarnation)
            for id in order {
                guard let view = subscriptions[id]?.view, view.status != .error else { continue }
                send(.object(["type": .string("sub"), "id": .string(id), "view": .string(view.view), "params": view.params]))
            }
        }

        /** The subscription a snapshot or ops are for, unless it ended. */
        private func live(_ id: String) -> Subscription? {
            guard let subscription = subscriptions[id], subscription.view.status != .error else { return nil }
            return subscription
        }

        private func apply(_ id: String, _ subscription: inout Subscription, rev: Int, value: JSON) {
            subscription.view.rev = rev
            subscription.view.value = value
            subscription.view.status = .fresh
            send(.object(["type": .string("ack"), "id": .string(id), "rev": .number(Double(rev))]))
        }
    }
}
