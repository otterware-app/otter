import AVFoundation
import Foundation

/**
 * A call with a chat's OpenClaw agent: what you say and what it says go into the chat as they're
 * heard, and what it asks the agent to do runs in the chat's session. apps/web's chat-talk.tsx.
 */
@Observable
final class TalkCall {
    enum Phase: Equatable {
        case connecting
        case live
        /** With why, when it wasn't you who ended it. */
        case ended(String?)
    }

    private(set) var phase: Phase = .connecting
    private(set) var muted = false
    private(set) var liveAt: Date?
    /** The last thing said, as it's heard. */
    private(set) var caption: (user: Bool, text: String)?

    let chatId: String
    @ObservationIgnored private let store: ChatStore
    @ObservationIgnored private var call: OpenClawCall?
    @ObservationIgnored private var audio: TalkAudio?
    @ObservationIgnored private var unsent: Duration = .zero
    @ObservationIgnored private var spokeAt = Date.distantPast
    @ObservationIgnored private var smoothed: Float = 0
    /** The caption is all of what was said: what's heard next starts another. */
    @ObservationIgnored private var captionDone = true

    /** Audio the gateway hasn't taken yet: past this, what the microphone hears is dropped. */
    private static let maxUnsent: Duration = .seconds(3)
    private static let chunk: Duration = .milliseconds(40)
    /** The agent counts as speaking this long after it last made a sound, between words. */
    private static let speakingHold: TimeInterval = 0.6

    init(chatId: String, store: ChatStore) {
        self.chatId = chatId
        self.store = store
    }

    func start() async {
        guard await AVAudioApplication.requestRecordPermission() else {
            return phase = .ended("Otter Agents isn't allowed to use the microphone. Allow it in Settings › Otter Agents.")
        }
        guard let gateway = store.agents.openClawClient, let chat = store.chat(chatId) else {
            return phase = .ended("Connect OpenClaw in Settings to talk with it.")
        }
        let session = chat.sessionId ?? "agent:\(store.agents.model(of: .openclaw)?.slug ?? "main"):otter-mail:\(UUID().uuidString.lowercased())"
        do {
            let call = try await OpenClawCall.start(on: gateway, session: session) { [weak self] in self?.heard($0) }
            guard phase == .connecting else { return call.end() }
            self.call = call
            store.setSession(session, of: chatId)
            audio = try TalkAudio(inputRate: call.inputRate, outputRate: call.outputRate,
                                  send: { [weak self] in self?.send($0) },
                                  interrupted: { [weak self] in self?.end() })
        } catch {
            hangUp()
            phase = .ended(error.localizedDescription)
        }
    }

    /** Hangs up; what the agent was asked to do goes on, and its answer still comes to the chat. */
    func end() {
        hangUp()
        if phase == .connecting || phase == .live { phase = .ended(nil) }
    }

    func mute(_ muted: Bool) {
        self.muted = muted
        audio?.mute(muted)
    }

    /** The agent is speaking, as the orb last heard it. */
    var speaking: Bool { Date().timeIntervalSince(spokeAt) < Self.speakingHold }

    /** How loud the call is now (0–1, smoothed: read once a frame), and whether that's the agent speaking. */
    var level: (value: Float, speaking: Bool) {
        let played = audio?.played ?? 0
        if played > 0.01 { spokeAt = Date() }
        let speaking = Date().timeIntervalSince(spokeAt) < Self.speakingHold
        let now = speaking ? played : muted ? 0 : audio?.heard ?? 0
        smoothed = smoothed * 0.6 + min(1, now * 8) * 0.4
        return (smoothed, speaking)
    }

    private func hangUp() {
        call?.end()
        call = nil
        audio?.stop()
        audio = nil
    }

    private func send(_ pcm: Data) {
        guard let call, unsent + Self.chunk <= Self.maxUnsent else { return }
        unsent += Self.chunk
        Task {
            try? await call.send(pcm)
            unsent -= Self.chunk
        }
    }

    private func heard(_ event: OpenClawCall.Event) {
        switch event {
        case .ready:
            if phase == .connecting {
                phase = .live
                liveAt = Date()
            }
        case .audio(let pcm):
            audio?.play(pcm)
        case .clear:
            audio?.clear()
        case .mark(let mark):
            let wait = audio?.pending ?? .zero
            Task {
                try? await Task.sleep(for: wait)
                call?.played(mark)
            }
        case .transcript(let user, let text, let final):
            store.hearSpoken(text, by: user ? .user : .assistant, final: final, in: chatId)
            let going = caption.flatMap { !captionDone && $0.user == user ? $0.text : nil }
            caption = (user, final || going == nil ? text : going! + text)
            captionDone = final
        case .closed(let error):
            call = nil
            hangUp()
            phase = .ended(error)
        }
    }
}
