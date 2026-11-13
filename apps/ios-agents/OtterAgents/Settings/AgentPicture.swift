import ImageIO
import UIKit
import UniformTypeIdentifiers

/**
 * A picture you give an agent, made as apps/web's mailbox-picture-image.ts makes one: the image's
 * middle square, small enough to follow the account as a data URL (WebP where this iPhone writes
 * it, else JPEG, or PNG to keep transparency).
 */
enum AgentPicture {
    struct Failure: LocalizedError {
        var message: String
        var errorDescription: String? { message }
    }

    private static let sides: [CGFloat] = [128, 96, 64]
    private static let quality = 0.85

    static func make(from data: Data) throws -> String {
        guard let image = UIImage(data: data), image.size.width > 0, image.size.height > 0 else {
            throw Failure(message: "Couldn't read that image. Choose a PNG, JPEG or WebP.")
        }
        let opaque = image.cgImage.map { [CGImageAlphaInfo.none, .noneSkipFirst, .noneSkipLast].contains($0.alphaInfo) } ?? false
        for side in sides {
            let square = square(image, side: side, opaque: opaque)
            if let url = encoded(square, opaque: opaque), AgentList.Entry.isPicture(url) { return url }
        }
        throw Failure(message: "Couldn't make that image small enough. Choose another.")
    }

    private static func square(_ image: UIImage, side: CGFloat, opaque: Bool) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = opaque
        let scale = side / min(image.size.width, image.size.height)
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
            image.draw(in: CGRect(x: (side - size.width) / 2, y: (side - size.height) / 2, width: size.width, height: size.height))
        }
    }

    private static func encoded(_ image: UIImage, opaque: Bool) -> String? {
        if let cgImage = image.cgImage, let webp = webP(cgImage) { return "data:image/webp;base64,\(webp.base64EncodedString())" }
        if opaque { return image.jpegData(compressionQuality: quality).map { "data:image/jpeg;base64,\($0.base64EncodedString())" } }
        return image.pngData().map { "data:image/png;base64,\($0.base64EncodedString())" }
    }

    private static func webP(_ image: CGImage) -> Data? {
        let data = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(data, UTType.webP.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        return CGImageDestinationFinalize(destination) ? data as Data : nil
    }
}
