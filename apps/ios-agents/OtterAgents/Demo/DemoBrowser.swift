import UIKit

/** The demo's picture of an agent's browser: one drawn page, so the live view can be opened and tried. */
enum DemoBrowser {
    static let page = "https://otterware.app/mail/changelog"
    static let size = CGSize(width: 390, height: 640)
    static let picture = UIGraphicsImageRenderer(size: size).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        "Changelog".draw(at: CGPoint(x: 24, y: 32), withAttributes: [.font: UIFont.systemFont(ofSize: 30, weight: .bold), .foregroundColor: UIColor.black])
        UIColor(white: 0.9, alpha: 1).setFill()
        for row in 0 ..< 12 {
            context.fill(CGRect(x: 24, y: 96 + row * 36, width: row % 4 == 3 ? 200 : 342, height: 14))
        }
    }
}
