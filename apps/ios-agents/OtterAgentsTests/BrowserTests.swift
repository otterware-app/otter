import CoreGraphics
import Foundation
import Testing
import UIKit
@testable import Otter_Agents

@MainActor
struct BrowserTests {
    private func message(_ meta: String, _ jpeg: [UInt8]) -> Data {
        let header = Data(meta.utf8)
        return Data([0, 0, UInt8(header.count >> 8), UInt8(header.count & 0xff)]) + header + Data(jpeg)
    }

    @Test func aFrameIsItsMetaThenItsPicture() {
        let frame = BrowserFrame(message(#"{"cssWidth":1280,"cssHeight":800.5}"#, [0xff, 0xd8, 0xff]))
        #expect(frame?.cssSize == CGSize(width: 1280, height: 800.5))
        #expect(frame?.jpeg == Data([0xff, 0xd8, 0xff]))
        // A slice of a larger buffer reads the same.
        let padded = Data([9, 9]) + message("{}", [1, 2])
        #expect(BrowserFrame(padded.dropFirst(2))?.jpeg == Data([1, 2]))
        #expect(BrowserFrame(message("{}", [1]))?.cssSize == nil)
    }

    @Test func aFrameCutShortIsNone() {
        #expect(BrowserFrame(Data([0, 0, 1])) == nil)
        #expect(BrowserFrame(Data([0, 0, 0, 9, 0x7b, 0x7d])) == nil)
        #expect(BrowserFrame(Data([0xff, 0xff, 0xff, 0xff, 0x7b])) == nil)
    }

    @Test func aTouchIsAPointOfThePageFittedAgainstTheTop() throws {
        // A wide page in a tall view: as wide as the view, with room left under it.
        let wide = try #require(BrowserFit(view: CGSize(width: 400, height: 800), image: CGSize(width: 800, height: 500), css: CGSize(width: 1600, height: 1000)))
        #expect(wide.rect == CGRect(x: 0, y: 0, width: 400, height: 250))
        #expect(wide.scale == 0.25)
        #expect(wide.page(CGPoint(x: 200, y: 125)) == CGPoint(x: 800, y: 500))
        #expect(wide.page(CGPoint(x: 200, y: 300)) == nil)
        #expect(wide.page(CGPoint(x: 500, y: 300), clamped: true) == CGPoint(x: 1600, y: 1000))
        #expect(wide.view(CGPoint(x: 800, y: 500)) == CGPoint(x: 200, y: 125))

        // A tall page in a wide view: as tall as the view, in the middle.
        let tall = try #require(BrowserFit(view: CGSize(width: 400, height: 200), image: CGSize(width: 100, height: 200), css: CGSize(width: 50, height: 100)))
        #expect(tall.rect == CGRect(x: 150, y: 0, width: 100, height: 200))
        #expect(tall.page(CGPoint(x: 150, y: 0)) == .zero)
        #expect(tall.page(CGPoint(x: 100, y: 10)) == nil)
        #expect(tall.page(CGPoint(x: 200, y: 100)) == CGPoint(x: 25, y: 50))
        #expect(tall.view(CGPoint(x: 25, y: 50)) == CGPoint(x: 200, y: 100))

        #expect(BrowserFit(view: .zero, image: CGSize(width: 1, height: 1), css: CGSize(width: 1, height: 1)) == nil)
    }

    @Test func theTabIsTheLastOneTheAgentBrowsedIn() {
        let rows: [[String: Any]] = [
            ["role": "toolResult", "details": ["browserTab": ["targetId": "A", "profile": "work", "url": "https://a.example"]]],
            ["role": "assistant", "content": "done"],
            ["role": "toolResult", "details": ["browserTab": ["targetId": "B"]]],
            ["role": "toolResult", "details": ["browserTab": ["targetId": "N", "target": "node"]]],
            ["role": "toolResult", "details": ["browserTab": ["url": "https://no-target.example"]]],
        ]
        #expect(OpenClaw.browserTab(of: rows) == BrowserTab(targetId: "B"))
        #expect(OpenClaw.browserTab(of: Array(rows.prefix(2))) == BrowserTab(targetId: "A", profile: "work", url: "https://a.example"))
        #expect(OpenClaw.browserTab(of: [["role": "user"]]) == nil)
    }

    @Test func zoomAndPanKeepTouchesOnThePageAndSurviveNewFrames() throws {
        let controller = BrowserPageController()
        let image = UIGraphicsImageRenderer(size: CGSize(width: 1600, height: 1000)).image { _ in }
        controller.update(image: image, css: image.size, controlling: false, pointer: nil, typing: nil)
        controller.view.frame = CGRect(x: 0, y: 0, width: 400, height: 800)
        controller.view.layoutIfNeeded()
        #expect(controller.pagePoint(CGPoint(x: 200, y: 125)) == CGPoint(x: 800, y: 500))
        #expect(controller.pagePoint(CGPoint(x: 200, y: 300)) == nil)

        controller.scroll.setZoomScale(3, animated: false)
        controller.scroll.contentOffset = CGPoint(x: 200, y: 0)
        let at = try #require(controller.pagePoint(CGPoint(x: 400, y: 375)))
        #expect(abs(at.x - 1600 / 3) < 0.01)
        #expect(at.y == 500)

        controller.update(image: image, css: image.size, controlling: true, pointer: nil, typing: nil)
        controller.view.layoutIfNeeded()
        #expect(controller.scroll.zoomScale == 3)
        #expect(controller.scroll.contentOffset.x == 200)
        #expect(controller.scroll.panGestureRecognizer.minimumNumberOfTouches == 2)

        controller.view.frame.size = CGSize(width: 800, height: 400)
        controller.view.layoutIfNeeded()
        #expect(controller.scroll.zoomScale == 3)
        #expect(controller.pagePoint(CGPoint(x: -100, y: -100), clamped: true) == .zero)
    }

    @Test func anAddressIsAnHttpPage() {
        #expect(BrowserAddress.url(" otterware.app/mail ") == "https://otterware.app/mail")
        #expect(BrowserAddress.url("http://example.com/a?b=1#c") == "http://example.com/a?b=1#c")
        #expect(BrowserAddress.url("localhost:5833") == "http://localhost:5833")
        #expect(BrowserAddress.url("127.0.0.1/x") == "http://127.0.0.1/x")
        #expect(BrowserAddress.url("HTTPS://Example.com") != nil)
        #expect(BrowserAddress.url("") == nil)
        #expect(BrowserAddress.url("ftp://example.com") == nil)
        #expect(BrowserAddress.url("javascript://alert(1)") == nil)
        #expect(BrowserAddress.url("two words") == nil)
        #expect(BrowserAddress.host("https://www.booking.com/hotels") == "booking.com")
        #expect(BrowserAddress.host(nil) == nil)
    }

    @Test func whatHappensOnTheTabIsRead() {
        #expect(BrowserEvent(["type": "pointer", "phase": "click", "x": 10, "y": 20.5, "seq": 1]) == .pointer(CGPoint(x: 10, y: 20.5), click: true))
        #expect(BrowserEvent(["type": "field", "editable": true]) == .field(editable: true))
        #expect(BrowserEvent(["type": "fileChooser", "multiple": false]) == .fileChooser(multiple: false))
        #expect(BrowserEvent(["type": "later"]) == nil)
    }

    @Test func aTapAndAKeyAreWhatTheGatewayReplays() {
        let tap = BrowserInput.tap(at: CGPoint(x: 3, y: 4), clickCount: 2).map(\.json)
        #expect(tap.map { $0["action"] as? String } == ["move", "down", "up"])
        #expect(tap[1]["button"] as? String == "left")
        #expect(tap[1]["clickCount"] as? Int == 2)
        #expect(tap[2]["buttons"] as? Int == 0)

        let enter = BrowserInput.press("\n").map(\.json)
        #expect(enter[0]["key"] as? String == "Enter")
        #expect(enter[0]["keyCode"] as? Int == 13)
        #expect(enter[0]["text"] as? String == "\r")
        #expect(enter[1]["text"] == nil)
        let letter = BrowserInput.press("a")[0].json
        #expect(letter["code"] as? String == "KeyA")
        #expect(letter["keyCode"] as? Int == 65)
        #expect(letter["text"] as? String == "a")
        #expect(BrowserInput.press("\u{8}")[0].json["text"] == nil)
        #expect(BrowserInput.press("é")[0].json["text"] as? String == "é")
    }
}
