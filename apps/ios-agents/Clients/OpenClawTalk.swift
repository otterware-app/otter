import Foundation

/**
 * A call with an OpenClaw agent in a chat's session: Talk over the gateway's relay, which holds the
 * voice (GPT-Live) and asks the agent for it. What you say streams in, what it says streams back.
 * extensions/openclaw/core/openclaw-talk.ts.
 */
final class OpenClawCall {
    nonisolated enum Event: Equatable {
        case ready
        /** Mono 16-bit PCM at `outputRate`. */
        case audio(Data)
        /** You spoke over it: what's queued to play stops. */
        case clear
        /** Played once what came before it has: `played`. */
        case mark(String)
        case transcript(user: Bool, text: String, final: Bool)
        case closed(String?)
    }

    let id: String
    let session: String
    let inputRate: Double
    let outputRate: Double
    private let gateway: OpenClaw
    private let events: (Event) -> Void
    private var listener: UUID?
    private var error: String?
    /** Consults the agent is answering for the voice, by call: each one's end. */
    private var consults: [String: () -> Void] = [:]
    private var runs: [String: ([String: Any]) -> Void] = [:]

    private static let consultTool = "openclaw_agent_consult"
    private static let consultTimeout: Duration = .seconds(120)

    private init(id: String, session: String, inputRate: Double, outputRate: Double, gateway: OpenClaw, events: @escaping (Event) -> Void) {
        self.id = id
        self.session = session
        self.inputRate = inputRate
        self.outputRate = outputRate
        self.gateway = gateway
        self.events = events
    }

    static func start(on gateway: OpenClaw, session: String, events: @escaping (Event) -> Void) async throws -> OpenClawCall {
        let created: [String: Any]
        do {
            created = try await gateway.request("talk.session.create", [
                "sessionKey": session, "mode": "realtime", "transport": "gateway-relay", "brain": "agent-consult",
            ]) as? [String: Any] ?? [:]
        } catch {
            throw OpenClaw.Failure(message: "OpenClaw can't talk: \(plain(error))")
        }
        let id = created["relaySessionId"] as? String ?? created["sessionId"] as? String ?? ""
        let audio = created["audio"] as? [String: Any] ?? [:]
        guard !id.isEmpty, audio["inputEncoding"] as? String == "pcm16", audio["outputEncoding"] as? String == "pcm16" else {
            if !id.isEmpty { _ = try? await gateway.request("talk.session.close", ["sessionId": id]) }
            throw OpenClaw.Failure(message: "OpenClaw's voice sends audio Otter can't play.")
        }
        let call = OpenClawCall(
            id: id, session: session,
            inputRate: (audio["inputSampleRateHz"] as? NSNumber)?.doubleValue ?? 24_000,
            outputRate: (audio["outputSampleRateHz"] as? NSNumber)?.doubleValue ?? 24_000,
            gateway: gateway, events: events)
        call.listener = gateway.listen({ [weak call] name, payload in call?.heard(name, payload) },
                                       closed: { [weak call] in call?.closed("Lost the connection to your gateway.") })
        return call
    }

    func send(_ pcm: Data) async throws {
        try await gateway.request("talk.session.appendAudio", ["sessionId": id, "audioBase64": pcm.base64EncodedString()], timeout: 8)
    }

    func played(_ mark: String) {
        Task { _ = try? await gateway.request("talk.session.acknowledgeMark", ["sessionId": id, "markName": mark]) }
    }

    /** Ending a call leaves what the agent was asked going: its answer still comes to the chat. */
    func end() {
        guard stop() else { return }
        let detach = gateway.capabilities.contains("talk-session-close-disposition")
        Task { _ = try? await gateway.request("talk.session.close", ["sessionId": id].merging(detach ? ["disposition": "detach"] : [:]) { $1 }) }
    }

    @discardableResult
    private func stop() -> Bool {
        guard let listener else { return false }
        gateway.unlisten(listener)
        self.listener = nil
        for end in consults.values { end() }
        return true
    }

    private func closed(_ error: String?) {
        guard stop() else { return }
        events(.closed(error))
    }

