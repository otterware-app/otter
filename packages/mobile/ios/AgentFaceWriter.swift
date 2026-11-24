import UIKit

@MainActor
enum AgentFaceWriter {
    struct Face: Equatable {
        var key: String
        var avatar: String?
        var emoji: String? = nil
        var mark: String
    }

    private static var saved: [Face]?
    private static var latest = 0

    static func save(_ faces: [Face]) {
        guard faces != saved, let directory = AgentFaces.directory else { return }
        saved = faces
        latest += 1
        let refresh = latest
        let manager = FileManager.default
        try? manager.createDirectory(at: directory, withIntermediateDirectories: true)
        let keep = Set(faces.map { AgentFaces.filename($0.key) })
        for file in (try? manager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        where !keep.contains(file.lastPathComponent) {
            try? manager.removeItem(at: file)
        }
        // Each picture as it's ready, unless a newer refresh began meanwhile.
        for face in faces {
            Task {
                guard let png = await picture(face)?.pngData(), refresh == latest, let file = AgentFaces.file(face.key) else { return }
                try? png.write(to: file, options: .atomic)
            }
        }
    }

    private static func picture(_ face: Face) async -> UIImage? {
        if let avatar = face.avatar, let image = await image(avatar) { return round(image) }
        if let emoji = face.emoji, !emoji.isEmpty {
            return drawn { rect in
                let font = UIFont.systemFont(ofSize: rect.width * 0.62)
                let size = (emoji as NSString).size(withAttributes: [.font: font])
                (emoji as NSString).draw(at: CGPoint(x: (rect.width - size.width) / 2, y: (rect.height - size.height) / 2),
                                         withAttributes: [.font: font])
            }
        }
        guard var mark = UIImage(named: face.mark) else { return nil }
        // The one-color marks (varys) draw in the text's color, here on a light circle.
        if mark.renderingMode == .alwaysTemplate { mark = mark.withTintColor(.black, renderingMode: .alwaysOriginal) }
        return drawn { rect in mark.draw(in: rect.insetBy(dx: rect.width * 0.2, dy: rect.height * 0.2)) }
    }

    /** A picture as a data URL, or on the web (an OpenClaw agent's). */
    private static func image(_ avatar: String) async -> UIImage? {
        guard let url = URL(string: avatar) else { return nil }
        if url.scheme == "https" {
            guard let (data, _) = try? await URLSession.shared.data(from: url) else { return nil }
            return UIImage(data: data)
        }
        guard url.scheme == "data", let data = try? Data(contentsOf: url) else { return nil }
        return UIImage(data: data)
    }

    private static let side: CGFloat = 256
    private static let format = {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return format
    }()

    /** On a light circle, as Contacts draws a face it hasn't a picture for. */
    private static func drawn(_ draw: (CGRect) -> Void) -> UIImage {
        let rect = CGRect(x: 0, y: 0, width: side, height: side)
        return UIGraphicsImageRenderer(size: rect.size, format: format).image { _ in
            UIColor(white: 0.92, alpha: 1).setFill()
            UIBezierPath(ovalIn: rect).fill()
            draw(rect)
        }
    }

    /** Filled and centered, as the app's round pictures crop. */
    private static func round(_ image: UIImage) -> UIImage {
        let rect = CGRect(x: 0, y: 0, width: side, height: side)
        let scale = max(side / image.size.width, side / image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: rect.size, format: format).image { _ in
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
    }
}
