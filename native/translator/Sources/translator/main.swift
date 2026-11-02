import Foundation
import NaturalLanguage
import Translation

struct Detection: Codable {
  /// BCP-47 code ("de", "fr", "zh-Hans"), or nil when undetermined.
  let language: String?
  let confidence: Double
}

struct Translated: Codable {
  /// "ok", "notInstalled" (the language pack needs downloading),
  /// "unsupported" (no model for this pair), or "unavailable" (macOS < 26).
  let status: String
  let texts: [String]
}

struct DetectRequest: Decodable { let text: String }
struct TranslateRequest: Decodable {
  let texts: [String]
  let source: String
  let target: String
}

func detectLanguage(text: String) -> Detection {
  let recognizer = NLLanguageRecognizer()
  recognizer.processString(text)
  guard
    let best = recognizer.languageHypotheses(withMaximum: 1).max(by: { $0.value < $1.value }),
    best.key != .undetermined
  else { return Detection(language: nil, confidence: 0) }
  return Detection(language: best.key.rawValue, confidence: best.value)
}

func translate(texts: [String], source: String, target: String) async throws -> Translated {
  guard #available(macOS 26, *) else { return Translated(status: "unavailable", texts: []) }
  let from = Locale.Language(identifier: source)
  let to = Locale.Language(identifier: target)
  switch await LanguageAvailability().status(from: from, to: to) {
  case .installed: break
  case .supported: return Translated(status: "notInstalled", texts: [])
  default: return Translated(status: "unsupported", texts: [])
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
      return Translated(status: "ok", texts: out)
    } catch where attempt == 1 {
      try await Task.sleep(nanoseconds: 500_000_000)
    }
  }
  return Translated(status: "unsupported", texts: [])
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func respond<T: Encodable>(_ value: T) {
  do {
    FileHandle.standardOutput.write(try JSONEncoder().encode(value))
  } catch {
    fail("Couldn't encode the response: \(error)")
  }
}

let arguments = CommandLine.arguments.dropFirst()
guard let command = arguments.first else { fail("usage: translator detect|translate < request.json") }
let input = FileHandle.standardInput.readDataToEndOfFile()
let decoder = JSONDecoder()

do {
  switch command {
  case "detect":
    let request = try decoder.decode(DetectRequest.self, from: input)
    respond(detectLanguage(text: request.text))
  case "translate":
    let request = try decoder.decode(TranslateRequest.self, from: input)
    respond(try await translate(texts: request.texts, source: request.source, target: request.target))
  default:
    fail("unknown command: \(command)")
  }
} catch {
  fail("\(error)")
}
