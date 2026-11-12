import AVFoundation

/**
 * The microphone and the speaker of a call, in one engine with voice processing: the agent's voice
 * is taken out of what the microphone hears, so it's never heard back, on the speaker too.
 */
final class TalkAudio {
    /** How loud the agent is now, 0–1. */
    private(set) var played: Float = 0
    /** How loud you are now, 0–1. */
    private(set) var heard: Float = 0

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    /** The soft cue while the agent works: its own node, so it's never taken for the agent speaking. */
    private let cuePlayer = AVAudioPlayerNode()
    private let outputFormat: AVAudioFormat
    private let wire: AVAudioFormat
    private let send: (Data) -> Void
    private let interrupted: () -> Void
    private var queued: AVAudioFramePosition = 0
    private var observers: [NSObjectProtocol] = []

    /** Sends what the microphone hears, as 16-bit PCM at `inputRate` in 40 ms chunks. */
    init(inputRate: Double, outputRate: Double, send: @escaping (Data) -> Void, interrupted: @escaping () -> Void) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        try engine.inputNode.setVoiceProcessingEnabled(true)

        guard let output = AVAudioFormat(standardFormatWithSampleRate: outputRate, channels: 1),
              let wire = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: inputRate, channels: 1, interleaved: true)
        else { throw OpenClaw.Failure(message: "Couldn't set up the call's audio.") }
        outputFormat = output
        self.wire = wire
        self.send = send
        self.interrupted = interrupted
        engine.attach(player)
        engine.attach(cuePlayer)
        try run()
        // A phone call, say, takes the audio: the call ends.
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            guard (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init) == .began else { return }
            MainActor.assumeIsolated { self?.interrupted() }
        })
        // The route changed (voice processing coming on, a headset switching to its call mode): the
        // engine stops itself, and starts again on what's there now.
        observers.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                do { try self.run() } catch { self.interrupted() }
            }
        })
    }

    /** Listens to the microphone as it is now, and plays. */
    private func run() throws {
        engine.inputNode.removeTap(onBus: 0)
        let input = engine.inputNode.outputFormat(forBus: 0)
        let capture = try Capture(from: input, to: wire)
        capture.owner = self
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: input, block: Self.tap(capture))
        engine.connect(player, to: engine.mainMixerNode, format: outputFormat)
        engine.connect(cuePlayer, to: engine.mainMixerNode, format: outputFormat)
        queued = 0
        played = 0
        try engine.start()
        player.play()
        cuePlayer.play()
    }

    /** Two soft notes, rising. */
    func cue() {
        let rate = outputFormat.sampleRate
        let notes: [(hz: Double, from: Double, length: Double)] = [(587.33, 0, 0.09), (783.99, 0.13, 0.12)]
        let frames = AVAudioFrameCount(rate * 0.27)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: frames),
              let samples = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = frames
        for index in 0..<Int(frames) {
            let t = Double(index) / rate
            samples[index] = notes.reduce(0) { sum, note in
                let at = t - note.from
                guard at >= 0, at < note.length else { return sum }
                // A short rise and a long fall, so it's a soft tap, not a beep.
                let envelope = min(at / 0.01, 1) * exp(-at * 18)
                return sum + Float(sin(2 * .pi * note.hz * at) * envelope * 0.05)
            }
        }
        cuePlayer.scheduleBuffer(buffer)
    }

    func play(_ pcm: Data) {
        let samples = pcm.count / 2
        guard samples > 0, let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(samples)),
              let channel = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(samples)
        var squares: Float = 0
        pcm.withUnsafeBytes { raw in
            for (index, sample) in raw.bindMemory(to: Int16.self).enumerated() {
                let value = Float(Int16(littleEndian: sample)) / 32768
                channel[index] = value
                squares += value * value
            }
        }
        queued += AVAudioFramePosition(samples)
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack,
                              completionHandler: Self.played(self, frames: AVAudioFramePosition(samples), level: (squares / Float(samples)).squareRoot()))
    }

    private func captured(_ pcm: Data, level: Float) {
        heard = level
        send(pcm)
    }

    // Made off the main actor: the engine calls them on its own threads.
    private nonisolated static func tap(_ capture: Capture) -> AVAudioNodeTapBlock {
        { buffer, _ in capture.take(buffer) }
    }

    private nonisolated static func played(_ audio: TalkAudio, frames: AVAudioFramePosition, level: Float) -> AVAudioPlayerNodeCompletionHandler {
        { [weak audio] _ in
            Task { @MainActor in
                guard let audio else { return }
                audio.queued = max(0, audio.queued - frames)
                audio.played = audio.queued > 0 ? level : 0
            }
        }
    }

    /** You spoke over it: what's queued stops. */
    func clear() {
        player.stop()
        queued = 0
        played = 0
        player.play()
    }

    /** Until what's queued has played. */
    var pending: Duration { .seconds(Double(queued) / outputFormat.sampleRate) }

    /** Muted, the microphone sends silence: the call still hears you're there. */
    func mute(_ muted: Bool) { engine.inputNode.isVoiceProcessingInputMuted = muted }

    func stop() {
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        cuePlayer.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    /** On the audio thread: the microphone at the call's rate, in 40 ms chunks. */
    private nonisolated final class Capture: @unchecked Sendable {
        private let converter: AVAudioConverter
        private let wire: AVAudioFormat
        private let chunk: Int
        private var pending = Data()
        weak var owner: TalkAudio?

        init(from input: AVAudioFormat, to wire: AVAudioFormat) throws {
            guard let converter = AVAudioConverter(from: input, to: wire) else {
                throw OpenClaw.Failure(message: "Couldn't set up the microphone.")
            }
            self.converter = converter
            self.wire = wire
            chunk = Int(wire.sampleRate * 0.04) * 2
        }

        func take(_ buffer: AVAudioPCMBuffer) {
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * wire.sampleRate / buffer.format.sampleRate) + 32
            guard let out = AVAudioPCMBuffer(pcmFormat: wire, frameCapacity: capacity) else { return }
            var given = false
            converter.convert(to: out, error: nil) { _, status in
                if given {
                    status.pointee = .noDataNow
                    return nil
                }
                given = true
                status.pointee = .haveData
                return buffer
            }
            guard let samples = out.int16ChannelData?[0], out.frameLength > 0 else { return }
            pending.append(Data(bytes: samples, count: Int(out.frameLength) * 2))
            while pending.count >= chunk {
                let pcm = pending.prefix(chunk)
                pending.removeFirst(chunk)
                var squares: Float = 0
                pcm.withUnsafeBytes { raw in
                    for sample in raw.bindMemory(to: Int16.self) {
                        let value = Float(sample) / 32768
                        squares += value * value
                    }
                }
                let level = (squares / Float(chunk / 2)).squareRoot()
                Task { @MainActor [owner, pcm = Data(pcm)] in owner?.captured(pcm, level: level) }
            }
        }
    }
}