    private func heard(_ name: String, _ payload: [String: Any]) {
        if name == "chat" {
            if let run = payload["runId"] as? String { runs[run]?(payload) }
            return
        }
        guard name == "talk.event", payload["relaySessionId"] as? String == id else { return }
        switch payload["type"] as? String {
        case "ready":
            events(.ready)
        case "audio":
            if let audio = (payload["audioBase64"] as? String).flatMap({ Data(base64Encoded: $0) }) { events(.audio(audio)) }
        case "clear":
            events(.clear)
        case "mark":
            if let mark = payload["markName"] as? String { events(.mark(mark)) }
        case "transcript":
            let role = payload["role"] as? String
            guard role == "user" || role == "assistant", let text = payload["text"] as? String, !text.isEmpty else { return }
            events(.transcript(user: role == "user", text: text, final: payload["final"] as? Bool ?? false))
        case "toolCall":
            consult(payload)
        case "toolCallCancelled":
            (payload["callId"] as? String).flatMap { consults[$0] }?()
        case "toolResult":
            // The gateway answered it itself.
            let event = payload["talkEvent"] as? [String: Any]
            if event?["type"] as? String != "tool.progress", event?["final"] as? Bool != false {
                (payload["callId"] as? String).flatMap { consults[$0] }?()
            }
        case "error":
            error = (payload["message"] as? String).map(Self.plain)
        case "close":
            closed(payload["reason"] as? String == "error" ? (error ?? "OpenClaw's voice stopped.") : nil)
        default:
            break
        }
    }

    /**
     * A voice that hands what you asked to the agent through the client (one that can't on its own,
     * as GPT-Live does): the agent runs it in the chat's session, and its answer goes back to the voice.
     */
    private func consult(_ call: [String: Any]) {
        guard let callId = (call["callId"] as? String)?.trimmingCharacters(in: .whitespaces), !callId.isEmpty else { return }
        let submit = { (result: [String: Any]) in
            Task { _ = try? await self.gateway.request("talk.session.submitToolResult", ["sessionId": self.id, "callId": callId, "result": result]) }
        }
        guard call["name"] as? String == Self.consultTool else {
            submit(["error": "Otter's calls don't have \(call["name"] as? String ?? "that tool")."])
            return
        }
        var args = call["args"] ?? [String: Any]()
        if let json = args as? String { args = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) ?? [String: Any]() }
        Task {
            var run: String?
            do {
                let ack = try await gateway.request("talk.client.toolCall", [
                    "sessionKey": session, "callId": callId, "name": Self.consultTool, "args": args, "relaySessionId": id,
                ]) as? [String: Any] ?? [:]
                guard let runId = ack["runId"] as? String else { throw OpenClaw.Failure(message: "OpenClaw didn't start the agent.") }
                run = runId
                let waiting = Waiting()
                let answer = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String, Error>) in
                    waiting.continuation = continuation
                    let settle = { (result: Result<String, Error>) in
                        self.runs[runId] = nil
                        self.consults[callId] = nil
                        waiting.settle(result)
                    }
                    consults[callId] = { settle(.failure(CancellationError())) }
                    runs[runId] = { frame in
                        switch frame["state"] as? String {
                        case "final":
                            let text = OpenClaw.text((frame["message"] as? [String: Any])?["content"]).trimmingCharacters(in: .whitespacesAndNewlines)
                            settle(.success(text.isEmpty ? "OpenClaw finished with no text." : text))
                        case "error", "aborted":
                            settle(.failure(OpenClaw.Failure(message: frame["errorMessage"] as? String ?? "OpenClaw's run stopped.")))
                        default:
                            break
                        }
                    }
                    Task {
                        try? await Task.sleep(for: Self.consultTimeout)
                        settle(.failure(OpenClaw.Failure(message: "OpenClaw took too long.")))
                    }
                }
                if listener != nil { submit(["result": answer]) }
            } catch is CancellationError {
            } catch {
                if let run { runs[run] = nil }
                if listener != nil { submit(["error": Self.plain(error)]) }
            }
        }
    }

    /** A consult's answer, given once. */
    private final class Waiting {
        var continuation: CheckedContinuation<String, Error>?
        func settle(_ result: Result<String, Error>) {
            continuation?.resume(with: result)
            continuation = nil
        }
    }

    private nonisolated static func plain(_ error: Error) -> String { plain(error.localizedDescription) }
    private nonisolated static func plain(_ message: String) -> String {
        message.hasPrefix("Error: ") ? String(message.dropFirst(7)) : message
    }

    /** Whether the gateway has a realtime voice set up that streams through it and asks the agent. */
    static func available(on gateway: OpenClaw) async -> Bool {
        for attempt in 0..<10 {
            do {
                let catalog = try await gateway.request("talk.catalog", [:]) as? [String: Any] ?? [:]
                let realtime = catalog["realtime"] as? [String: Any] ?? [:]
                let providers = realtime["providers"] as? [[String: Any]] ?? []
                return realtime["ready"] as? Bool == true && providers.contains {
                    $0["configured"] as? Bool == true
                        && ($0["transports"] as? [String] ?? []).contains("gateway-relay")
                        && ($0["brains"] as? [String] ?? []).contains("agent-consult")
                }
            } catch let failure as OpenClaw.Failure where failure.code == "UNAVAILABLE" && attempt < 9 {
                // A gateway that just started is still finding its voices.
                try? await Task.sleep(for: .milliseconds(500))
            } catch {
                return false
            }
        }
        return false
    }
}
