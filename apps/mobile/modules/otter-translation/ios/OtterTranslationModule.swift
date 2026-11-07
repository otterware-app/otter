import ExpoModulesCore
import NaturalLanguage
import Translation
import os

private let log = Logger(subsystem: "dev.otterware.mail", category: "translation")

/**
 * native/translator (the Mac's helper) on iOS: language detection with
 * NaturalLanguage, and Apple's on-device Translation for language pairs
 * already downloaded. Answers core's `detectLanguage` and `translate`.
 */
public final class OtterTranslationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterTranslation")

    AsyncFunction("detect") { (text: String) -> [String: Any] in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      guard let best = recognizer.languageHypotheses(withMaximum: 1).max(by: { $0.value < $1.value }),
            best.key != .undetermined
      else { return ["language": NSNull(), "confidence": 0] }
      return ["language": best.key.rawValue, "confidence": best.value]
    }

    AsyncFunction("translate") { (texts: [String], source: String, target: String) async throws -> [String: Any] in
      try await Self.translate(texts: texts, source: source, target: target)
    }
  }

  private static func translate(texts: [String], source: String, target: String) async throws -> [String: Any] {
    guard #available(iOS 26, *) else { return ["status": "unavailable", "texts": []] }
    let from = Locale.Language(identifier: source)
    let to = Locale.Language(identifier: target)
    switch await LanguageAvailability().status(from: from, to: to) {
    case .installed: break
    case .supported: return ["status": "notInstalled", "texts": []]
    default: return ["status": "unsupported", "texts": []]
    }
    let requests = texts.enumerated().map {
      TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset))
    }
    for attempt in 1...2 {
      do {
        let session = TranslationSession(installedSource: from, target: to)
        var out = texts
        for try await response in session.translate(batch: requests) {
          if let id = response.clientIdentifier, let index = Int(id), out.indices.contains(index) {
            out[index] = response.targetText
          }
        }
        return ["status": "ok", "texts": out]
      } catch {
        log.error("Translating \(source, privacy: .public) to \(target, privacy: .public) failed: \(String(describing: error), privacy: .public)")
        if attempt == 1 { try await Task.sleep(nanoseconds: 500_000_000) }
      }
    }
    return ["status": "unsupported", "texts": []]
  }
}
