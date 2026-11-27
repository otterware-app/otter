import AVFoundation

/**
 * The microphone and the speaker of a call, in one engine with voice processing: the agent's voice
 * is taken out of what the microphone hears, so it's never heard back, on the speaker too.
 */
@MainActor final class TalkAudio {
    private nonisolated struct Failure: LocalizedError {
        let errorDescription: String?
    }

    /** How loud the agent is now, 0–1. */
    private(set) var played: Float = 0
    /** How loud you are now, 0–1. */
    private(set) var heard: Float = 0

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let outputFormat: AVAudioFormat
    private let wire: AVAudioFormat
    private let send: (Data, Float) -> Void
    private let interrupted: () -> Void
    private var queued: AVAudioFramePosition = 0
    private var playbackGeneration = 0
    private var observers: [NSObjectProtocol] = []
    private var stopped = false
    private var muted = false

    /** Sends what the microphone hears, as 16-bit PCM at `inputRate` in 40 ms chunks. */
    init(inputRate: Double, outputRate: Double, send: @escaping (Data, Float) -> Void, interrupted: @escaping () -> Void) throws {
        guard inputRate.isFinite, inputRate >= 25, outputRate.isFinite, outputRate > 0,
              let output = AVAudioFormat(standardFormatWithSampleRate: outputRate, channels: 1),
              let wire = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: inputRate, channels: 1, interleaved: true)
        else { throw Failure(errorDescription: "Couldn't set up the call's audio.") }
        outputFormat = output
        self.wire = wire
        self.send = send
        self.interrupted = interrupted
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothHFP])
        try session.setActive(true)
        do {
            try engine.inputNode.setVoiceProcessingEnabled(true)
            engine.attach(player)
            try run()
        } catch {
            stop()
            throw error
        }
        // A phone call, say, takes the audio: the call ends.
        observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            guard (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt).flatMap(AVAudioSession.InterruptionType.init) == .began else { return }
            MainActor.assumeIsolated { self?.interrupted() }
        })
        // The route changed (voice processing coming on, a headset switching to its call mode): the
        // engine stops itself, and starts again on what's there now.
        observers.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, !self.stopped else { return }
                do { try self.run() } catch { self.interrupted() }
            }
        })
    }

    /** Listens to the microphone as it is now, and plays. */
    private func run() throws {
        engine.inputNode.removeTap(onBus: 0)
        let input = engine.inputNode.outputFormat(forBus: 0)
        guard input.sampleRate > 0, input.channelCount > 0 else {
            throw Failure(errorDescription: "Couldn't set up the microphone.")
        }
        let capture = try Capture(from: input, to: wire)
        capture.owner = self
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: input, block: Self.tap(capture))
        engine.connect(player, to: engine.mainMixerNode, format: outputFormat)
        resetPlayback()
        engine.inputNode.isVoiceProcessingInputMuted = muted
        try engine.start()
        player.play()
    }

    func play(_ pcm: Data) {
        let samples = pcm.count / 2
        guard samples > 0, let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(samples)),
              let channel = buffer.floatChannelData?[0] else { return }
        buffer.frameLength = AVAudioFrameCount(samples)
        var squares: Float = 0
        pcm.withUnsafeBytes { raw in
            for index in 0..<samples {
                let sample = raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self)
                let value = Float(Int16(littleEndian: sample)) / 32768
                channel[index] = value
                squares += value * value
            }
        }
        let level = (squares / Float(samples)).squareRoot()
        if queued == 0 { played = level }
        queued += AVAudioFramePosition(samples)
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack,
                              completionHandler: Self.played(self, generation: playbackGeneration, frames: AVAudioFramePosition(samples), level: level))
    }

    private func captured(_ pcm: Data, level: Float) {
        guard !stopped else { return }
        heard = level
        send(pcm, level)
    }

    // Made off the main actor: the engine calls them on its own threads.
    private nonisolated static func tap(_ capture: Capture) -> AVAudioNodeTapBlock {
        { buffer, _ in capture.take(buffer) }
    }

    private nonisolated static func played(_ audio: TalkAudio, generation: Int, frames: AVAudioFramePosition, level: Float) -> @Sendable (AVAudioPlayerNodeCompletionCallbackType) -> Void {
        { [weak audio] _ in
            Task { @MainActor in
                guard let audio, audio.playbackGeneration == generation else { return }
                audio.queued = max(0, audio.queued - frames)
                audio.played = audio.queued > 0 ? level : 0
            }
        }
    }

    /** You spoke over it: what's queued stops. */
    func clear() {
        resetPlayback()
        player.stop()
        player.play()
    }

    private func resetPlayback() {
        playbackGeneration += 1
        queued = 0
        played = 0
    }

    /** Until what's queued has played. */
    var pending: Duration { .seconds(Double(queued) / outputFormat.sampleRate) }

    /** Muted, the microphone sends silence: the call still hears you're there. */
    func mute(_ muted: Bool) {
        self.muted = muted
        engine.inputNode.isVoiceProcessingInputMuted = muted
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        resetPlayback()
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
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
                throw Failure(errorDescription: "Couldn't set up the microphone.")
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
