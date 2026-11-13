import XCTest

final class AppearanceUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        launch()
    }

    private func launch(demo: Bool = true) {
        app = XCUIApplication()
        app.launchArguments = ["-otter:theme-source", "system", "-otter:demo", demo ? "YES" : "NO"]
        app.launch()
        XCTAssertTrue(app.buttons[demo ? "All places" : "Try the demo mailbox"].waitForExistence(timeout: 10))
    }

    private func shot(_ name: String) {
        let screenshot = XCUIScreen.main.screenshot()
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
        if let folder = ProcessInfo.processInfo.environment["OTTER_SHOTS"] {
            try? screenshot.pngRepresentation.write(to: URL(fileURLWithPath: "\(folder)/\(name).png"))
        }
    }

    private func row(_ title: String) -> XCUIElement {
        let matches = app.buttons.containing(NSPredicate(format: "label CONTAINS %@", title))
        return matches.allElementsBoundByIndex.first(where: \.isHittable) ?? matches.firstMatch
    }

    private func reveal(_ element: XCUIElement) {
        for _ in 0..<5 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable)
    }

    private func settings() {
        app.buttons["All places"].tap()
        reveal(app.buttons["Settings"])
        app.buttons["Settings"].tap()
        XCTAssertTrue(row("Color scheme").waitForExistence(timeout: 5))
    }

    func testInboxReaderAndReply() {
        shot("01-inbox")
        app.buttons["Unread"].tap()
        shot("02-unread")
        app.buttons["All"].tap()
        row("Dinner Saturday?").tap()
        let reply = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Reply to '")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 5))
        shot("03-reader")
        app.swipeUp()
        shot("04-reader-body")
        reply.tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 5))
        shot("05-reply")
    }

    func testFullWidthRows() {
        settings()
        let toggle = app.switches.matching(NSPredicate(format: "label BEGINSWITH 'Full-width rows'")).firstMatch
        reveal(toggle)
        let control = toggle.switches.firstMatch.exists ? toggle.switches.firstMatch : toggle
        if toggle.value as? String != "1" { control.tap() }
        XCTAssertEqual(toggle.value as? String, "1")
        app.buttons["Close"].tap()
        shot("06-full-width-rows")
        settings()
        reveal(toggle)
        control.tap()
    }

    func testComposeAndDrafts() {
        app.buttons["Compose"].tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 5))
        shot("07-compose")
        app.buttons["Close"].tap()
        app.buttons["Drafts"].tap()
        XCTAssertTrue(row("Trip ideas for November").waitForExistence(timeout: 5))
        shot("08-drafts")
        row("Trip ideas for November").tap()
        XCTAssertTrue(app.buttons["Send"].waitForExistence(timeout: 5))
        shot("09-draft-composer")
    }

    func testSelection() {
        app.buttons["More"].tap()
        app.buttons["Select messages"].tap()
        XCTAssertTrue(app.buttons["0 selected"].waitForExistence(timeout: 5))
        app.buttons["0 selected"].tap()
        app.buttons["Select all"].tap()
        shot("21-selection")
        app.buttons["Message actions"].tap()
        shot("22-message-actions")
    }

    func testHtmlReaderAndAttachments() {
        let newsletter = row("The Sunday Otter")
        reveal(newsletter)
        newsletter.tap()
        XCTAssertTrue(app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == 'Rivers are back'"))
            .firstMatch.waitForExistence(timeout: 10))
        app.swipeUp()
        shot("23-html-reader")
        launch()
        let flight = row("Your flight to Lisbon")
        reveal(flight)
        flight.tap()
        let ticket = row("e-ticket-7XQ2LM.pdf")
        reveal(ticket)
        shot("24-attachments")
    }

    func testSearchAndMailboxChoices() {
        row("Mailbox, Personal").tap()
        shot("10-mailbox-choices")
        app.tapCoordinateOutsideMenu()
        app.buttons["Search"].tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        shot("11-search")
        search.tap()
        search.typeText("Dinner")
        XCTAssertTrue(row("Dinner Saturday?").waitForExistence(timeout: 5))
        shot("12-search-results")
    }

    func testSettingsAndLanguages() {
        settings()
        shot("13-settings")
        app.swipeUp()
        shot("14-settings-lower")
        app.swipeDown()
        row("Languages I read").tap()
        XCTAssertTrue(app.navigationBars["Languages I read"].waitForExistence(timeout: 5))
        shot("15-languages")
    }

    func testMailboxSettings() throws {
        settings()
        row("Mailboxes").tap()
        XCTAssertTrue(app.navigationBars["Mailboxes"].waitForExistence(timeout: 5))
        shot("16-mailboxes")
        let mailbox = try XCTUnwrap(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Personal'"))
            .allElementsBoundByIndex.first(where: \.isHittable))
        mailbox.tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Display name'")).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == 'Robin'"))
            .firstMatch.waitForExistence(timeout: 10))
        shot("17-mailbox-settings")
        app.swipeUp()
        shot("18-mailbox-settings-lower")
    }

    func testLicensesAndWelcome() {
        settings()
        reveal(app.buttons["Open-source licenses"])
        app.buttons["Open-source licenses"].tap()
        XCTAssertTrue(app.navigationBars["Open-source licenses"].waitForExistence(timeout: 5))
        shot("19-licenses")
        launch(demo: false)
        shot("20-welcome")
    }
}

private extension XCUIApplication {
    func tapCoordinateOutsideMenu() {
        coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
    }
}
