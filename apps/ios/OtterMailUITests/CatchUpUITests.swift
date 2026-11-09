import XCTest

/**
 * Catch up on the demo's inbox, from its pill: the pill counts the cards
 * Catch up shows, the invitation comes first with its answers, what was
 * skipped or unsubscribed from stays so after leaving and coming back, and
 * the end says so. The demo's unsubscribes post, send and open nothing.
 */
final class CatchUpUITests: XCTestCase {
    private let newsletters = [
        "The Sunday Otter — Issue #112: Rivers, rafts, and remote work",
        "48 hours only: 30% off all hiking gear",
    ]

    override func setUpWithError() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let demo = app.buttons["Try the demo mailbox"]
        if demo.waitForExistence(timeout: 3) { demo.tap() }
        XCTAssertTrue(app.buttons["Mail"].waitForExistence(timeout: 8), "Mail tab missing")
    }

    func testThePillCountsWhatCatchUpShowsAndTheInvitationLeads() {
        let app = XCUIApplication()
        let pillCount = openCatchUp(app)
        XCTAssertEqual(left(app), pillCount, "the pill and Catch up count different cards")
        XCTAssertTrue(app.buttons["Accept"].waitForExistence(timeout: 5), "the invitation isn't first")
        XCTAssertTrue(app.buttons["Decline"].exists && app.buttons["Maybe"].exists)
        XCTAssertFalse(app.buttons["places-scope"].exists, "the bar is over Catch up")
    }

    func testSkippedCardsStaySkippedAndTheEndSaysSo() {
        let app = XCUIApplication()
        let before = openCatchUp(app)
        app.buttons["Skip"].tap()
        XCTAssertTrue(app.staticTexts["\(before - 1) left"].waitForExistence(timeout: 5))
        back(app)
        XCTAssertEqual(openCatchUp(app), before - 1, "the pill didn't count the skipped card out")
        for _ in 0..<40 where app.buttons["Skip"].waitForExistence(timeout: 2) { app.buttons["Skip"].tap() }
        XCTAssertTrue(app.staticTexts["You're all caught up"].waitForExistence(timeout: 5), "the end isn't said")
        app.buttons["Back to Inbox"].tap()
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 5), "Back to Inbox didn't go back")
    }

    func testUnsubscribedMailStaysGone() {
        let app = XCUIApplication()
        openCatchUp(app)
        var subject: String?
        for _ in 0..<30 {
            if app.buttons["Unsubscribe"].exists, let shown = newsletters.first(where: { app.staticTexts[$0].exists }) {
                subject = shown
                break
            }
            XCTAssertTrue(app.buttons["Skip"].waitForExistence(timeout: 5), "ran out of cards before a newsletter")
            app.buttons["Skip"].tap()
        }
        guard let subject else { return XCTFail("no newsletter card with Unsubscribe") }

        app.buttons["Unsubscribe"].tap()
        XCTAssertTrue(gone(app.staticTexts[subject]), "the card stayed after unsubscribing")
        back(app)
        openCatchUp(app)
        for _ in 0..<40 {
            XCTAssertFalse(app.staticTexts[subject].exists, "unsubscribed mail came back")
            guard app.buttons["Skip"].waitForExistence(timeout: 2) else { break }
            app.buttons["Skip"].tap()
        }
    }

    /** Taps the inbox's pill and returns the count it said. */
    @discardableResult
    private func openCatchUp(_ app: XCUIApplication) -> Int {
        let pill = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Catch up")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 8), "no Catch up pill in the inbox")
        let count = Int(pill.label.components(separatedBy: "· ").last ?? "") ?? 0
        pill.tap()
        XCTAssertTrue(app.navigationBars["Catch up"].waitForExistence(timeout: 5), "Catch up didn't open")
        return count
    }

    private func back(_ app: XCUIApplication) {
        app.navigationBars["Catch up"].buttons.firstMatch.tap()
        XCTAssertTrue(app.buttons["All places"].waitForExistence(timeout: 5), "didn't go back to the inbox")
    }

    private func left(_ app: XCUIApplication) -> Int {
        let counter = app.staticTexts.matching(NSPredicate(format: "label ENDSWITH %@", " left")).firstMatch
        XCTAssertTrue(counter.waitForExistence(timeout: 5))
        return Int(counter.label.split(separator: " ").first ?? "") ?? 0
    }

    private func gone(_ element: XCUIElement) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: element)
        return XCTWaiter.wait(for: [expectation], timeout: 5) == .completed
    }
}
