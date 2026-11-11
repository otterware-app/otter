import Foundation

extension Varys {
    /**
     * What happens in a thread's turn, in the order it happened (the SDK's `TurnEvent`). A turn
     * is the agent's work on one thing until it rests: the work `started` (with the routine that
     * made the thread, for one of its runs); an owner's `message` it takes; the answer being
     * written grew by a `text` delta; an `answer` is finished (its text replaces the deltas); a
     * tool call's `step` and its `result`; a `note` (something the agent was told outside the
     * conversation); an `approval` or `question` waits for the owner, until it's resolved; the
     * work is `waiting` for the owner's answer, and `resumed` once it came; and how it ended.
     */
    nonisolated enum TurnEvent: Equatable {
        case started(since: String?, routine: JSON?)
        case message(JSON)
        case text(String)
        case answer(JSON)
        case step(id: String, tool: String, summary: String?)
        case result(JSON)
        case note(JSON)
        case approval(JSON)
        case approvalResolved(String)
        case question(JSON)
        case questionResolved(String)
        case waiting
        case resumed(since: String?)
        case done
        case stopped
        case failed(reason: String, message: String)

        var isEnd: Bool {
            switch self {
            case .done, .stopped, .failed: true
            default: false
            }
        }
    }

    /**
     * Turn events from a thread's views, ported from the SDK's `TurnReader`: what changed between
     * one value of the thread view (and of its inbox) and the next. It keeps only what it needs
     * to tell what's new, so a reconnect's fresh snapshot brings only what was missed, and a
     * reader that starts mid-answer brings the run so far.
     *
     * The thread view shows a run as `conversation.running` (the answer being written, which
     * starts over with each model call, and its tool calls); a finished answer, a tool's result,
     * a note or an owner's message becomes an item; `failure` says why the last run ended
     * without an answer (`aborted` when it was stopped). `waiting` says the work stopped to ask
     * the owner: its run ended, and the run the answer starts goes on with it, in the same turn.
     * A newer message of the owner's, or a stop, ends that wait.
     */
    nonisolated final class TurnReader {
        enum Start: Equatable {
            /** Whatever the thread does from now on; a run going on shows from its start. */
            case now
            /** The one turn the owner's message sent with this request id starts or joins. */
            case request(String)
        }

        /** `unseen`: a request's message isn't in the conversation yet; `asking`: the turn waits for the owner. */
        private enum Phase { case new, unseen, idle, running, asking, ended }

        private let start: Start
        private var phase = Phase.new
        private var seen = Set<String>()
        private var called = Set<String>()
        private var streamed = ""
        /** The answer that just finished, while the view may still show it as being written. */
        private var finished: String?
        private var pending: [(id: String, isApproval: Bool)] = []
        private var inboxItems: [JSON] = []

        init(_ start: Start) { self.start = start }

        /** Whether a request's turn is over: nothing more comes. */
        var ended: Bool { phase == .ended }

        func thread(_ view: JSON) -> [TurnEvent] {
            guard let conversation = view["conversation"], conversation["loaded"]?.bool == true, phase != .ended else { return [] }
            let items = conversation["items"]?.array ?? []
            let running = conversation["running"].map { !$0.isNull } ?? false
            // Only while nothing runs: a run going on works, whatever an older value said.
            let asking = !running && conversation["waiting"]?.bool == true
            var events: [TurnEvent] = []

            if phase == .new {
                if start == .now {
                    history(items.prefix(running ? Self.runStart(conversation) : items.count))
                    phase = .idle
                } else {
                    phase = .unseen
                }
            }

            if phase == .unseen, case .request(let requestId) = start {
                guard let at = items.firstIndex(where: { $0["type"]?.string == "message" && $0["requestId"]?.string == requestId }) else {
                    history(items[...])
                    return events
                }
                history(items.prefix(at))
                phase = .idle
                // Its run may be over already: it was stopped while queued, or it ran meanwhile.
                if items[at]["stopped"]?.bool == true {
                    begin(&events, view)
                    show(items, &events)
                    return end(&events, .stopped)
                }
                if !running && (at < items.count - 1 || conversation["failure"].map { !$0.isNull } == true || asking) {
                    begin(&events, view)
                }
            }

            if phase == .idle {
                if !running && !asking {
                    // Between runs, what's added isn't part of a turn; a request's own message waits for it.
                    if start == .now { history(items[...]) }
                    return events
                }
                // A turn that waits for the owner when the reader comes in shows from there.
                if !running { history(items[...]) }
                begin(&events, view)
            }

            if phase == .asking {
                if asking {
                    show(items, &events)
                    return events
                }
                if ownerSaidSince(items) {
                    // The owner sent a new message instead of answering: it starts a turn of its own.
                    _ = end(&events, .done)
                    if start != .now { return events }
                    begin(&events, view)
                } else if running || items.contains(where: { !seen.contains(Self.key($0)) }) {
                    // The answer's run goes on with the work; it may have ended already, between values.
                    phase = .running
                    streamed = ""
                    finished = nil
                    events.append(.resumed(since: conversation["running"]?["since"]?.string))
                } else {
                    // The wait ended and nothing came of it: only a stop does that.
                    return end(&events, .stopped)
                }
            }

            let begun = events.contains { if case .started = $0 { true } else { false } }
            show(items, &events)
            forgetGone(conversation)
            if let run = conversation["running"], !run.isNull {
                text(run["answer"]?.string ?? "", &events)
                for step in run["steps"]?.array ?? [] {
                    guard let id = step["callId"]?.string else { continue }
                    self.step(&events, id, step["tool"]?.string ?? "", step["summary"]?.string)
                }
                // What waited for the owner when the reader came in is part of the run so far.
                if begun { events += inboxChanges() }
                return events
            }
            if asking {
                // The run stopped to ask: the turn waits for the answer, which may reach the inbox later.
                phase = .asking
                events.append(.waiting)
                events += inboxChanges()
                return events
            }
            return end(&events, Self.end(of: conversation["failure"]))
        }

        func inbox(_ inbox: JSON) -> [TurnEvent] {
            inboxItems = inbox["items"]?.array ?? []
            return phase == .running || phase == .asking ? inboxChanges() : []
        }

        private func begin(_ events: inout [TurnEvent], _ view: JSON) {
            phase = .running
            streamed = ""
            finished = nil
            // A routine's run starts on its instructions, never on a message of the owner's.
            let routine = view["routine"].flatMap { $0.isNull ? nil : $0 }
            let ownRun = start == .now && !ownerSaidSince(view["conversation"]?["items"]?.array ?? [])
            events.append(.started(since: view["conversation"]?["running"]?["since"]?.string, routine: ownRun ? routine : nil))
        }

        /** Whether the owner said something the reader hasn't shown yet. */
        private func ownerSaidSince(_ items: [JSON]) -> Bool {
            items.contains { $0["type"]?.string == "message" && !seen.contains(Self.key($0)) }
        }

        private func end(_ events: inout [TurnEvent], _ end: TurnEvent) -> [TurnEvent] {
            events.append(end)
            phase = start == .now ? .idle : .ended
            pending = []
            return events
        }

        /** The view holds the newest items, so what leaves it never comes back: forgotten. */
        private func forgetGone(_ conversation: JSON) {
            let items = conversation["items"]?.array ?? []
            seen.formIntersection(items.map(Self.key))
            var calls = Set<String>()
            for item in items {
                if item["type"]?.string == "answer" { calls.formUnion((item["calls"]?.array ?? []).compactMap { $0["id"]?.string }) }
                if item["type"]?.string == "result", let id = item["callId"]?.string { calls.insert(id) }
            }
            calls.formUnion((conversation["running"]?["steps"]?.array ?? []).compactMap { $0["callId"]?.string })
            called.formIntersection(calls)
        }

        private func history(_ items: ArraySlice<JSON>) {
            for item in items { seen.insert(Self.key(item)) }
        }

        private func show(_ items: [JSON], _ events: inout [TurnEvent]) {
            for item in items {
                guard seen.insert(Self.key(item)).inserted else { continue }
                switch item["type"]?.string {
                case "message":
                    events.append(.message(item))
                case "answer":
                    // The deltas of an answer add up to it: what wasn't shown yet comes first.
                    let text = item["text"]?.string ?? ""
                    if let rest = Self.rest(of: text, after: streamed), !rest.isEmpty { events.append(.text(rest)) }
                    events.append(.answer(item))
                    streamed = ""
                    finished = text
                    for call in item["calls"]?.array ?? [] {
                        guard let id = call["id"]?.string else { continue }
                        step(&events, id, call["tool"]?.string ?? "", call["summary"]?.string)
                    }
                case "result":
                    if let id = item["callId"]?.string { step(&events, id, item["tool"]?.string ?? "", nil) }
                    events.append(.result(item))
                case "note":
                    events.append(.note(item))
                default:
                    break
                }
            }
        }

        private func text(_ answer: String, _ events: inout [TurnEvent]) {
            if answer.isEmpty {
                // A new model call starts its answer over.
                streamed = ""
                finished = nil
                return
            }
            if let finished {
                // The view may still show the finished answer as being written.
                if Self.rest(of: finished, after: answer) != nil { return }
                self.finished = nil
            }
            if let rest = Self.rest(of: answer, after: streamed) {
                if !rest.isEmpty { events.append(.text(rest)) }
            } else {
                // Another answer than the one shown, whose start the reader missed: from its start.
                events.append(.text(answer))
            }
            streamed = answer
        }

        private func step(_ events: inout [TurnEvent], _ id: String, _ tool: String, _ summary: String?) {
            guard called.insert(id).inserted else { return }
            events.append(.step(id: id, tool: tool, summary: summary))
        }

        private func inboxChanges() -> [TurnEvent] {
            var events: [TurnEvent] = []
            var now = Set<String>()
            for item in inboxItems {
                let type = item["type"]?.string
                guard type == "approval" || type == "question", let id = item["id"]?.string else { continue }
                now.insert(id)
                if pending.contains(where: { $0.id == id }) { continue }
                pending.append((id, type == "approval"))
                events.append(type == "approval" ? .approval(item) : .question(item))
            }
            for ask in pending where !now.contains(ask.id) {
                events.append(ask.isApproval ? .approvalResolved(ask.id) : .questionResolved(ask.id))
            }
            pending.removeAll { !now.contains($0.id) }
            return events
        }

        /** What follows `prefix` in `text`, compared in UTF-16 code units as JavaScript does; nil when it doesn't start with it. */
        private static func rest(of text: String, after prefix: String) -> String? {
            guard text.utf16.starts(with: prefix.utf16) else { return nil }
            return String(decoding: text.utf16.dropFirst(prefix.utf16.count), as: UTF16.self)
        }

        /** An item across values: an owner's message keeps its request id from admission to its place. */
        private static func key(_ item: JSON) -> String {
            if item["type"]?.string == "message", let request = item["requestId"]?.string { return "request:\(request)" }
            return item["id"]?.string ?? ""
        }

        /** Where the running run's items start: the first said at or after it started; none known without that time. */
        private static func runStart(_ conversation: JSON) -> Int {
            let items = conversation["items"]?.array ?? []
            guard let since = conversation["running"]?["since"]?.string else { return items.count }
            return items.firstIndex { $0["type"]?.string != "result" && ($0["at"]?.string).map { $0 >= since } == true } ?? items.count
        }

        private static func end(of failure: JSON?) -> TurnEvent {
            guard let failure, !failure.isNull else { return .done }
            if failure["reason"]?.string == "aborted" { return .stopped }
            return .failed(reason: failure["reason"]?.string ?? "", message: failure["message"]?.string ?? "")
        }
    }
}
