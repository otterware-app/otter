import Foundation
import Testing
@testable import Otter_Agents

@MainActor
struct VarysTurnTests {
    /** A turn varys recorded (its SDK's `fixtures/turns`): each view's first value, then its changes, in order. */
    private func recorded(_ name: String) throws -> (requestId: String, end: Varys.TurnEvent, values: [(view: String, value: Varys.JSON)]) {
        let recording = try VarysFixture.load("turn-\(name)")
        var last: [String: Varys.JSON] = [:]
        var values: [(String, Varys.JSON)] = []
        for step in recording["steps"]?.array ?? [] {
            let view = step["view"]?.string ?? ""
            let value = try #require(step["snapshot"] ?? Varys.Delta.apply(step["ops"]?.array ?? [], to: last[view] ?? .null))
            last[view] = value
            values.append((view, value))
        }
        let end: Varys.TurnEvent = switch recording["end"]?["type"]?.string {
        case "done": .done
        case "stopped": .stopped
        default: .failed(reason: recording["end"]?["reason"]?.string ?? "", message: recording["end"]?["message"]?.string ?? "")
        }
        return (recording["requestId"]?.string ?? "", end, values)
    }

    private func read(_ reader: Varys.TurnReader, _ values: some Sequence<(view: String, value: Varys.JSON)>) -> [Varys.TurnEvent] {
        values.flatMap { $0.view == "thread" ? reader.thread($0.value) : reader.inbox($0.value) }
    }

    private func deltas(_ events: [Varys.TurnEvent]) -> String {
        events.compactMap { if case .text(let delta) = $0 { delta } else { nil } }.joined()
    }

    private func answers(_ events: [Varys.TurnEvent]) -> String {
        events.compactMap { if case .answer(let answer) = $0 { answer["text"]?.string } else { nil } }.joined()
    }

