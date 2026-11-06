import ExpoModulesCore
import PhotosUI
import QuickLook
import UIKit
import UniformTypeIdentifiers

/**
 * apps/ios's attachments on the phone: Quick Look and the share sheet (which
 * has Save to Files) for a message's files, and the Files and Photos pickers
 * for the composer's. Files cross as base64, as core's attachment handlers
 * give them.
 */
public final class OtterFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("OtterFiles")

    AsyncFunction("preview") { (name: String, base64: String, promise: Promise) in
      do {
        let url = try Self.write(name, base64)
        let controller = QLPreviewController()
        let source = PreviewSource(url: url)
        controller.dataSource = source
        objc_setAssociatedObject(controller, &PreviewSource.key, source, .OBJC_ASSOCIATION_RETAIN)
        try Self.present(controller)
        promise.resolve(nil)
      } catch { promise.reject(error) }
    }.runOnQueue(.main)

    AsyncFunction("share") { (name: String, base64: String, promise: Promise) in
      do {
        let url = try Self.write(name, base64)
        let controller = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        controller.completionWithItemsHandler = { _, _, _, _ in promise.resolve(nil) }
        try Self.present(controller)
      } catch { promise.reject(error) }
    }.runOnQueue(.main)

    AsyncFunction("pickDocuments") { (remaining: Int, promise: Promise) in
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
      picker.allowsMultipleSelection = true
      let delegate = DocumentPickerDelegate { urls in
        do { promise.resolve(try Self.read(urls, remaining: remaining)) } catch { promise.reject(error) }
      }
      picker.delegate = delegate
      objc_setAssociatedObject(picker, &DocumentPickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)
      do { try Self.present(picker) } catch { promise.reject(error) }
    }.runOnQueue(.main)

    AsyncFunction("pickPhotos") { (remaining: Int, promise: Promise) in
      var configuration = PHPickerConfiguration()
      configuration.filter = .images
      configuration.selectionLimit = 10
      let picker = PHPickerViewController(configuration: configuration)
      let delegate = PhotoPickerDelegate { results in
        Task {
          do { promise.resolve(try await Self.load(results, remaining: remaining)) } catch { promise.reject(error) }
        }
      }
      picker.delegate = delegate
      objc_setAssociatedObject(picker, &PhotoPickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN)
      do { try Self.present(picker) } catch { promise.reject(error) }
    }.runOnQueue(.main)
  }

  static let tooLarge = Failure("Attachments must total 25 MB or less.")

  private static func write(_ name: String, _ base64: String) throws -> URL {
    guard let data = Data(base64Encoded: base64) else { throw Failure("This attachment couldn't be opened. Please try again.") }
    let folder = FileManager.default.temporaryDirectory
      .appending(path: "attachments", directoryHint: .isDirectory)
      .appending(path: UUID().uuidString, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let safe = URL(fileURLWithPath: name).lastPathComponent
    let url = folder.appending(path: safe.isEmpty ? "attachment" : safe)
    try data.write(to: url, options: .atomic)
    return url
  }

  /** Called from the module's main-queue functions. */
  private static func present(_ controller: UIViewController) throws {
    try MainActor.assumeIsolated { try presentOnMain(controller) }
  }

  @MainActor
  private static func presentOnMain(_ controller: UIViewController) throws {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive } ?? UIApplication.shared.connectedScenes.first as? UIWindowScene
    guard var top = scene?.keyWindow?.rootViewController else { throw Failure("Otter Mail isn't on screen.") }
    while let presented = top.presentedViewController, !presented.isBeingDismissed { top = presented }
    controller.popoverPresentationController?.sourceView = top.view
    controller.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
    top.present(controller, animated: true)
  }

  private static func file(_ data: Data, name: String, type: UTType?) -> [String: Any] {
    ["name": name, "mimeType": type?.preferredMIMEType ?? "application/octet-stream", "size": data.count, "base64": data.base64EncodedString()]
  }

  private static func read(_ urls: [URL], remaining: Int) throws -> [[String: Any]] {
    var left = remaining
    return try urls.map { url in
      let values = try url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey, .isRegularFileKey])
      guard values.isRegularFile == true else { throw Failure("This attachment couldn't be opened. Please try again.") }
      guard (values.fileSize ?? 0) <= left else { throw tooLarge }
      let data = try Data(contentsOf: url)
      guard data.count <= left else { throw tooLarge }
      left -= data.count
      return file(data, name: url.lastPathComponent, type: values.contentType)
    }
  }

  private static func load(_ results: [PHPickerResult], remaining: Int) async throws -> [[String: Any]] {
    var left = remaining
    var out: [[String: Any]] = []
    for result in results {
      let provider = result.itemProvider
      let type = provider.registeredTypeIdentifiers.compactMap(UTType.init).first { $0.conforms(to: .image) } ?? .jpeg
      let data: Data = try await withCheckedThrowingContinuation { continuation in
        provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, error in
          if let data { continuation.resume(returning: data) } else {
            continuation.resume(throwing: error ?? Failure("This attachment couldn't be opened. Please try again."))
          }
        }
      }
      guard data.count <= left else { throw tooLarge }
      left -= data.count
      let name = "Photo-\(UUID().uuidString.prefix(8)).\(type.preferredFilenameExtension ?? "jpg")"
      out.append(file(data, name: name, type: type))
    }
    return out
  }
}

struct Failure: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

private final class PreviewSource: NSObject, QLPreviewControllerDataSource {
  static var key = 0
  let url: URL
  init(url: URL) { self.url = url }
  func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
}

private final class DocumentPickerDelegate: NSObject, UIDocumentPickerDelegate {
  static var key = 0
  let done: ([URL]) -> Void
  init(done: @escaping ([URL]) -> Void) { self.done = done }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done([]) }
}

private final class PhotoPickerDelegate: NSObject, PHPickerViewControllerDelegate {
  static var key = 0
  let done: ([PHPickerResult]) -> Void
  init(done: @escaping ([PHPickerResult]) -> Void) { self.done = done }
  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    done(results)
  }
}
