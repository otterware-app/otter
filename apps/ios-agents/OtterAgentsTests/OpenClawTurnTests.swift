import Foundation
import Testing
@testable import Otter_Agents

/** A turn as the gateway's session rows tell it, the cases of extensions/openclaw/core/openclaw-yield.test.ts. */
@MainActor
struct OpenClawTurnTests {
    private let sent: [String: Any] = ["role": "user", "content": "Watch the checks", "__openclaw": ["idempotencyKey": "req-1:user"]]
    private let yieldCall: [String: Any] = [
        "role": "assistant", "content": [["type": "toolCall", "id": "y-1", "name": "sessions_yield", "arguments": [String: Any]()]],
        "__openclaw": ["runId": "req-1"],
    ]
    private let yieldResult: [String: Any] = [
        "role": "toolResult", "toolCallId": "y-1", "toolName": "sessions_yield",
        "content": [["type": "text", "text": "{\n  \"status\": \"yielded\"\n}"]], "__openclaw": ["runId": "req-1"],
    ]

    private func said(_ run: String, _ text: String) -> [String: Any] {
        ["role": "assistant", "content": [["type": "text", "text": text]], "__openclaw": ["runId": run]]
    }

    private func spawn(_ run: String, _ arguments: [String: Any]) -> [String: Any] {
        ["role": "assistant", "content": [["type": "toolCall", "id": UUID().uuidString, "name": "sessions_spawn", "arguments": arguments]],
         "__openclaw": ["runId": run]]
    }

    private func same(_ rows: [[String: Any]]?, _ expected: [[String: Any]]) -> Bool {
        rows.map { NSArray(array: $0).isEqual(to: expected) } ?? false
    }

    @Test func itWaitsOnlyWhileNothingHasComeAfterAnAcceptedYield() {
        #expect(OpenClaw.waitingOnYield([sent, yieldCall, yieldResult]))
        // The run's own empty closing row doesn't end the wait.
        #expect(OpenClaw.waitingOnYield([sent, yieldCall, yieldResult, said("req-1", "")]))
        #expect(!OpenClaw.waitingOnYield([sent, yieldCall, yieldResult, said("announce:1", "Done.")]))
        var nothing = yieldResult
        nothing["content"] = [["type": "text", "text": "{\"status\":\"nothing_pending\"}"]]
        #expect(!OpenClaw.waitingOnYield([sent, yieldCall, nothing]))
    }

    @Test func aTurnThatYieldedIsStillWaitingWhenReadAgain() {
        let turn = OpenClaw.turn(in: [said("earlier", "Before."), sent, yieldCall, yieldResult], run: "req-1")
        #expect(same(turn?.rows, [yieldCall, yieldResult]))
        #expect(turn?.waiting == true)
        #expect(OpenClaw.turn(in: [yieldCall, yieldResult], run: "req-1") == nil)
    }

    @Test func theRunItsCompletionStartsJoinsTheTurn() {
        let continuation = said("announce:1", "All checks passed.")
        let turn = OpenClaw.turn(in: [sent, said("req-1", "Watching."), yieldCall, yieldResult, continuation], run: "req-1")
        #expect(same(turn?.rows, [said("req-1", "Watching."), yieldCall, yieldResult, continuation]))
        #expect(turn?.waiting == false)
        // The yield is the turn waiting, not a step of it.
        let shown = OpenClaw.transcript(turn?.rows ?? [])
        #expect(shown.map(\.text) == ["Watching.", "All checks passed."])
        #expect(shown.flatMap(\.steps).isEmpty)
    }

    @Test func aMessageSentAfterTheYieldEndsTheTurnThere() {
        let later: [String: Any] = ["role": "user", "content": "and?", "__openclaw": ["idempotencyKey": "req-2:user"]]
        let rows = [sent, yieldCall, yieldResult, later, said("req-2", "Sure."), said("announce:1", "Checks passed.")]
        let turn = OpenClaw.turn(in: rows, run: "req-1")
        #expect(same(turn?.rows, [yieldCall, yieldResult]))
        #expect(turn?.waiting == false)
    }

    @Test func aTurnIsItsRunItsContinuationAndItsSteersNotAWakeAfter() {
        let steer: [String: Any] = ["role": "user", "content": "also this", "__openclaw": ["idempotencyKey": "steer-1:user"]]
        let rows = [sent, said("req-1", "First."), steer, said("steer-1", "Also done."), said("wake-1", "A wake.")]
        #expect(same(OpenClaw.turn(in: rows, run: "req-1")?.rows, [said("req-1", "First."), steer, said("steer-1", "Also done.")]))
    }

    @Test func aDeliveryDoesNotComeBetweenAYieldAndItsContinuation() {
        let delivery: [String: Any] = ["role": "assistant", "content": [["type": "text", "text": "Daily summary."]], "model": "automation-result",
                                       "__openclaw": ["id": "d-1"]]
        let continuation = said("announce:1", "Subagents done.")
        #expect(same(OpenClaw.turn(in: [sent, yieldCall, yieldResult, delivery, continuation], run: "req-1")?.rows, [yieldCall, yieldResult, continuation]))
        // Still waiting with a delivery after the yield: what starts next is the continuation.
        #expect(OpenClaw.turn(in: [sent, yieldCall, yieldResult, delivery], run: "req-1")?.waiting == true)
    }

    @Test func itWaitsOnTheSubagentsTheRunThatYieldedStarted() {
        let first = [sent, spawn("req-1", ["label": "Research pricing", "task": "Compare the venues"]), yieldCall, yieldResult]
        #expect(OpenClaw.spawned(in: first) == ["Research pricing"])
        // The continuation's own subagents, not those it was woken by.
        let again = first + [spawn("announce:1", ["task": "Check the dates"]), spawn("announce:1", ["label": "Flights"])]
        #expect(OpenClaw.spawned(in: again) == [nil, "Flights"])
        #expect(OpenClaw.spawned(in: [sent, yieldCall, yieldResult]).isEmpty)
        #expect(OpenClaw.stepName("sessions_spawn", ["label": "Research pricing"]) == "Started Research pricing")
        #expect(OpenClaw.stepName("sessions_spawn", ["task": "Check the dates"]) == "Started a subagent")
    }
}