    @Test(arguments: ["streamed-answer", "approval", "stop", "slow-answer", "asking"])
    func endsARecordedTurnAsItDidItsDeltasAddingUpToItsAnswers(_ name: String) throws {
        let (requestId, end, values) = try recorded(name)
        let reader = Varys.TurnReader(.request(requestId))
        let events = read(reader, values)
        guard case .started = events.first else { Issue.record("it starts with started"); return }
        guard case .message = events.dropFirst().first else { Issue.record("then the user's message"); return }
        #expect(events.last == end)
        #expect(reader.ended)
        if end == .done { #expect(deltas(events) == answers(events)) }
    }

    @Test func anApprovalComesBeforeItsToolRunsAndGoesOnceDecided() throws {
        let (requestId, _, values) = try recorded("approval")
        let events = read(Varys.TurnReader(.request(requestId)), values)
        let asked = try #require(events.firstIndex { if case .approval = $0 { true } else { false } })
        let resolved = try #require(events.firstIndex { if case .approvalResolved = $0 { true } else { false } })
        #expect(asked < resolved)
        guard case .step(let id, let tool, _) = events.first(where: { if case .step = $0 { true } else { false } }) else {
            Issue.record("a step came")
            return
        }
        #expect(tool == "forget")
        guard case .result(let result) = events.last(where: { if case .result = $0 { true } else { false } }) else {
            Issue.record("its result came")
            return
        }
        #expect(result["callId"]?.string == id)
    }

    @Test func aTurnThatStopsToAskWaitsAndGoesOnWithTheSameWork() throws {
        let (requestId, _, values) = try recorded("asking")
        let reader = Varys.TurnReader(.request(requestId))
        var events: [Varys.TurnEvent] = []
        var endedWhileWaiting = false
        for value in values {
            events += value.view == "thread" ? reader.thread(value.value) : reader.inbox(value.value)
            if events.contains(.waiting), !events.contains(where: { if case .resumed = $0 { true } else { false } }) {
                endedWhileWaiting = endedWhileWaiting || reader.ended
            }
        }
        let waiting = try #require(events.firstIndex(of: .waiting))
        let resumed = try #require(events.firstIndex { if case .resumed = $0 { true } else { false } })
        #expect(waiting < resumed)
        #expect(events.contains { if case .approval = $0 { true } else { false } })
        #expect(!endedWhileWaiting)
        #expect(events.filter(\.isEnd) == [.done])
    }

    private static let message: Varys.JSON = .object([
        "type": .string("message"), "id": .string("2"), "text": .string("Send Ann the menu"), "requestId": .string("r1"), "stopped": .bool(false),
    ])
    private static let parked: [Varys.JSON] = [
        message,
        .object(["type": .string("answer"), "id": .string("3"), "text": .string("I'll send it."), "calls": .array([])]),
    ]

    private static func thread(_ items: [Varys.JSON], running: Bool = false, waiting: Bool = false, routine: Varys.JSON = .null) -> Varys.JSON {
        .object(["routine": routine, "conversation": .object([
            "loaded": .bool(true), "items": .array(items), "failure": .null, "waiting": .bool(waiting),
            "running": running ? .object(["answer": .string(""), "steps": .array([])]) : .null,
        ])])
    }

    @Test func aTurnThatWaitsEndsDoneWhenAMessageComesInsteadAndStoppedWhenStopped() {
        let insteadOf = Varys.TurnReader(.request("r1"))
        _ = insteadOf.thread(Self.thread([Self.message], running: true))
        #expect(insteadOf.thread(Self.thread(Self.parked, waiting: true)).last == .waiting)
        let next: Varys.JSON = .object(["type": .string("message"), "id": .string("admitted:r2"), "text": .string("Never mind"),
                                        "requestId": .string("r2"), "stopped": .bool(false)])
        #expect(insteadOf.thread(Self.thread(Self.parked + [next], running: true)) == [.done])

        let stopped = Varys.TurnReader(.request("r1"))
        _ = stopped.thread(Self.thread([Self.message], running: true))
        _ = stopped.thread(Self.thread(Self.parked, waiting: true))
        #expect(stopped.thread(Self.thread(Self.parked)) == [.stopped])
    }

    @Test func aRoutinesRunSaysWhichRoutineStartedIt() {
        let routine: Varys.JSON = .object(["id": .string("routine-1"), "title": .string("Morning brief")])
        let instructions: Varys.JSON = .object(["type": .string("note"), "id": .string("2"), "text": .string("Brief me.")])
        let reader = Varys.TurnReader(.now)
        _ = reader.thread(Self.thread([], routine: routine))
        #expect(reader.thread(Self.thread([instructions], running: true, routine: routine)).first == .started(since: nil, routine: routine))
    }

    /** As after the app comes back: a reader that starts mid-answer brings it so far, then the rest. */
    @Test func picksATurnUpMidAnswer() throws {
        let (requestId, _, values) = try recorded("slow-answer")
        let middle = try #require(values.firstIndex {
            $0.view == "thread" && ($0.value["conversation"]?["running"]?["answer"]?.string?.count ?? 0) > 40
        })
        let reader = Varys.TurnReader(.request(requestId))
        let inbox = values[..<middle].last { $0.view == "threadInbox" }
        let events = read(reader, [values[middle]] + (inbox.map { [$0] } ?? []) + values[(middle + 1)...])
        guard case .started = events.first else { Issue.record("it starts with started"); return }
        guard case .text(let first) = events.first(where: { if case .text = $0 { true } else { false } }) else {
            Issue.record("text came")
            return
        }
        #expect(first.count > 40)
        #expect(deltas(events) == answers(events))
        #expect(events.last == .done)
    }

    @Test func aReaderFromNowShowsOnlyWhatComesAfterIt() throws {
        let (_, _, values) = try recorded("streamed-answer")
        let done = values.last { $0.view == "thread" }!.value
        let reader = Varys.TurnReader(.now)
        #expect(reader.thread(done).isEmpty)
        #expect(reader.thread(done).isEmpty)
    }
}
