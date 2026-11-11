import UIKit

/** The demo's picture of an agent's browser: one drawn page, so the live view can be opened and tried. */
enum DemoBrowser {
    static let page = "https://otterware.app/mail/changelog"
    static let size = CGSize(width: 1280, height: 800)
    static let picture: UIImage = {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(origin: .zero, size: size))
            let lines: [(String, CGFloat, CGFloat, UIFont)] = [
                ("Otter", 40, 24, .systemFont(ofSize: 22, weight: .bold)),
                ("Changelog", 160, 130, .systemFont(ofSize: 40, weight: .bold)),
                ("A calmer place for your work", 160, 230, .systemFont(ofSize: 28, weight: .semibold)),
                ("Mail, calendar, files and tasks, with your agents alongside.", 160, 288, .systemFont(ofSize: 20)),
                ("Follow along as your agent browses", 160, 390, .systemFont(ofSize: 28, weight: .semibold)),
                ("Watch the page, take control, and hand it back when you are ready.", 160, 448, .systemFont(ofSize: 20)),
                ("Everything together", 160, 550, .systemFont(ofSize: 28, weight: .semibold)),
                ("Keep the conversation and the work in the same place.", 160, 608, .systemFont(ofSize: 20)),
            ]
            for (text, x, y, font) in lines {
                text.draw(at: CGPoint(x: x, y: y), withAttributes: [.font: font, .foregroundColor: UIColor.black])
            }
        }
    }()
}
