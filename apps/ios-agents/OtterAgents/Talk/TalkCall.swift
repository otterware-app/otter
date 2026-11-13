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
    /** The agent is working on what the call asked of it. */
    private(set) var working = false
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
    @ObservationIgnored private var cues: Task<Void, Never>?

    /** Audio the gateway hasn't taken yet: past this, what the microphone hears is dropped. */
    private static let maxUnsent: Duration = .seconds(3)
    private static let chunk: Duration = .milliseconds(40)
    /** The agent counts as speaking this long after it last made a sound, between words. */
    private static let speakingHold: TimeInterval = 0.6
    /** While the agent works and the voice is quiet, a soft cue this often: the call isn't stuck. */
    private static let cueEvery: Duration = .milliseconds(2200)

    init(chatId: String, store: ChatStore) {
        self.chatId = chatId
        self.store = store
    }

    func start() async {
        guard await AVAudioApplication.requestRecordPermission() else {
            return phase = .ended("Otter Agents isn't allowed to use the microphone. Allow it in Settings › Otter Agents.")
        }
        guard let chat = store.chat(chatId), let agent = store.agents.agent(chat.provider), let gateway = agent.openClaw else {
            return phase = .ended("Connect this chat's agent in Settings › Agents to talk with it.")
        }
        let session = chat.sessionId ?? "agent:\(agent.model?.slug ?? "main"):otter-mail:\(UUID().uuidString.lowercased())"
        store.calling = true
        do {
            let call = try await OpenClawCall.start(on: gateway, session: session) { [weak self] in self?.heard($0) }
            guard phase == .connecting else { return call.end() }
            let (store, chatId) = (store, chatId)
            store.setSession(session, of: chatId)
            call.started = { run in store.followCallRun(run, in: chatId) }
            self.call = call
            audio = try TalkAudio(inputRate: call.inputRate, outputRate: call.outputRate,
                                  send: { [weak self] in self?.send($0) },
                                  interrupted: { [weak self] in self?.end() })
            // Muted while it connected.
            if muted { audio?.mute(true) }
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

    /** What the call asked of the agent goes on: the chat follows it. */
    private func hangUp() {
        call?.end()
        call = nil
        audio?.stop()
        audio = nil
        cues?.cancel()
        store.endSpoken(in: chatId)
        store.calling = false
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
        // The voice is there once it says anything: its "ready" can come before the call is known.
        switch event {
        case .ready, .audio, .clear, .mark, .transcript:
            if phase == .connecting {
                phase = .live
                liveAt = Date()
            }
        case .working, .closed:
            break
        }
        switch event {
        case .ready:
            break
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
        case .working(let now):
            working = now
            cues?.cancel()
            guard now else { return }
            cues = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: Self.cueEvery)
                    guard let self, !Task.isCancelled else { return }
                    if phase == .live, !speaking { audio?.cue() }
                }
            }
        case .closed(let error):
            hangUp()
            phase = .ended(error)
        }
    }
}
