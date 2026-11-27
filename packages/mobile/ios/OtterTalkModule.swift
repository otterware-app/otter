import AVFoundation
import ExpoModulesCore
import UIKit

public final class OtterTalkModule: Module {
  @MainActor private var callID: String?
  @MainActor private var audio: TalkAudio?

  public func definition() -> ModuleDefinition {
    Name("OtterTalk")
    Events("capture", "interrupted")

    AsyncFunction("requestPermission") { () async -> Bool in
      await AVAudioApplication.requestRecordPermission()
    }
    AsyncFunction("start") { (id: String, inputRate: Double, outputRate: Double) in
      try MainActor.assumeIsolated { try start(id, inputRate: inputRate, outputRate: outputRate) }
    }.runOnQueue(.main)
    AsyncFunction("stop") { (id: String) in
      MainActor.assumeIsolated { if callID == id { stop() } }
    }.runOnQueue(.main)
    AsyncFunction("mute") { (id: String, muted: Bool) in
      MainActor.assumeIsolated { if callID == id { audio?.mute(muted) } }
    }.runOnQueue(.main)
    AsyncFunction("play") { (id: String, pcm: String) in
      MainActor.assumeIsolated {
        if callID == id, let bytes = Data(base64Encoded: pcm) { audio?.play(bytes) }
      }
    }.runOnQueue(.main)
    AsyncFunction("clear") { (id: String) in
      MainActor.assumeIsolated { if callID == id { audio?.clear() } }
    }.runOnQueue(.main)
    AsyncFunction("pendingMs") { (id: String) -> Double in
      MainActor.assumeIsolated {
        guard callID == id, let audio else { return 0 }
        let duration = audio.pending.components
        return Double(duration.seconds) * 1_000 + Double(duration.attoseconds) / 1e15
      }
    }.runOnQueue(.main)

    OnDestroy { [weak self] in
      guard let self else { return }
      Task { @MainActor in self.stop() }
    }
  }

  @MainActor private func start(_ id: String, inputRate: Double, outputRate: Double) throws {
    guard UIApplication.shared.applicationState != .background else {
      throw Exception(name: "TalkUnavailable", description: "Bring Otter Agents to the foreground to call.")
    }
    stop()
    audio = try TalkAudio(inputRate: inputRate, outputRate: outputRate, send: { [weak self] bytes, level in
      guard let self, callID == id else { return }
      sendEvent("capture", ["id": id, "pcm": bytes.base64EncodedString(), "level": level, "played": audio?.played ?? 0])
    }, interrupted: { [weak self] in self?.interrupt(id) })
    callID = id
  }

  @MainActor private func interrupt(_ id: String) {
    guard callID == id else { return }
    stop()
    sendEvent("interrupted", ["id": id])
  }

  @MainActor private func stop() {
    callID = nil
    audio?.stop()
    audio = nil
  }
}
