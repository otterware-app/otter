import Foundation
import Testing
@testable import Otter_Agents

// `Varys/` is recorded by varys: its Live protocol's fixtures (`live-*.json`) and its SDK's recorded turns (`turn-*.json`).

/**
 * varys's recorded Live exchanges (`packages/live/fixtures` in varys, here as `Varys/live-*.json`),
 * replayed from the client's side as varys's TypeScript client replays them: each `client` step
 * must be the next message the client sent, each `server` or `inject` step is received, and each
 * `expect` must match. Otter follows no streams, caches no views across launches and waits on no
 * receipt's revision, so the fixtures for those (frames-backpressure, restore-new-incarnation,
 * command-receipt) aren't here.
 */
@MainActor
struct VarysLiveTests {
    @Test(arguments: [
        "snapshot-and-ops", "gap-and-resync", "jump-to-snapshot", "merged-changes", "reconnect", "refused-ticket",
        "deleted-thread", "limit-reached", "newer-minor-and-refused-view", "protocol-mismatch",
    ])
    func replaysTheProtocolsFixture(_ name: String) throws {
        let fixture = try VarysFixture.load("live-\(name)")
        let version = fixture["protocol"]?["client"]
        var sent: [Varys.JSON] = []
        let live = Varys.Live(protocol: (version?["major"]?.count ?? 1, version?["minor"]?.count ?? 0)) { sent.append($0) }

        for (index, step) in (fixture["steps"]?.array ?? []).enumerated() {
            let at = "step \(index)\(step["note"]?.string.map { " (\($0))" } ?? "")"
            if let connect = step["connect"] {
                live.opened(ticket: connect["ticket"]?.string ?? "")
            } else if step["disconnect"] != nil {
                // What was on its way is lost with the connection.
                sent = []
                live.closed()
            } else if let app = step["app"] {
                if let subscribe = app["subscribe"] {
                    live.subscribe(subscribe["id"]?.string ?? "", view: subscribe["view"]?.string ?? "", params: subscribe["params"] ?? .object([:]))
                } else if let id = app["unsubscribe"]?["id"]?.string {
                    live.unsubscribe(id)
                } else if app["ping"] != nil {
                    live.ping()
                } else {
                    Issue.record("\(at): an app step Otter doesn't take")
                }
            } else if let message = step["client"] {
                #expect(sent.first == message, "\(at)")
                if !sent.isEmpty { sent.removeFirst() }
            } else if let message = step["server"] ?? step["inject"] {
                live.receive(message)
            } else if let expected = step["expect"] {
                check(live, expected, at)
            }
            // `source` steps are the server's own state: the server's messages say what came of them.
        }
        #expect(sent.isEmpty, "messages the client sent that the fixture doesn't list")
    }

    private func check(_ live: Varys.Live, _ expected: Varys.JSON, _ at: String) {
        if let connection = expected["connection"]?.string {
            let state = switch live.connection {
            case .closed: "closed"
            case .connecting: "connecting"
            case .open: "open"
            case .refused: "refused"
            }
            #expect(state == connection, "\(at): connection")
        }
        for (id, view) in expected["views"]?.object ?? [:] {
            let actual = live.view(id)
            guard view != .null else {
                #expect(actual == nil, "\(at): \(id) is gone")
                continue
            }
            if view["cleared"]?.bool == true { #expect(actual?.value == nil && actual?.rev == nil, "\(at): \(id) is cleared") }
            #expect(actual?.status.rawValue == view["status"]?.string, "\(at): \(id)'s status")
            if let rev = view["rev"] { #expect(actual?.rev == rev.count, "\(at): \(id)'s rev") }
            if let value = view["value"] { #expect(actual?.value == value, "\(at): \(id)'s value") }
        }
        if let awaiting = expected["awaitingPong"]?.bool { #expect(live.awaitingPong == awaiting, "\(at): awaiting a pong") }
    }

    @Test func dropsAnIncarnationsValuesWhenTheAgentComesBackAsAnother() {
        var sent: [Varys.JSON] = []
        let live = Varys.Live { sent.append($0) }
        live.subscribe("s1", view: "thread", params: .object(["id": .string("t1")]))
        live.opened(ticket: "t")
        live.receive(Self.hello("inc-1"))
        live.receive(.object(["type": .string("snapshot"), "id": .string("s1"), "rev": .number(7), "value": .object(["title": .string("Dinner")])]))
        live.closed()
        #expect(live.view("s1")?.status == .stale)
        live.opened(ticket: "t")
        live.receive(Self.hello("inc-2"))
        #expect(live.view("s1")?.status == .loading)
        #expect(live.view("s1")?.value == nil)
    }

    @Test func appliesChordsOps() throws {
        let value: Varys.JSON = .object(["items": .array([.string("a"), .string("b"), .string("c")]), "answer": .string("😀 hi")])
        let ops: [Varys.JSON] = [
            .array([.string("p"), .array([.string("items")]), .number(1), .number(1), .array([.string("x"), .string("y")])]),
            .array([.string("m"), .array([.string("items")]), .array([.number(3), .number(2), .number(1), .number(0)])]),
            // UTF-16 code units, as JavaScript counts: the emoji is two.
            .array([.string("t"), .array([.string("answer")]), .number(3)]),
            .array([.string("a"), .array([.string("answer")]), .string("!")]),
        ]
        let applied = try #require(Varys.Delta.apply(ops, to: value))
        #expect(applied["items"] == .array([.string("c"), .string("y"), .string("x"), .string("a")]))
        #expect(applied["answer"] == .string("hi!"))
        #expect(Varys.Delta.apply([.array([.string("s"), .array([.string("missing"), .string("key")]), .null])], to: value) == nil)
        #expect(Varys.Delta.apply([.array([.string("z")])], to: value) == nil)
    }

    private static func hello(_ incarnation: String) -> Varys.JSON {
        .object(["type": .string("hello"), "protocol": .object(["major": .number(1), "minor": .number(0)]),
                 "server": .object(["agentId": .string("agent-1"), "incarnation": .string(incarnation)])])
    }
}

enum VarysFixture {
    private final class Token {}

    static func load(_ name: String) throws -> Varys.JSON {
        let url = try #require(Bundle(for: Token.self).url(forResource: name, withExtension: "json"))
        return try Varys.JSON(parsing: Data(contentsOf: url))
    }
}
